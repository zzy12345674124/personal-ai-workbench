/**
 * 视觉复核：tsx scripts/visual-review.ts <runDir>
 * 把 keyframe-*.png 发给视觉模型，按规格 §8 字段返回结构化评估并本地判定 pass。
 * 默认主模型 = MiMo-V2.5（小米开放平台 Anthropic 兼容端点，评分严格，1080×1920 实测通过）；
 * 环境变量 VISION_PROVIDER=dashscope 可临时切回通义 qwen3.5-omni-flash（免费备选）。
 * 需环境变量 MIMO_API_KEY（默认）或 DASHSCOPE_API_KEY（dashscope 时）；
 * 通过 VISION_PASS_THRESHOLD 可调整通过分数（默认 7）。
 * 关键帧外发须经用户知情授权。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const runDir = process.argv[2];
if (!runDir) {
  console.error('usage: tsx scripts/visual-review.ts <runDir>');
  process.exit(1);
}

const provider = process.env.VISION_PROVIDER ?? 'mimo';
const passThreshold = Number(process.env.VISION_PASS_THRESHOLD ?? 7);

// 设计意图白名单（2026-08-06 加入）：VS Code 工作区框架是已验收的元叙事设计，
// 避免质检员（尤其 MiMo 这类严格评分模型）把刻意设计误报为问题。
const DESIGN_WHITELIST =
  '注意：本片采用已验收的「VS Code 工作区」元叙事设计——左侧活动栏/文件树/Git Graph/TERMINAL 等编辑器框架、' +
  '深浅色主题对比均为刻意设计，不得因此扣分；只针对视频内容区（编辑区内的场景画面）的布局、可读性、层级、一致性评分。';

const BUILTIN_BASE =
  '你是视频画面质检员。检查这张竖屏视频帧（1080x1920）：布局是否合理、文字是否清晰可读、' +
  '视觉层级是否分明、风格是否一致。' + DESIGN_WHITELIST;

// 输出结构固定（解析依赖 JSON schema），定制 prompt 只换「检查重点」，不换输出格式
const OUTPUT_SPEC =
  '只输出 JSON（0-10 分），不要任何其他内容：' +
  '{"layout_score":0,"readability_score":0,"visual_hierarchy_score":0,"style_consistency_score":0,' +
  '"detected_problems":[],"suggested_fixes":[],"pass":true}';

// 质检 prompt 优先级（2026-08-07）：runDir/review-prompt.txt（本轮定制）→ 内置默认。
// 定制来源：工作台提交时可填「质检关注点」（008 侧写入该文件）；后续可由 verdict 自动产出。
let promptBase = BUILTIN_BASE;
try {
  const custom = readFileSync(join(runDir, 'review-prompt.txt'), 'utf8').trim();
  if (custom) {
    promptBase = `你是视频画面质检员。检查这张竖屏视频帧（1080x1920）。本轮重点：${custom}`;
    console.log(`[review-prompt] 使用本轮定制 prompt（${custom.length} 字符）`);
  }
} catch {
  // 无 review-prompt.txt：内置默认
}
const PROMPT = `${promptBase}\n${OUTPUT_SPEC}`;

interface FrameVerdict {
  frame: string;
  scores: { layout: number; readability: number; hierarchy: number; consistency: number };
  detectedProblems: string[];
  suggestedFixes: string[];
}

interface ReviewResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** MiMo-V2.5：小米开放平台 Anthropic 兼容端点（2026-08-06 实测通过）；2026-08-07 返回 usage 供成本记账 */
async function reviewWithMimo(base64: string, apiKey: string): Promise<ReviewResult> {
  const body = {
    model: 'mimo-v2.5',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  };
  const response = await fetch('https://api.xiaomimimo.com/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MiMo ${response.status}: ${text.slice(0, 300)}`);
  }
  const json = (await response.json()) as {
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  // 只取 text 块（响应可能附带 thinking 块）
  const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
  return { text, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 };
}

/** 通义 qwen3.5-omni-flash：DashScope OpenAI 兼容端点（免费备选）；2026-08-07 返回 usage 供成本记账 */
async function reviewWithDashscope(base64: string, apiKey: string): Promise<ReviewResult> {
  const body = {
    model: 'qwen3.5-omni-flash',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  };
  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DashScope ${response.status}: ${text.slice(0, 300)}`);
  }
  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = (json.choices?.[0]?.message?.content ?? '').trim();
  return {
    text,
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}

const apiKey =
  provider === 'dashscope' ? process.env.DASHSCOPE_API_KEY : process.env.MIMO_API_KEY;
if (!apiKey) {
  console.error(`${provider === 'dashscope' ? 'DASHSCOPE_API_KEY' : 'MIMO_API_KEY'} not set`);
  process.exit(1);
}

const frames = readdirSync(runDir)
  .filter((f) => /^keyframe-\d+\.png$/.test(f))
  .sort();

const results: FrameVerdict[] = [];
let totalInputTokens = 0;
let totalOutputTokens = 0;
for (const frame of frames) {
  const base64 = readFileSync(join(runDir, frame)).toString('base64');
  // 2026-08-07 容错：单帧失败重试 1 次，仍失败标记错误继续（质检是复核环节，
  // 一帧偶发失败（MiMo 免费模型空响应实测）不应摧毁已完成的渲染链；全部帧失败才终止）
  let content = '';
  for (let attempt = 1; attempt <= 2 && !content.trim(); attempt++) {
    try {
      const result = provider === 'dashscope'
        ? await reviewWithDashscope(base64, apiKey)
        : await reviewWithMimo(base64, apiKey);
      content = result.text;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    } catch (e) {
      console.warn(`[review] ${frame} 第 ${attempt} 次调用失败: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!content.trim()) {
    results.push({
      frame,
      scores: { layout: 0, readability: 0, hierarchy: 0, consistency: 0 },
      detectedProblems: [`${frame} 质检调用失败（无有效响应）——请重跑质检或检查 MiMo 可用性`],
      suggestedFixes: ['重跑 run-visual-review.ps1'],
    });
    console.warn(`[review] ${frame} 无有效响应，标记失败继续`);
    continue;
  }
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed: {
    layout_score: number;
    readability_score: number;
    visual_hierarchy_score: number;
    style_consistency_score: number;
    detected_problems: string[];
    suggested_fixes: string[];
  };
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch (e) {
    results.push({
      frame,
      scores: { layout: 0, readability: 0, hierarchy: 0, consistency: 0 },
      detectedProblems: [`${frame} 质检响应解析失败: ${e instanceof Error ? e.message : e}（原始响应前 200 字符: ${cleaned.slice(0, 200)}）`],
      suggestedFixes: ['重跑 run-visual-review.ps1'],
    });
    console.warn(`[review] ${frame} JSON 解析失败，标记失败继续`);
    continue;
  }
  results.push({
    frame,
    scores: {
      layout: parsed.layout_score,
      readability: parsed.readability_score,
      hierarchy: parsed.visual_hierarchy_score,
      consistency: parsed.style_consistency_score,
    },
    detectedProblems: parsed.detected_problems,
    suggestedFixes: parsed.suggested_fixes,
  });
  console.log(`[reviewed:${provider}] ${frame}`);
}

const allPass = results.every(
  (r) =>
    r.scores.layout >= passThreshold &&
    r.scores.readability >= passThreshold &&
    r.scores.hierarchy >= passThreshold &&
    r.scores.consistency >= passThreshold &&
    r.detectedProblems.length === 0,
);

const summary = {
  provider,
  passThreshold,
  frames: results.length,
  pass: allPass,
  // 2026-08-07 成本记账：usage tokens（MiMo 免费期费用为 0，tokens 供成本预估）
  usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  perFrame: results,
};
writeFileSync(join(runDir, 'visual-review.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
