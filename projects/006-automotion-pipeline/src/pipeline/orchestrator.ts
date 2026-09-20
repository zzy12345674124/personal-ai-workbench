import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CostTracker } from '../cost/cost-tracker.js';
import { atomicWriteFileSync } from '../fs/atomic.js';
import { RunContext } from '../run/run-context.js';
import { SchemaValidator } from '../schemas/validator.js';
import { StateMachine } from '../state/state-machine.js';
import { resolveClaudeBin, runClaudeWithSchema, runCodexWithSchema } from '../adapters/cli.js';
import { filterSearchResults, formatSearchResults, persistResearch, rerankResults, runSearch } from './search-fetch.js';

export type ModelKind = 'codex' | 'claude';

export interface RunnerOutput {
  raw: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Schema 调用器：生产默认实现走真实 CLI（codex exec / claude -p），
 * 契约测试注入 fake runner，不调用真实账户（规格 §10.1-2）。
 */
export type SchemaRunner = (
  kind: ModelKind,
  prompt: string,
  schemaFile: string | undefined,
  schema: object | undefined,
) => Promise<RunnerOutput>;

export const defaultRunner: SchemaRunner = async (kind, prompt, schemaFile, schema) => {
  const cwd = process.cwd();
  // 研究类任务耗时较长；2026-08-06 高峰实测草稿 178s、挑战可 >8 分钟（DeepSeek 高峰 14-18 点），claude 超时放宽到 10 分钟
  const timeoutMs = kind === 'claude' ? 600_000 : 300_000;
  const result =
    kind === 'codex'
      ? await (async () => {
          if (!schemaFile) throw new Error('codex runner requires schemaFile path');
          // codex exec 在无 TTY 下 stdout 不含结果，须用 --output-last-message 落盘后读回
          const outputFile = join(tmpdir(), `automotion-codex-out-${process.pid}-${Date.now()}.json`);
          try {
            const out = await runCodexWithSchema(process.env.CODEX_BIN ?? 'codex', schemaFile, prompt, {
              cwd,
              timeoutMs,
              outputFile,
            });
            const fileContent = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '';
            return { raw: fileContent || out.stdout, exitCode: out.exitCode, timedOut: out.timedOut };
          } finally {
            rmSync(outputFile, { force: true });
          }
        })()
      : await (async () => {
          if (!schema) throw new Error('claude runner requires schema object');
          const out = await runClaudeWithSchema(resolveClaudeBin(), prompt, schema, {
            cwd,
            timeoutMs,
          });
          return { raw: out.stdout, exitCode: out.exitCode, timedOut: out.timedOut };
        })();
  return result;
};

export interface PipelineSchemas {
  draftFile: string;
  review: object;
  verdictFile: string;
  verdict: object;
}

export interface TextPipelineOptions {
  ctx: RunContext;
  prompts: { draft: string; challenge: string; verdict: string; shotcraftCards: string };
  schemas: PipelineSchemas;
  runner?: SchemaRunner;
  validator?: SchemaValidator;
  cost?: CostTracker;
  /** JSON 不合规时附带校验错误重试的次数（规格 §9：重试一次） */
  retryCount?: number;
  /**
   * 运行模式（2026-08-06 实现规格 §3.2 降级协议 fallback_flash_glm）：
   * 'normal' = Codex 草稿+裁决（需梯子/OpenAI 可达）；
   * 'fallback' = draft/verdict 改走 Claude CLI + deepseek-v4-flash（无需梯子）。
   */
  mode?: 'normal' | 'fallback';
}

export interface TextPipelineResult {
  draft: unknown;
  review: unknown;
  verdict: unknown;
}

/**
 * 文本链路（规格 §5 交接协议）：draft(codex) → challenge(claude) → verdict(codex)；
 * mode='fallback' 时 draft/verdict 由 Claude CLI + deepseek-v4-flash 接任（规格 §3.2 降级协议）。
 * 每步：调用 → 提取 JSON → 本地 Schema 校验（不合规附带错误重试一次）→ 原子写交接文件 → 状态机推进。
 */
export class TextPipeline {
  private readonly runner: SchemaRunner;
  private readonly validator: SchemaValidator;
  private readonly cost: CostTracker;
  private readonly retryCount: number;

