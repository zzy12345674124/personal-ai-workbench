/**
 * 文本链路入口：tsx scripts/run-text-pipeline.ts "<主题>" "<角度/受众>"
 * 流程：Codex 草稿（含联网研究）→ DeepSeek 挑战 → Codex 裁决定稿 → 停在人工闸门。
 * 运行目录由 AUTOMOTION_RUN_ROOT 指定（默认项目内 runs/，需从项目根运行）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CostTracker } from '../src/cost/cost-tracker.js';
import { atomicWriteFileSync } from '../src/fs/atomic.js';
import { TextPipeline, loadPrompts } from '../src/pipeline/orchestrator.js';
import { RunContext } from '../src/run/run-context.js';

const runRoot = process.env.AUTOMOTION_RUN_ROOT ?? 'runs';
const topic = process.argv[2] ?? '';
const angle = process.argv[3] ?? '';
// 运行模式（2026-08-06）：PIPELINE_MODE=fallback 时 draft/verdict 由 DeepSeek 接任（无梯子/Codex 不可用场景）
const mode = process.env.PIPELINE_MODE === 'fallback' ? 'fallback' : 'normal';

if (!topic) {
  console.error('usage: tsx scripts/run-text-pipeline.ts "<topic>" "<angle/audience>"');
  process.exit(1);
}

const readJson = (path: string): object => JSON.parse(readFileSync(path, 'utf8'));

const ctx = RunContext.create(runRoot, topic, angle);
const prompts = loadPrompts('prompts/text-pipeline.json');
const cost = new CostTracker();
const pipeline = new TextPipeline({
  ctx,
  prompts,
  schemas: {
    draftFile: 'schemas/codex-draft.schema.json',
    review: readJson('schemas/flash-review.schema.json'),
    verdictFile: 'schemas/final-script.schema.json',
    verdict: readJson('schemas/final-script.schema.json'),
  },
  cost,
  mode,
});

console.log(`[run] ${ctx.task.runId} topic=${topic} angle=${angle} mode=${mode}`);
const result = await pipeline.run();

const summary = {
  runId: ctx.task.runId,
  stage: 'user_confirmation',
  topic,
  angle,
  costUsd: cost.totalUsd(),
  costByModel: cost.byModel(),
  artifacts: ctx.task.paths,
};
atomicWriteFileSync(join(ctx.runDir, 'run-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
