// 多平台采集公共桥：只负责合同、进程、状态和路径；不得出现平台网址或页面字段。
import { spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT, RUNS_DIR, RUNTIME_DIR } from '../paths.js';
import { syncCommentSources } from '../comment-store.js';

const SUPPORTED_PLATFORMS = new Set(['douyin', 'xiaohongshu', 'bilibili']);
const JOB_ID_RE = /^collector-(douyin|xiaohongshu|bilibili)-[a-zA-Z0-9-]{6,80}$/;
const DEFAULT_RUNS_DIR = join(RUNS_DIR, 'collectors');
const DEFAULT_PYTHON = join(RUNTIME_DIR, 'collector-python', 'python.exe');
const REQUEST_BODY_LIMIT = 64 * 1024;

export class CollectorContractError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

function boundedInt(value, fallback, min, max, code) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new CollectorContractError(code);
  return result;
}

export function validateCollectorJob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CollectorContractError('BAD_JOB');
  if (!SUPPORTED_PLATFORMS.has(raw.platform)) throw new CollectorContractError('BAD_PLATFORM');
  if (!Array.isArray(raw.keywords) || raw.keywords.length < 1 || raw.keywords.length > 20) {
    throw new CollectorContractError('BAD_KEYWORDS');
  }
  const keywords = [];
  for (const value of raw.keywords) {
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 50) {
      throw new CollectorContractError('BAD_KEYWORDS');
    }
    if (!keywords.includes(value.trim())) keywords.push(value.trim());
  }
  const limits = raw.limits && typeof raw.limits === 'object' && !Array.isArray(raw.limits) ? raw.limits : {};
  const timing = raw.timing && typeof raw.timing === 'object' && !Array.isArray(raw.timing) ? raw.timing : {};
  const browser = raw.browser && typeof raw.browser === 'object' && !Array.isArray(raw.browser) ? raw.browser : {};
  if ((browser.visible ?? true) !== true) throw new CollectorContractError('BACKGROUND_NOT_APPROVED');
  const minActionDelayMs = boundedInt(timing.minActionDelayMs, 1500, 500, 60_000, 'BAD_TIMING');
  const maxActionDelayMs = boundedInt(timing.maxActionDelayMs, 4000, 500, 120_000, 'BAD_TIMING');
  if (maxActionDelayMs < minActionDelayMs) throw new CollectorContractError('BAD_TIMING');
  const contentFilter = raw.contentFilter ?? '';
  if (typeof contentFilter !== 'string' || contentFilter.length > 100) {
    throw new CollectorContractError('BAD_CONTENT_FILTER');
  }
  return {
    platform: raw.platform,
    keywords,
    limits: {
      maxContentsPerKeyword: boundedInt(limits.maxContentsPerKeyword, 20, 1, 100, 'BAD_LIMITS'),
      maxCommentsPerContent: boundedInt(limits.maxCommentsPerContent, 100, 1, 1000, 'BAD_LIMITS'),
      maxPagesPerContent: boundedInt(limits.maxPagesPerContent, 10, 1, 100, 'BAD_LIMITS'),
      maxRuntimeMinutes: boundedInt(limits.maxRuntimeMinutes, 60, 1, 480, 'BAD_LIMITS'),
    },
    timing: {
      minActionDelayMs,
      maxActionDelayMs,
      cooldownAfterRateLimitMs: boundedInt(
        timing.cooldownAfterRateLimitMs, 300_000, 30_000, 3_600_000, 'BAD_TIMING',
      ),
    },
    browser: { visible: true },
    contentFilter: contentFilter.trim(),
  };
}