  constructor(private readonly opts: TextPipelineOptions) {
    this.runner = opts.runner ?? defaultRunner;
    this.validator = opts.validator ?? new SchemaValidator();
    this.cost = opts.cost ?? new CostTracker();
    this.retryCount = opts.retryCount ?? 1;
  }

  async run(): Promise<TextPipelineResult> {
    const { ctx, prompts, schemas } = this.opts;
    const state = new StateMachine(ctx.task.paths.state);

    // 研究阶段：draft 步骤内由 Codex 联网检索（prompt 要求保存来源）
    state.transition('research');

    // 每步 prompt 在此实时组装：challenge/verdict 模板须嵌入前序产物 JSON（规格 §5 顺序交接）
    // 2026-08-07 时效修复第 1 层：注入 today（每次运行取当天），模板要求模型遵守时效纪律
    const today = new Date().toISOString().slice(0, 10);
    // 时效模式（2026-08-07）：strict=时效纪律+搜索；relaxed=跳过（常青/教程）；
    // custom=用户自定义要求（PIPELINE_TIMELINESS_RULES 原样注入 + 搜索照跑）
    const timelinessMode = process.env.PIPELINE_TIMELINESS ?? 'strict';
    const customRules = process.env.PIPELINE_TIMELINESS_RULES?.trim() ?? '';
    const isCustom = timelinessMode === 'custom';
    const isStrict = timelinessMode !== 'relaxed' && !isCustom;
    // 时效修复第 2 层：fallback 模式 draft 前真跑搜索（Tavily），结果注入 {searchResults}
    // （research.json 可追溯）；搜索失败/未配 key 仅警告不中断——增强非致命；strict/custom 都跑
    let searchResults = '';
    if (this.opts.mode === 'fallback' && (isStrict || isCustom)) {
      const apiKey = process.env.BOCHA_API_KEY ?? process.env.TAVILY_API_KEY;
      if (apiKey) {
        try {
          // query 只用 topic（angle 是受众说明，拼接会污染搜索词，实测长中文 query 结果飘）；
          // 结果先按相关度/时效过滤再注入；双提供者（博查中文优先，回退 Tavily）
          const query = ctx.task.topic;
          const raw = await runSearch(query);
          const results = filterSearchResults(raw);
          // Reranker 语义重排（2026-08-07）：Qwen3-Reranker-8B 按相关度排序（增强非致命，
          // 失败用过滤后原序）；SILICONFLOW_API_KEY 未配则跳过
          if (results.length > 1 && process.env.SILICONFLOW_API_KEY) {
            try {
              // instruction：Qwen3-Reranker 指令跟随——时效优先 + 主题强化；custom 模式用用户要求
              const instruction = isCustom
                ? `${customRules}。与「${query}」直接相关的排在前面。`
                : `优先 ${today} 前后发布的内容，与「${query}」直接相关的排在前面。`;
              const reranked = await rerankResults(query, results, process.env.SILICONFLOW_API_KEY, instruction);
              results.splice(0, results.length, ...reranked);
            } catch (e) {
              console.warn(`[rerank] skipped: ${e instanceof Error ? e.message : e}`);
            }
          }
          searchResults = formatSearchResults(results);
          persistResearch(dirname(ctx.task.paths.draft), query, results);
        } catch (e) {
          console.warn(`[search] skipped: ${e instanceof Error ? e.message : e}`);
        }
      } else {
        console.warn('[search] 搜索 key 未配置（BOCHA_API_KEY/TAVILY_API_KEY）— 降级模式无搜索注入，时效性受限');
      }
    }
    // 时效纪律文本按模式注入（2026-08-07）：strict = 完整纪律（当月/标注日期/宁缺毋滥）；
    // custom = 用户自定义要求（原样注入）；relaxed = 常青内容说明（不要求时效，但内容必须准确）
    const timelinessRules = isCustom
      ? `时效性要求（用户指定，必须严格遵守）：${customRules}`
      : isStrict
        ? `时效性纪律（重要）：这是短视频内容，时效错误是最严重的失误。① 只收录 ${today} 所在月份内发生或可确认的信息；② 知识截止日期之前的信息，若无法确认其时效性，必须在该条目上标注大致日期（如「截至 2026-07」），不得假装是当月新闻；③ 宁可只写能确认时效的内容，不可编造时间、不可把旧闻包装成新事；④ 来源列表必须带发布日期；⑤ 若提供了「检索到的近期资料」，优先以其中的事实为准并引用其日期。`
        : '内容定位（本片为常青/教程类内容）：不要求时效性——内容可基于稳定的基础知识，无需标注日期，但信息必须准确、结构清晰、有深度。';
    const timelinessCheck = (isStrict || isCustom)
      ? '另加时效性核查：逐条标注草稿中可能过时的信息（新闻/数据/榜单类尤其重点），指出哪些内容看似「最近」实为旧闻，或缺少明确时间归属。'
      : '';
    const timelinessFix = (isStrict || isCustom)
      ? '时效修正要求：对复核指出的过时/无日期信息——能修正为符合时效要求的事实则修正，无法确认的一律删除或明确标注日期（如「截至 2026-07」），宁缺毋滥，禁止在旁白中出现时间归属模糊的「最近/近日」。'
      : '';
    const draftPrompt = fillPrompt(prompts.draft, {
      topic: ctx.task.topic,
      angle: ctx.task.angle ? `角度/受众说明：${ctx.task.angle}。` : '',
      today,
      searchResults,
      timelinessRules,
    });
    // 降级模式：draft 由 Flash 接任（claude 适配器需要 schema 对象，故预读文件）
    const draft =
      this.opts.mode === 'fallback'
        ? await this.callWithRetry('claude', draftPrompt, undefined, readJsonFile(schemas.draftFile), 'flash_draft')
        : await this.callWithRetry('codex', draftPrompt, schemas.draftFile, undefined, 'codex_draft');
    atomicWriteFileSync(ctx.task.paths.draft, JSON.stringify(draft, null, 2));
    state.transition('codex_draft');

    const reviewPrompt = fillPrompt(prompts.challenge, {
      draft: JSON.stringify(draft, null, 2),
      timelinessCheck,
    });
    const review = await this.callWithRetry(
      'claude',
      reviewPrompt,
      undefined,
      schemas.review,
      'flash_challenge',
    );
    atomicWriteFileSync(ctx.task.paths.review, JSON.stringify(review, null, 2));
    state.transition('flash_challenge');

    const verdictPrompt = fillPrompt(prompts.verdict, {
      draft: JSON.stringify(draft, null, 2),
      review: JSON.stringify(review, null, 2),
      timelinessFix,
      // 2026-08-11 shotcraft 镜头卡：词汇表注入分镜约束（loadPrompts 已随模板读取）
      shotcraftCards: prompts.shotcraftCards,
    });
    const verdict =
      this.opts.mode === 'fallback'
        ? await this.callWithRetry('claude', verdictPrompt, undefined, schemas.verdict, 'flash_verdict')
        : await this.callWithRetry('codex', verdictPrompt, schemas.verdictFile, schemas.verdict, 'codex_verdict');
    atomicWriteFileSync(ctx.task.paths.verdict, JSON.stringify(verdict, null, 2));
    state.transition('codex_verdict');
    // 人工闸门：流水线暂停等待用户确认（规格 §2.1）
    state.transition('user_confirmation');

    return { draft, review, verdict };
  }

