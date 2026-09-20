import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVoiceBridge, voiceRouter } from '../server/bridges/voice.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'voice-bridge-'));
  const runtimeDir = join(root, 'runtime');
  const ffmpegPath = join(root, 'ffmpeg.exe');
  const scriptPath = join(root, 'transcribe.ps1');
  const pythonPath = join(root, 'python.exe');
  const pythonPackagesDir = join(root, 'voice-python');
  const modelPath = join(root, 'model');
  writeFileSync(ffmpegPath, 'fake');
  writeFileSync(scriptPath, 'fake');
  writeFileSync(pythonPath, 'fake');
  mkdirSync(join(pythonPackagesDir, 'faster_whisper'), { recursive: true });
  mkdirSync(modelPath, { recursive: true });
  return { root, runtimeDir, ffmpegPath, scriptPath, pythonPath, pythonPackagesDir, modelPath };
}

describe('voice bridge 本地转写', () => {
  it('仅在 Windows + FFmpeg + Python 运行包 + 本地模型齐全时可用', () => {
    const f = fixture();
    expect(createVoiceBridge({ ...f, platform: 'win32' }).status()).toMatchObject({ available: true, localOnly: true });
    expect(createVoiceBridge({ ...f, platform: 'linux' }).status().available).toBe(false);
  });

  it('录音转 WAV 后调本地 SAPI，成功或失败都清理临时音频', async () => {
    const f = fixture();
    const calls = [];
    const runProcess = vi.fn(async (command, args, options) => {
      calls.push({ command, args, options });
      if (String(command).includes('ffmpeg')) {
        writeFileSync(args.at(-1), 'wav');
        return { stdout: '', stderr: '' };
      }
      return { stdout: '{"transcript":"今天讲 RAG","segments":[{"text":"今天讲 RAG","confidence":0.91}],"locale":"zh-CN"}\n', stderr: '' };
    });
    const data = await createVoiceBridge({ ...f, platform: 'win32', runProcess }).transcribe(Buffer.from('webm'), 'audio/webm;codecs=opus');
    expect(data.transcript).toBe('今天讲 RAG');
    expect(calls).toHaveLength(2);
    expect(calls[1].options.env).toMatchObject({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    expect(readdirSync(f.runtimeDir)).toEqual([]);
  });

  it('拒绝空音频和非音频 MIME', async () => {
    const f = fixture();
    const bridge = createVoiceBridge({ ...f, platform: 'win32' });
    await expect(bridge.transcribe(Buffer.alloc(0), 'audio/webm')).rejects.toThrow('VOICE_BAD_AUDIO');
    await expect(bridge.transcribe(Buffer.from('x'), 'application/json')).rejects.toThrow('VOICE_BAD_AUDIO');
  });

  it('WAV 上传也使用独立 PCM 输出路径（FFmpeg 输入不得等于输出）', async () => {
    const f = fixture();
    let ffmpegArgs = [];
    const runProcess = async (command, args) => {
      if (String(command).includes('ffmpeg')) { ffmpegArgs = args; writeFileSync(args.at(-1), 'wav'); return { stdout: '' }; }
      return { stdout: '{"transcript":"","segments":[],"locale":"zh"}' };
    };
    await createVoiceBridge({ ...f, platform: 'win32', runProcess }).transcribe(Buffer.from('wav'), 'audio/wav');
    expect(ffmpegArgs[ffmpegArgs.indexOf('-i') + 1]).not.toBe(ffmpegArgs.at(-1));
    expect(readdirSync(f.runtimeDir)).toEqual([]);
  });
});

describe('voice router', () => {
  const makeRes = () => {
    const out = { status: 0, body: null };
    return { out, writeHead(code) { out.status = code; }, end(payload) { out.body = JSON.parse(payload); } };
  };
  const makeReq = (body, type = 'audio/webm') => ({
    method: 'POST', headers: { 'content-type': type },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); },
  });

  it('POST /transcribe 返回结构化转写', async () => {
    const f = fixture();
    const runProcess = async (command, args) => {
      if (String(command).includes('ffmpeg')) { writeFileSync(args.at(-1), 'wav'); return { stdout: '' }; }
      return { stdout: '{"transcript":"口述内容","segments":[],"locale":"zh-CN"}' };
    };
    const res = makeRes();
    await voiceRouter(makeReq('audio'), res, new URL('http://127.0.0.1:8080/api/voice/transcribe'), { ...f, platform: 'win32', runProcess });
    expect(res.out).toEqual({ status: 200, body: { ok: true, data: { transcript: '口述内容', segments: [], locale: 'zh-CN' } } });
  });
});
