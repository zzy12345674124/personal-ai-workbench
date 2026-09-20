import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PROJECT_ROOT, RUNTIME_DIR } from '../paths.js';

const BODY_LIMIT = 25 * 1024 * 1024;
const MIME_EXT = new Map([
  ['audio/webm', '.webm'], ['audio/ogg', '.ogg'], ['audio/wav', '.wav'], ['audio/x-wav', '.wav'], ['audio/mp4', '.m4a'],
]);

function defaultRunProcess(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`VOICE_PROCESS_FAILED: ${stderr.trim() || command}`));
    });
  });
}

export function createVoiceBridge({
  runtimeDir = join(RUNTIME_DIR, 'voice'),
  ffmpegPath = process.env.FFMPEG_PATH ?? resolve(PROJECT_ROOT, '..', '..', '..', 'oopz', 'ffmpeg.exe'),
  scriptPath = join(PROJECT_ROOT, 'scripts', 'transcribe-faster-whisper.py'),
  pythonPath = process.env.FASTER_WHISPER_PYTHON ?? 'D:\\Count\\Anaconda\\envs\\stata_env_3.9\\python.exe',
  pythonPackagesDir = join(RUNTIME_DIR, 'voice-python'),
  modelPath = process.env.FASTER_WHISPER_MODEL ?? resolveCachedModel(),
  runProcess = defaultRunProcess,
  platform = process.platform,
} = {}) {
  const status = () => ({
    available: platform === 'win32' && existsSync(ffmpegPath) && existsSync(scriptPath) && existsSync(pythonPath) && existsSync(join(pythonPackagesDir, 'faster_whisper')) && Boolean(modelPath) && existsSync(modelPath),
    localOnly: true,
    provider: 'faster-whisper-base',
    modelCached: Boolean(modelPath) && existsSync(modelPath),
    runtimeInstalled: existsSync(join(pythonPackagesDir, 'faster_whisper')),
  });

  async function transcribe(buffer, contentType) {
    const mime = String(contentType ?? '').split(';')[0].trim().toLowerCase();
    const ext = MIME_EXT.get(mime);
    if (!ext || !Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('VOICE_BAD_AUDIO');
    if (buffer.length > BODY_LIMIT) throw new Error('VOICE_BODY_TOO_LARGE');
    if (!status().available) throw new Error('VOICE_NOT_AVAILABLE');

    mkdirSync(runtimeDir, { recursive: true });
    const id = randomUUID();
    const source = join(runtimeDir, `${id}${ext}`);
    const wav = join(runtimeDir, `${id}.pcm.wav`);
    writeFileSync(source, buffer);
    try {
      await runProcess(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
      const env = {
        ...process.env,
        PYTHONPATH: [pythonPackagesDir, process.env.PYTHONPATH].filter(Boolean).join(';'),
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      };
      const { stdout } = await runProcess(pythonPath, [scriptPath, '--audio', wav, '--model', modelPath], { env });
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      let data;
      try { data = JSON.parse(line ?? ''); } catch { throw new Error('VOICE_BAD_TRANSCRIPT'); }
      if (!data || typeof data.transcript !== 'string') throw new Error('VOICE_BAD_TRANSCRIPT');
      return data;
    } finally {
      if (existsSync(source)) rmSync(source);
      if (existsSync(wav)) rmSync(wav);
    }
  }

  return { status, transcribe };
}

function resolveCachedModel() {
  try {
    const root = join(homedir(), '.cache', 'huggingface', 'hub', 'models--Systran--faster-whisper-base');
    const revision = readFileSync(join(root, 'refs', 'main'), 'utf8').trim();
    return revision ? join(root, 'snapshots', revision) : '';
  } catch {
    return '';
  }
}

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

async function readAudio(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > BODY_LIMIT) throw new Error('VOICE_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function voiceRouter(req, res, url, options = {}) {
  const bridge = createVoiceBridge(options);
  if (req.method === 'GET' && url.pathname === '/api/voice/status') return json(res, 200, { ok: true, data: bridge.status() });
  if (req.method !== 'POST' || url.pathname !== '/api/voice/transcribe') return json(res, 404, { ok: false, error: 'NOT_FOUND' });
  try {
    const data = await bridge.transcribe(await readAudio(req), req.headers?.['content-type']);
    return json(res, 200, { ok: true, data });
  } catch (error) {
    const code = error.message;
    if (code === 'VOICE_BODY_TOO_LARGE') return json(res, 413, { ok: false, error: code });
    if (code === 'VOICE_BAD_AUDIO') return json(res, 400, { ok: false, error: code });
    if (code === 'VOICE_NOT_AVAILABLE') return json(res, 503, { ok: false, error: code });
    return json(res, 500, { ok: false, error: code.startsWith('VOICE_') ? code : 'VOICE_TRANSCRIBE_FAILED' });
  }
}