  private async callWithRetry(
    kind: ModelKind,
    prompt: string,
    schemaFile: string | undefined,
    schema: object | undefined,
    stage: string,
  ): Promise<unknown> {
    let lastErrors: string[] = [];
    // codex 步骤只传 schema 文件路径：本地校验时回退读取文件内容（规格 §8 不依赖模型自觉）
    const effectiveSchema = schema ?? (schemaFile ? readJsonFile(schemaFile) : undefined);
    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      const out = await this.runner(kind, prompt, schemaFile, schema);
      this.recordCost(kind, stage, out.raw);
      const parsed = extractJson(out.raw);
      if (parsed === null) {
        lastErrors = ['no JSON found in model output'];
        continue;
      }
      const result = this.validator.validate(effectiveSchema ?? {}, parsed);
      if (result.valid) return parsed;
      lastErrors = result.errors;
    }
    throw new Error(
      `stage ${stage} failed after ${this.retryCount + 1} attempts; last errors: ${lastErrors.join('; ')}`,
    );
  }

  /** 从 CLI 原始输出尽力提取用量/费用并记入成本（提取失败则记 0，不阻断流水线） */
  private recordCost(kind: ModelKind, stage: string, raw: string): void {
    const parsed = extractCostInfo(raw, kind);
    this.cost.add({
      runId: this.opts.ctx.task.runId,
      stage,
      model: parsed?.model ?? (kind === 'codex' ? 'codex-unknown' : 'deepseek-v4-flash'),
      inputTokens: parsed?.inputTokens ?? 0,
      outputTokens: parsed?.outputTokens ?? 0,
      costUsd: parsed?.costUsd ?? 0,
    });
  }
}

