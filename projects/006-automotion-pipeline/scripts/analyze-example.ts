/**
 * 示例视频视觉分析：tsx scripts/analyze-example.ts
 * 1) 5 个大转场点各 5 帧序列 → 通义分析转场类型/时长/前后风格
 * 2) 9 个平稳段代表帧 → 通义提取配色/排版/字体/装饰/组件
 * 输出 runs/examples/analysis/（转场报告 + 风格规范）
 * 需 DASHSCOPE_API_KEY；帧来自 runs/examples/frames/（2fps）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
  console.error('DASHSCOPE_API_KEY not set');
  process.exit(1);
}

const framesDir = join('runs', 'examples', 'frames');
const outDir = join('runs', 'examples', 'analysis');
mkdirSync(outDir, { recursive: true });

const frameAt = (second: number): string => {
  const n = Math.round(second / 0.5) + 1;
  return `f_${String(n).padStart(4, '0')}.png`;
};

const TRANSITIONS = [
  { time: 8.0, frames: [-1, -0.5, 0, 0.5, 1] },
  { time: 31.0, frames: [-1, -0.5, 0, 0.5, 1] },
  { time: 69.5, frames: [-1, -0.5, 0, 0.5, 1] },
  { time: 101.0, frames: [-1, -0.5, 0, 0.5, 1] },
  { time: 141.0, frames: [-1, -0.5, 0, 0.5, 1] },
];

const STYLE_FRAMES = [0.5, 13, 22, 58, 78, 110, 128, 160, 180];

const TRANSITION_PROMPT =
  '这是竖屏短视频的连续 5 帧（每帧间隔 0.5 秒，按时间顺序）。请分析这段转场：' +
  '1) 转场类型（硬切/淡入淡出/滑动/缩放/擦除/其他，可组合）；2) 转场估计时长（秒）；' +
  '3) 转场前后画面的组件/排版变化。只输出 JSON：' +
  '{"transition_type":"","estimated_duration_seconds":0,"before_style":"","after_style":"","animation_notes":""}';

const STYLE_PROMPT =
  '这是竖屏知识短视频的一帧。提取视觉风格：1) 配色方案（主色/辅色/强调色，尽量给 hex）；' +
  '2) 排版布局（元素位置/留白/层次，竖屏特点）；3) 字体风格（粗细/大小层级/位置）；' +
  '4) 装饰元素（背景纹理/光效/卡片/图标/进度元素）；5) 主要组件类型。只输出 JSON：' +
  '{"color_palette":[],"layout":"","typography":"","decorations":"","components":[]}';

async function callVision(prompt: string, imagePaths: string[]): Promise<string> {
  const content = [
    ...imagePaths.map((p) => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${readFileSync(p).toString('base64')}` },
    })),
    { type: 'text', text: prompt },
  ];
  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3.5-omni-flash', messages: [{ role: 'user', content }] }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DashScope ${response.status}: ${text.slice(0, 300)}`);
  }
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const contentRaw = (json.choices?.[0]?.message?.content ?? '').trim();
  return contentRaw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
}

const transitionsReport: Record<string, unknown> = {};
for (const t of TRANSITIONS) {
  const paths = t.frames.map((off) => join(framesDir, frameAt(t.time + off)));
  const raw = await callVision(TRANSITION_PROMPT, paths);
  transitionsReport[`${t.time}s`] = JSON.parse(raw);
  console.log(`[transition] ${t.time}s analyzed`);
}

const styleFrames: Record<string, unknown> = {};
for (let i = 0; i < STYLE_FRAMES.length; i += 3) {
  const batch = STYLE_FRAMES.slice(i, i + 3);
  const paths = batch.map((s) => join(framesDir, frameAt(s)));
  const raw = await callVision(STYLE_PROMPT, paths);
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  styleFrames[batch.join('s,') + 's'] = parsed;
  console.log(`[style] batch ${i / 3 + 1} analyzed`);
}

writeFileSync(join(outDir, 'transitions.json'), JSON.stringify(transitionsReport, null, 2), 'utf8');
writeFileSync(join(outDir, 'styles.json'), JSON.stringify(styleFrames, null, 2), 'utf8');
console.log('DONE');