function atomicJson(path, payload) {
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function defaultStopProcess(child) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

export function createCollectorBridge({
  runsDir = DEFAULT_RUNS_DIR,
  pythonExecutable = process.env.COLLECTOR_PYTHON ?? DEFAULT_PYTHON,
  moduleName = 'scripts.collector.runner',
  enabledPlatforms = [],
  spawnProcess = spawn,
  stopProcess = defaultStopProcess,
  scheduleRuntime = setTimeout,
  cancelRuntime = clearTimeout,
  scheduleStop = setTimeout,
  cancelStop = clearTimeout,
  syncComments = null,
  now = () => Date.now(),
  random = () => Math.random().toString(36).slice(2, 10),
} = {}) {
  const enabled = new Set(enabledPlatforms);
  const active = new Map();

  function writeForcedTerminal(jobId, state, code) {
    const path = join(jobDir(jobId), 'status.json');
    const previous = readJson(path) ?? { jobId };
    atomicJson(path, {
      ...previous,
      state,
      code,
      running: false,
      updatedAt: new Date(now()).toISOString(),
    });
  }

  function jobDir(jobId) {
    if (!JOB_ID_RE.test(jobId)) throw new CollectorContractError('BAD_JOB_ID');
    const platform = jobId.split('-')[1];
    return join(runsDir, platform, jobId);
  }

  return {
    capabilities() {
      return {
        platforms: [...SUPPORTED_PLATFORMS].map((platform) => ({ platform, ready: enabled.has(platform) })),
        pythonConfigured: existsSync(pythonExecutable),
        pythonContract: 'CPython 3.12.x',
        aiRequired: false,
        realCollectionEnabled: enabled.size > 0 && existsSync(pythonExecutable),
      };
    },
    start(raw) {
      const job = validateCollectorJob(raw);
      if (!enabled.has(job.platform)) throw new CollectorContractError('PLATFORM_NOT_READY');
      const existing = [...active.values()].find((item) => item.platform === job.platform && item.child.exitCode === null);
      if (existing) throw new CollectorContractError('PLATFORM_BUSY');
      if (!existsSync(pythonExecutable)) throw new CollectorContractError('COLLECTOR_PYTHON_NOT_CONFIGURED');
      const jobId = `collector-${job.platform}-${now()}-${random()}`;
      const dir = jobDir(jobId);
      mkdirSync(dir, { recursive: true });
      const snapshot = { ...job, jobId, createdAt: new Date(now()).toISOString() };
      const jobPath = join(dir, 'job.json');
      atomicJson(jobPath, snapshot);
      atomicJson(join(dir, 'status.json'), {
        jobId, platform: job.platform, state: 'queued', createdAt: snapshot.createdAt, updatedAt: snapshot.createdAt,
      });
      const child = spawnProcess(pythonExecutable, ['-m', moduleName, '--job', jobPath], {
        cwd: PROJECT_ROOT,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONDONTWRITEBYTECODE: '1',
          // 沙箱/桌面启动器可能裁掉此变量，platform.machine() 会变成空串；
          // 只给采集子进程补本机真实架构，不修改 Windows 全局环境。
          PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE
            ?? (process.arch === 'x64' ? 'AMD64' : process.arch),
        },
      });
      const task = {
        jobId, platform: job.platform, child, runtimeTimer: null, stopTimer: null, forcedTerminal: null,
      };
      const finalize = () => {
        if (task.runtimeTimer) cancelRuntime(task.runtimeTimer);
        if (task.stopTimer) cancelStop(task.stopTimer);
        if (task.forcedTerminal) {
          writeForcedTerminal(jobId, task.forcedTerminal.state, task.forcedTerminal.code);
        }
        active.delete(jobId);
        if (syncComments) {
          try { syncComments(); } catch { /* 数据库同步失败不覆盖原采集终态，打开数据面板时会重试。 */ }
        }
      };
      task.runtimeTimer = scheduleRuntime(() => {
        if (child.exitCode !== null) return;
        task.forcedTerminal = { state: 'failed', code: 'RUNTIME_LIMIT' };
        writeForcedTerminal(jobId, 'failed', 'RUNTIME_LIMIT');
        stopProcess(child);
      }, job.limits.maxRuntimeMinutes * 60_000);
      task.runtimeTimer?.unref?.();
      active.set(jobId, task);
      child.once?.('exit', finalize);
      child.once?.('error', () => {
        if (!task.forcedTerminal) task.forcedTerminal = { state: 'failed', code: 'COLLECTOR_PROCESS_ERROR' };
        finalize();
      });
      return { jobId };
    },
    stop(jobId) {
      if (!JOB_ID_RE.test(jobId)) throw new CollectorContractError('BAD_JOB_ID');
      const task = active.get(jobId);
      if (!task || task.child.exitCode !== null) return { stopped: false };
      if (task.runtimeTimer) {
        cancelRuntime(task.runtimeTimer);
        task.runtimeTimer = null;
      }
      atomicJson(join(jobDir(jobId), 'control.json'), { action: 'stop', requestedAt: new Date(now()).toISOString() });
      task.stopTimer = scheduleStop(() => {
        if (task.child.exitCode !== null) return;
        task.forcedTerminal = { state: 'stopped', code: 'STOPPED_BY_USER' };
        writeForcedTerminal(jobId, 'stopped', 'STOPPED_BY_USER');
        stopProcess(task.child);
      }, 5_000);
      task.stopTimer?.unref?.();
      return { stopped: true };
    },
    pause(jobId) {
      if (!JOB_ID_RE.test(jobId)) throw new CollectorContractError('BAD_JOB_ID');
      const task = active.get(jobId);
      if (!task || task.child.exitCode !== null) return { paused: false };
      atomicJson(join(jobDir(jobId), 'control.json'), { action: 'pause', requestedAt: new Date(now()).toISOString() });
      return { paused: true };
    },
    resume(jobId) {
      if (!JOB_ID_RE.test(jobId)) throw new CollectorContractError('BAD_JOB_ID');
      const task = active.get(jobId);
      if (!task || task.child.exitCode !== null) return { resumed: false };
      atomicJson(join(jobDir(jobId), 'control.json'), { action: 'run', requestedAt: new Date(now()).toISOString() });
      return { resumed: true };
    },
    status(jobId) {
      const dir = jobDir(jobId);
      const status = readJson(join(dir, 'status.json'));
      if (!status) throw new CollectorContractError('JOB_NOT_FOUND');
      const eventsPath = join(dir, 'events.jsonl');
      const events = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split(/\r?\n/).slice(-50) : [];
      return { ...status, running: active.has(jobId), events };
    },
  };
}

