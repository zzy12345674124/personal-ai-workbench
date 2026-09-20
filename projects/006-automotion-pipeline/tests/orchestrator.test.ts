import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CostTracker } from '../src/cost/cost-tracker.js';
import { TextPipeline, extractCostInfo, extractJson, fillPrompt, loadPrompts, type SchemaRunner } from '../src/pipeline/orchestrator.js';
import { RunContext } from '../src/run/run-context.js';
import { SchemaValidator } from '../src/schemas/validator.js';
import { StateMachine } from '../src/state/state-machine.js';

const dirs: string[] = [];

function tempBase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'automotion-pipe-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

const DRAFT = JSON.stringify({ title: 't', summary: 's', key_points: ['k'], script_outline: ['o'], sources: ['u'] });
const REVIEW = JSON.stringify({
  fact_issues: [],
  logic_gaps: ['gap'],
  pacing_issues: [],
  unfeasible_shots: [],
  suggestions: ['fix it'],
  recommend_pass: false,
});
const VERDICT = JSON.stringify({ title: 't2', narration: ['n1'], storyboard: [{ index: 1, visual: 'v', narration_index: 1 }], review_resolution: ['adopted'] });

const SCHEMAS = {
  draftFile: join('schemas', 'codex-draft.schema.json'),
  review: {
    type: 'object',
    additionalProperties: false,
    required: ['fact_issues', 'logic_gaps', 'pacing_issues', 'unfeasible_shots', 'suggestions', 'recommend_pass'],
    properties: {
      fact_issues: { type: 'array', items: { type: 'string' } },
      logic_gaps: { type: 'array', items: { type: 'string' } },
      pacing_issues: { type: 'array', items: { type: 'string' } },
      unfeasible_shots: { type: 'array', items: { type: 'string' } },
      suggestions: { type: 'array', items: { type: 'string' } },
      recommend_pass: { type: 'boolean' },
    },
  },
  verdictFile: join('schemas', 'final-script.schema.json'),
  verdict: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'narration', 'storyboard', 'review_resolution'],
    properties: {
      title: { type: 'string' },
      narration: { type: 'array', items: { type: 'string' } },
      storyboard: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'visual', 'narration_index'],
          properties: { index: { type: 'integer' }, visual: { type: 'string' }, narration_index: { type: 'integer' } },
        },
      },
      review_resolution: { type: 'array', items: { type: 'string' } },
    },
  },
};

function fakeRunner(
  queues: { codex: string[]; claude: string[] },
  captured?: { codex: string[]; claude: string[] },
): SchemaRunner {
  return async (kind, prompt) => {
    captured?.[kind].push(prompt);
    const raw = queues[kind].shift();
    if (raw === undefined) throw new Error('fake runner exhausted');
    return { raw, exitCode: 0, timedOut: false };
  };
}

// 模拟真实模板：含占位符，由 pipeline 在每步实时填充（含 2026-08-07 时效模式占位符）
const PROMPTS = {
  draft: 'topic={topic}; angle={angle}; today={today}; search={searchResults}; rules={timelinessRules}',
  challenge: 'draft={draft}; check={timelinessCheck}',
  verdict: 'draft={draft}; review={review}; fix={timelinessFix}',
};