/** 从 CLI 输出中提取 JSON（codex 交互文本 / claude json 两种形态） */
export function extractJson(raw: string): unknown | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // claude 形态：{"is_error":..., "result": "...", "structured_output": {...}}
  try {
    const outer = JSON.parse(trimmed) as Record<string, unknown>;
    if (outer.structured_output !== undefined && typeof outer.structured_output === 'object') {
      return outer.structured_output;
    }
    if (typeof outer.result === 'string') {
      try {
        return JSON.parse(outer.result);
      } catch {
        // result 不是 JSON，回落到普通对象
      }
    }
    if (outer !== null) return outer;
  } catch {
    // 不是合法 JSON，继续尝试从文本中截取
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 尽力从输出提取模型/用量/费用；提取失败返回 null */
export function extractCostInfo(
  raw: string,
  kind: ModelKind,
): { model?: string; inputTokens?: number; outputTokens?: number; costUsd?: number } | null {
  const trimmed = raw.trim();
  try {
    const outer = JSON.parse(trimmed) as {
      usage?: { input_tokens?: number; output_tokens?: number };
      total_cost_usd?: number;
      modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; costUSD?: number }>;
    };
    const usage = outer.usage;
    const first = outer.modelUsage ? Object.entries(outer.modelUsage)[0]?.[1] : undefined;
    return {
      model: first ? Object.keys(outer.modelUsage ?? {})[0] : undefined,
      inputTokens: usage?.input_tokens ?? first?.inputTokens,
      outputTokens: usage?.output_tokens ?? first?.outputTokens,
      costUsd: outer.total_cost_usd ?? first?.costUSD,
    };
  } catch {
    // 非 JSON（codex 交互文本）：尝试 "tokens used N" 行与 model 行
  }
  const modelMatch = /model:\s*(\S+)/.exec(trimmed);
  const tokensMatch = /tokens used\s*([\d,]+)/.exec(trimmed);
  if (!modelMatch && !tokensMatch) return null;
  return {
    model: modelMatch?.[1] ?? undefined,
    inputTokens: undefined,
    outputTokens: tokensMatch?.[1] ? Number(tokensMatch[1].replaceAll(',', '')) : undefined,
  };
}

function readJsonFile(path: string): object {
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}

/** 读取 prompts/text-pipeline.json 模板（占位符由 pipeline 在每步实时填充）
 *  2026-08-11：顺带读同目录 shotcraft-cards.txt（镜头卡词汇表，缺失返回空串不阻断流水线） */
export function loadPrompts(promptFile: string): { draft: string; challenge: string; verdict: string; shotcraftCards: string } {
  const template = JSON.parse(readFileSync(promptFile, 'utf8')) as Record<string, string>;
  let shotcraftCards = '';
  try {
    shotcraftCards = readFileSync(join(dirname(promptFile), 'shotcraft-cards.txt'), 'utf8');
  } catch { /* 词汇表缺失不影响文本链路 */ }
  return {
    draft: template['draft'] ?? '',
    challenge: template['challenge'] ?? '',
    verdict: template['verdict'] ?? '',
    shotcraftCards,
  };
}

/** 用 {key} 占位符填充提示词模板 */
export function fillPrompt(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}