const defaultBridge = createCollectorBridge({
  enabledPlatforms: ['douyin', 'xiaohongshu', 'bilibili'],
  syncComments: () => syncCommentSources(),
});

export async function collectorRouter(req, res, url, { bridge = defaultBridge } = {}) {
  const json = (code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };
  const readBody = async () => {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > REQUEST_BODY_LIMIT) throw new CollectorContractError('BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw new CollectorContractError('BAD_JSON');
    }
  };
  try {
    if (url.pathname === '/api/collector/capabilities' && req.method === 'GET') {
      return json(200, { ok: true, data: bridge.capabilities() });
    }
    if (url.pathname === '/api/collector/start' && req.method === 'POST') {
      return json(200, { ok: true, data: bridge.start(await readBody()) });
    }
    if (url.pathname === '/api/collector/stop' && req.method === 'POST') {
      const { id } = await readBody();
      return json(200, { ok: true, data: bridge.stop(id) });
    }
    if (url.pathname === '/api/collector/pause' && req.method === 'POST') {
      const { id } = await readBody();
      return json(200, { ok: true, data: bridge.pause(id) });
    }
    if (url.pathname === '/api/collector/resume' && req.method === 'POST') {
      const { id } = await readBody();
      return json(200, { ok: true, data: bridge.resume(id) });
    }
    if (url.pathname === '/api/collector/status' && req.method === 'GET') {
      return json(200, { ok: true, data: bridge.status(url.searchParams.get('id') ?? '') });
    }
    return json(404, { ok: false, error: 'COLLECTOR_ROUTE_NOT_FOUND' });
  } catch (error) {
    const code = error instanceof CollectorContractError ? error.code : 'COLLECTOR_INTERNAL';
    const status = ['BAD_JOB', 'BAD_PLATFORM', 'BAD_KEYWORDS', 'BAD_LIMITS', 'BAD_TIMING', 'BAD_CONTENT_FILTER', 'BAD_JOB_ID', 'BAD_JSON', 'BODY_TOO_LARGE', 'BACKGROUND_NOT_APPROVED'].includes(code)
      ? 400
      : ['PLATFORM_BUSY'].includes(code) ? 409
        : ['PLATFORM_NOT_READY', 'COLLECTOR_PYTHON_NOT_CONFIGURED'].includes(code) ? 503
          : ['JOB_NOT_FOUND'].includes(code) ? 404 : 500;
    return json(status, { ok: false, error: code });
  }
}