describe('extractJson', () => {
  it('extracts structured_output from claude json envelope', () => {
    const raw = JSON.stringify({ is_error: false, structured_output: { ok: true }, result: '{"ok":true}' });
    expect(extractJson(raw)).toEqual({ ok: true });
  });

  it('extracts plain json from codex interactive output', () => {
    const raw = `codex\n${JSON.stringify({ ok: true })}\ntokens used\n1,234`;
    expect(extractJson(raw)).toEqual({ ok: true });
  });

  it('returns null when no json present', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('extractCostInfo', () => {
  it('parses claude json usage', () => {
    const raw = JSON.stringify({
      total_cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 50 },
      modelUsage: { 'deepseek-v4-flash': { inputTokens: 100, outputTokens: 50, costUSD: 0.05 } },
    });
    expect(extractCostInfo(raw, 'claude')).toMatchObject({ inputTokens: 100, outputTokens: 50, costUsd: 0.05, model: 'deepseek-v4-flash' });
  });

  it('parses codex interactive tokens line', () => {
    const raw = 'model: gpt-5.6-sol\ntokens used\n15,651';
    expect(extractCostInfo(raw, 'codex')).toMatchObject({ model: 'gpt-5.6-sol', outputTokens: 15651 });
  });

  it('returns null when nothing usable', () => {
    expect(extractCostInfo('hello', 'codex')).toBeNull();
  });
});

describe('loadPrompts / fillPrompt', () => {
  it('loads templates and fills placeholders step by step', () => {
    const prompts = loadPrompts('prompts/text-pipeline.json');
    expect(prompts.draft).toContain('{topic}');
    expect(prompts.challenge).toContain('{draft}');
    expect(prompts.verdict).toContain('{draft}');
    expect(prompts.verdict).toContain('{review}');
    // 2026-08-07 时效修复：占位符含 today/searchResults/timelinessRules（空搜索注入不残留占位）
    const draftPrompt = fillPrompt(prompts.draft, {
      topic: 'AI Agent',
      angle: '角度/受众说明：面向程序员。',
      today: '2026-08-07',
      searchResults: '',
      timelinessRules: '时效性纪律（重要）：…',
    });
    expect(draftPrompt).toContain('AI Agent');
    expect(draftPrompt).toContain('面向程序员');
    expect(draftPrompt).toContain('2026-08-07');
    expect(draftPrompt).not.toContain('{topic}');
    expect(draftPrompt).not.toContain('{today}');
    expect(draftPrompt).not.toContain('{searchResults}');
    expect(draftPrompt).not.toContain('{timelinessRules}');
    // 注入搜索结果时文本进入模板
    const withSearch = fillPrompt(prompts.draft, { topic: 'T', angle: '', today: '2026-08-07', searchResults: '1. [2026-08-05] 八月新闻', timelinessRules: '' });
    expect(withSearch).toContain('八月新闻');
  });
});

describe('TextPipeline', () => {
  it('runs draft->challenge->verdict and writes artifacts', async () => {
    const ctx = RunContext.create(tempBase(), '主题');
    const cost = new CostTracker();
    const captured = { codex: [] as string[], claude: [] as string[] };
    const runner = fakeRunner({ codex: [DRAFT, VERDICT], claude: [REVIEW] }, captured);
    const pipeline = new TextPipeline({
      ctx,
      prompts: PROMPTS,
      schemas: SCHEMAS,
      runner,
      cost,
    });
    const result = await pipeline.run();
    // 关键契约：challenge 提示词必须内嵌真实草稿 JSON；verdict 提示词内嵌草稿与复核
    expect(captured.claude[0]).toContain('"title": "t"');
    expect(captured.codex[1]).toContain('"title": "t"');
    expect(captured.codex[1]).toContain('"logic_gaps"');
    expect(captured.codex[1]).toContain('"gap"');
    expect(result.draft).toMatchObject({ title: 't' });
    expect(result.review).toMatchObject({ logic_gaps: ['gap'] });
    expect(result.verdict).toMatchObject({ title: 't2' });

    for (const path of [ctx.task.paths.draft, ctx.task.paths.review, ctx.task.paths.verdict]) {
      expect(existsSync(path)).toBe(true);
    }
    const state = new StateMachine(ctx.task.paths.state);
    expect(state.readStage()).toBe('user_confirmation');
    expect(cost.toJSON()).toHaveLength(3);
  });

  it('fallback mode: draft/verdict run on claude (deepseek), codex untouched', async () => {
    const ctx = RunContext.create(tempBase(), '主题');
    const captured = { codex: [] as string[], claude: [] as string[] };
    // codex 队列为空：若降级模式仍调用 codex 会抛 'fake runner exhausted'
    const runner = fakeRunner({ codex: [], claude: [DRAFT, REVIEW, VERDICT] }, captured);
    const pipeline = new TextPipeline({ ctx, prompts: PROMPTS, schemas: SCHEMAS, runner, mode: 'fallback' });
    const result = await pipeline.run();
    expect(captured.claude).toHaveLength(3); // draft + challenge + verdict 全走 claude
    expect(captured.codex).toHaveLength(0);
    expect(result.draft).toMatchObject({ title: 't' });
    expect(result.verdict).toMatchObject({ title: 't2' });
    const state = new StateMachine(ctx.task.paths.state);
    expect(state.readStage()).toBe('user_confirmation');
  });

  it('timeliness=relaxed: draft 无时效纪律、注入常青说明、不跑搜索', async () => {
    const ctx = RunContext.create(tempBase(), '常青主题');
    const captured = { codex: [] as string[], claude: [] as string[] };
    const runner = fakeRunner({ codex: [], claude: [DRAFT, REVIEW, VERDICT] }, captured);
    vi.stubEnv('PIPELINE_TIMELINESS', 'relaxed');
    try {
      const pipeline = new TextPipeline({ ctx, prompts: PROMPTS, schemas: SCHEMAS, runner, mode: 'fallback' });
      await pipeline.run();
    } finally {
      vi.unstubAllEnvs();
    }
    const draftPrompt = captured.claude[0];
    expect(draftPrompt).toContain('常青/教程类内容');
    expect(draftPrompt).not.toContain('时效性纪律');
    expect(draftPrompt).not.toContain('只收录');
    // challenge 无时效核查段
    expect(captured.claude[1]).not.toContain('时效性核查');
    // verdict 无时效修正段
    expect(captured.claude[2]).not.toContain('时效修正要求');
  });

  it('timeliness=custom: 用户自定义时效要求原样注入（含搜索与核查）', async () => {
    const ctx = RunContext.create(tempBase(), '主题');
    const captured = { codex: [] as string[], claude: [] as string[] };
    const runner = fakeRunner({ codex: [], claude: [DRAFT, REVIEW, VERDICT] }, captured);
    vi.stubEnv('PIPELINE_TIMELINESS', 'custom');
    vi.stubEnv('PIPELINE_TIMELINESS_RULES', '只收录 2026-08-01 至 2026-08-07 之间的信息');
    try {
      const pipeline = new TextPipeline({ ctx, prompts: PROMPTS, schemas: SCHEMAS, runner, mode: 'fallback' });
      await pipeline.run();
    } finally {
      vi.unstubAllEnvs();
    }
    const draftPrompt = captured.claude[0];
    expect(draftPrompt).toContain('只收录 2026-08-01 至 2026-08-07 之间的信息'); // 用户文本注入
    expect(draftPrompt).toContain('用户指定');
    expect(captured.claude[1]).toContain('时效性核查'); // custom 保留核查
    expect(captured.claude[2]).toContain('时效修正要求'); // custom 保留修正
  });

  it('retries once with validation error feedback when schema fails', async () => {
    const ctx = RunContext.create(tempBase(), '主题');
    const bad = JSON.stringify({ title: 't' }); // 缺字段，不合规
    const runner = fakeRunner({ codex: [bad, DRAFT, VERDICT], claude: [REVIEW] });
    const pipeline = new TextPipeline({ ctx, prompts: PROMPTS, schemas: SCHEMAS, runner });
    const result = await pipeline.run();
    expect(result.draft).toMatchObject({ summary: 's' });
  });

  it('throws after retries are exhausted', async () => {
    const ctx = RunContext.create(tempBase(), '主题');
    const bad = JSON.stringify({ title: 't' });
    const runner = fakeRunner({ codex: [bad, bad, VERDICT], claude: [REVIEW] });
    const pipeline = new TextPipeline({ ctx, prompts: PROMPTS, schemas: SCHEMAS, runner });
    await expect(pipeline.run()).rejects.toThrow(/draft failed after 2 attempts/);
  });

  it('rejects non-JSON output after retries', async () => {
    const ctx = RunContext.create(tempBase(), '主题');
    const runner = fakeRunner({ codex: ['no json', 'still no json', VERDICT], claude: [REVIEW] });
    const pipeline = new TextPipeline({ ctx, prompts: PROMPTS, schemas: SCHEMAS, runner });
    await expect(pipeline.run()).rejects.toThrow(/no JSON found/);
  });

  it('validates artifacts against real schema files when available', async () => {
    // 用真实 schema 文件（测试环境有 schemas/ 目录时）验证 draft 产物合规
    const draftSchemaPath = join('schemas', 'codex-draft.schema.json');
    if (!existsSync(draftSchemaPath)) return;
    const raw = readFileSync(draftSchemaPath, 'utf8');
    const schema = JSON.parse(raw) as object;
    const validator = new SchemaValidator();
    expect(validator.validate(schema, JSON.parse(DRAFT)).valid).toBe(true);
  });
});
