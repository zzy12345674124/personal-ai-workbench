// scripts/vision-ask.ts —— 开发期视觉质检：截图 → MiMo-V2.5 评价
// 用法：tsx scripts/vision-ask.ts <imagePath> "<question>"
import { readFileSync } from 'node:fs';

const [imgPath, question] = process.argv.slice(2);
if (!imgPath || !question) {
  console.error('usage: tsx scripts/vision-ask.ts <imagePath> "<question>"');
  process.exit(1);
}
const apiKey = process.env.MIMO_API_KEY;
if (!apiKey) { console.error('MIMO_API_KEY not set'); process.exit(1); }

const b64 = readFileSync(imgPath).toString('base64');
const body = {
  model: 'mimo-v2.5',
  max_tokens: 1200,
  messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
    { type: 'text', text: question },
  ] }],
};
const resp = await fetch('https://api.xiaomimimo.com/anthropic/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!resp.ok) { console.error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`); process.exit(1); }
const json = (await resp.json()) as { content?: { type?: string; text?: string }[] };
console.log((json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''));
