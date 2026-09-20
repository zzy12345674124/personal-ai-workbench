import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CollectorContractError, collectorRouter, createCollectorBridge, validateCollectorJob,
} from '../server/bridges/collector.js';

function validJob() {
  return { platform: 'douyin', keywords: ['教材', '教材'] };
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; pid: number };
  child.exitCode = null;
  child.pid = 12345;
  return child;
}

describe('collector 公共合同', () => {
  it('规范化关键词并补齐保守上限，不保留合同外字段', () => {
    expect(validateCollectorJob({ ...validJob(), secret: 'drop-me' })).toEqual({
      platform: 'douyin',
      keywords: ['教材'],
      limits: {
        maxContentsPerKeyword: 20, maxCommentsPerContent: 100, maxPagesPerContent: 10, maxRuntimeMinutes: 60,
      },
      timing: { minActionDelayMs: 1500, maxActionDelayMs: 4000, cooldownAfterRateLimitMs: 300000 },
      browser: { visible: true },
      contentFilter: '',
    });
  });

  it.each([
    [{ platform: '../douyin', keywords: ['x'] }, 'BAD_PLATFORM'],
    [{ platform: 'douyin', keywords: [] }, 'BAD_KEYWORDS'],
    [{ ...validJob(), limits: { maxCommentsPerContent: 1001 } }, 'BAD_LIMITS'],
    [{ ...validJob(), timing: { minActionDelayMs: 5000, maxActionDelayMs: 1000 } }, 'BAD_TIMING'],
    [{ ...validJob(), browser: { visible: false } }, 'BACKGROUND_NOT_APPROVED'],
  ])('拒绝非法任务 %#', (job, code) => {
    expect(() => validateCollectorJob(job)).toThrowError(expect.objectContaining({ code }));
  });
});

