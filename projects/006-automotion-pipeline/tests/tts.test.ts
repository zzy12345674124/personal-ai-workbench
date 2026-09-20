import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readWavInfo } from '../src/tts/wav-info.js';
import { buildSubtitleTimeline, toSrt } from '../src/tts/subtitles.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

/** 生成一个 1 秒 22050Hz 16bit mono 的静音 WAV（最小头 + 数据） */
function writeOneSecondWav(path: string): void {
  const sampleRate = 22050;
  const dataSize = sampleRate * 2; // 16bit mono
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  writeFileSync(path, buf);
}

describe('readWavInfo', () => {
  it('parses a minimal PCM WAV and computes duration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'automotion-wav-'));
    dirs.push(dir);
    const path = join(dir, 't.wav');
    writeOneSecondWav(path);
    const info = readWavInfo(path);
    expect(info.sampleRate).toBe(22050);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.durationSeconds).toBeCloseTo(1.0, 3);
  });

  it('rejects non-WAV content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'automotion-wav-'));
    dirs.push(dir);
    const path = join(dir, 'bad.wav');
    // 长度超过 44 字节但非 RIFF/WAVE 头
    writeFileSync(path, 'notawav'.repeat(10), 'utf8');
    expect(() => readWavInfo(path)).toThrow(/RIFF\/WAVE/);
  });
});

describe('buildSubtitleTimeline', () => {
  it('lays lines sequentially with gap and lead', () => {
    const lines = buildSubtitleTimeline(['a', 'b'], [1.0, 2.0], { gapSeconds: 0.25, leadSeconds: 0.5 });
    expect(lines).toEqual([
      { index: 1, startSeconds: 0.5, endSeconds: 1.5, text: 'a' },
      { index: 2, startSeconds: 1.75, endSeconds: 3.75, text: 'b' },
    ]);
  });

  it('defaults to 0.25s gap and 0.5s lead', () => {
    const lines = buildSubtitleTimeline(['x'], [1.0]);
    expect(lines[0]?.startSeconds).toBe(0.5);
    expect(lines[0]?.endSeconds).toBe(1.5);
  });

  it('handles mismatched sentence/duration lengths', () => {
    const lines = buildSubtitleTimeline(['a', 'b', 'c'], [1.0]);
    expect(lines).toHaveLength(1);
  });
});

describe('toSrt', () => {
  it('formats SRT timestamps correctly', () => {
    const srt = toSrt([{ index: 1, startSeconds: 0.5, endSeconds: 1.5, text: '你好' }]);
    expect(srt).toContain('00:00:00,500 --> 00:00:01,500');
    expect(srt).toContain('你好');
  });
});
