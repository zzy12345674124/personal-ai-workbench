/**
 * 字幕时间轴入口：tsx scripts/run-subtitles.ts <runDir>
 * 解析 audio/ 下逐句 WAV 时长 → 生成 subtitles.json 与 subtitles.srt。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSubtitleTimeline, toSrt } from '../src/tts/subtitles.js';
import { readWavInfo } from '../src/tts/wav-info.js';

const runDir = process.argv[2];
if (!runDir) {
  console.error('usage: tsx scripts/run-subtitles.ts <runDir>');
  process.exit(1);
}

const finalScript = JSON.parse(readFileSync(join(runDir, 'final_script.json'), 'utf8')) as {
  narration: string[];
};
const audioDir = join(runDir, 'audio');
const wavFiles = readdirSync(audioDir)
  .filter((f) => f.endsWith('.wav'))
  .sort();

const sentences = finalScript.narration;
const durations = wavFiles.map((f) => readWavInfo(join(audioDir, f)).durationSeconds);
const timeline = buildSubtitleTimeline(sentences, durations);
const totalSeconds = (timeline[timeline.length - 1]?.endSeconds ?? 0) + 0.5;

writeFileSync(
  join(runDir, 'subtitles.json'),
  JSON.stringify({ timeline, totalSeconds }, null, 2),
  'utf8',
);
writeFileSync(join(runDir, 'subtitles.srt'), toSrt(timeline), 'utf8');

console.log(
  JSON.stringify(
    {
      wavCount: wavFiles.length,
      totalSeconds: Number(totalSeconds.toFixed(2)),
      durations: durations.map((d) => Number(d.toFixed(2))),
    },
    null,
    2,
  ),
);