describe('collector bridge', () => {
  it('默认不开启真实平台，也不回退系统 Python', () => {
    const root = mkdtempSync(join(tmpdir(), 'collector-bridge-'));
    const bridge = createCollectorBridge({ runsDir: root, pythonExecutable: join(root, 'missing-python.exe') });
    expect(bridge.capabilities()).toMatchObject({
      platforms: [
        { platform: 'douyin', ready: false },
        { platform: 'xiaohongshu', ready: false },
        { platform: 'bilibili', ready: false },
      ],
      pythonConfigured: false, aiRequired: false, realCollectionEnabled: false,
    });
    expect(() => bridge.start(validJob())).toThrowError(expect.objectContaining({ code: 'PLATFORM_NOT_READY' }));
  });

  it('小红书复用同一任务合同与保守默认值', () => {
    expect(validateCollectorJob({ platform: 'xiaohongshu', keywords: ['教材'] })).toMatchObject({
      platform: 'xiaohongshu', keywords: ['教材'], browser: { visible: true },
      limits: { maxRuntimeMinutes: 60 },
    });
  });

  it('B站复用同一任务合同与保守默认值', () => {
    expect(validateCollectorJob({ platform: 'bilibili', keywords: ['教材'] })).toMatchObject({
      platform: 'bilibili', keywords: ['教材'], browser: { visible: true },
      limits: { maxRuntimeMinutes: 60 },
    });
  });

  it('显式启用后按任务隔离写快照并用模块方式启动 Python', () => {
    const root = mkdtempSync(join(tmpdir(), 'collector-bridge-'));
    const python = join(root, 'python.exe');
    writeFileSync(python, 'fake');
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child);
    const syncComments = vi.fn();
    const bridge = createCollectorBridge({
      runsDir: join(root, 'runs'), pythonExecutable: python, enabledPlatforms: ['douyin'], spawnProcess, syncComments,
      now: () => 1787500000000, random: () => 'abc12345',
    });
    const { jobId } = bridge.start(validJob());
    const jobPath = join(root, 'runs', 'douyin', jobId, 'job.json');
    expect(existsSync(jobPath)).toBe(true);
    expect(JSON.parse(readFileSync(jobPath, 'utf8'))).toMatchObject({ platform: 'douyin', keywords: ['教材'], jobId });
    expect(spawnProcess).toHaveBeenCalledWith(
      python,
      ['-m', 'scripts.collector.runner', '--job', jobPath],
      expect.objectContaining({
        cwd: expect.any(String), windowsHide: true,
        env: expect.objectContaining({
          PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PROCESSOR_ARCHITECTURE: 'AMD64',
        }),
      }),
    );
    expect(bridge.status(jobId)).toMatchObject({ state: 'queued', running: true });
    child.emit('exit', 0);
    expect(syncComments).toHaveBeenCalledOnce();
  });

  it('拒绝路径型任务号，停止只作用于精确任务', () => {
    const root = mkdtempSync(join(tmpdir(), 'collector-bridge-'));
    const python = join(root, 'python.exe');
    writeFileSync(python, 'fake');
    const child = fakeChild();
    const stopProcess = vi.fn();
    let stopCallback = () => {};
    const scheduleStop = vi.fn((callback) => {
      stopCallback = callback;
      return { unref: vi.fn() };
    });
    const bridge = createCollectorBridge({
      runsDir: join(root, 'runs'), pythonExecutable: python, enabledPlatforms: ['douyin'],
      spawnProcess: () => child, stopProcess, scheduleStop,
      now: () => 1787500000000, random: () => 'abc12345',
    });
    const { jobId } = bridge.start(validJob());
    expect(() => bridge.status('../evil')).toThrowError(expect.objectContaining({ code: 'BAD_JOB_ID' }));
    expect(bridge.pause(jobId)).toEqual({ paused: true });
    expect(JSON.parse(readFileSync(join(root, 'runs', 'douyin', jobId, 'control.json'), 'utf8'))).toMatchObject({ action: 'pause' });
    expect(bridge.resume(jobId)).toEqual({ resumed: true });
    expect(JSON.parse(readFileSync(join(root, 'runs', 'douyin', jobId, 'control.json'), 'utf8'))).toMatchObject({ action: 'run' });
    expect(bridge.stop(jobId)).toEqual({ stopped: true });
    expect(scheduleStop).toHaveBeenCalledWith(expect.any(Function), 5_000);
    expect(JSON.parse(readFileSync(join(root, 'runs', 'douyin', jobId, 'control.json'), 'utf8'))).toMatchObject({ action: 'stop' });
    expect(stopProcess).not.toHaveBeenCalled();
    stopCallback();
    expect(stopProcess).toHaveBeenCalledWith(child);
    expect(bridge.status(jobId)).toMatchObject({ state: 'stopped', code: 'STOPPED_BY_USER', running: true });
    child.emit('exit', 0);
    expect(bridge.status(jobId)).toMatchObject({ state: 'stopped', running: false });
  });

  it('达到运行时长硬上限后终止精确任务并落盘终态', () => {
    const root = mkdtempSync(join(tmpdir(), 'collector-bridge-'));
    const python = join(root, 'python.exe');
    writeFileSync(python, 'fake');
    const child = fakeChild();
    const stopProcess = vi.fn();
    let runtimeCallback = () => {};
    const scheduleRuntime = vi.fn((callback) => {
      runtimeCallback = callback;
      return { unref: vi.fn() };
    });
    const cancelRuntime = vi.fn();
    const bridge = createCollectorBridge({
      runsDir: join(root, 'runs'), pythonExecutable: python, enabledPlatforms: ['douyin'],
      spawnProcess: () => child, stopProcess, scheduleRuntime, cancelRuntime,
      now: () => 1787500000000, random: () => 'abc12345',
    });
    const { jobId } = bridge.start({ ...validJob(), limits: { maxRuntimeMinutes: 2 } });
    expect(scheduleRuntime).toHaveBeenCalledWith(expect.any(Function), 120_000);
    runtimeCallback();
    expect(stopProcess).toHaveBeenCalledWith(child);
    expect(bridge.status(jobId)).toMatchObject({ state: 'failed', code: 'RUNTIME_LIMIT', running: true });
    child.emit('exit', 1);
    expect(bridge.status(jobId)).toMatchObject({ state: 'failed', code: 'RUNTIME_LIMIT', running: false });
  });
});

describe('collector router', () => {
  function response() {
    const out = { status: 0, body: null as unknown };
    return { out, writeHead(code: number) { out.status = code; }, end(body: string) { out.body = JSON.parse(body); } };
  }

  it('能力接口明确报告真实采集尚未启用', async () => {
    const bridge = createCollectorBridge({ pythonExecutable: 'missing-python.exe' });
    const res = response();
    await collectorRouter({ method: 'GET' }, res, new URL('http://127.0.0.1/api/collector/capabilities'), { bridge });
    expect(res.out).toMatchObject({ status: 200, body: { ok: true, data: { realCollectionEnabled: false } } });
  });

  it('未过实施闸门的启动请求返回 503', async () => {
    const bridge = createCollectorBridge({ pythonExecutable: 'missing-python.exe' });
    const req = {
      method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(validJob())); },
    };
    const res = response();
    await collectorRouter(req, res, new URL('http://127.0.0.1/api/collector/start'), { bridge });
    expect(res.out).toEqual({ status: 503, body: { ok: false, error: 'PLATFORM_NOT_READY' } });
  });

  it.each([
    { label: '畸形 JSON', body: 'not-json', error: 'BAD_JSON' },
    { label: '超过 64KB', body: 'x'.repeat(64 * 1024 + 1), error: 'BODY_TOO_LARGE' },
  ])('拒绝异常请求体：$label', async ({ body, error }) => {
    const bridge = createCollectorBridge({ pythonExecutable: 'missing-python.exe' });
    const req = {
      method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(body); },
    };
    const res = response();
    await collectorRouter(req, res, new URL('http://127.0.0.1/api/collector/start'), { bridge });
    expect(res.out).toEqual({ status: 400, body: { ok: false, error } });
  });
});
