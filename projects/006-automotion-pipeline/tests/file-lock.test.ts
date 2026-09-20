import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileLock } from '../src/fs/file-lock.js';

const dirs: string[] = [];

function tempLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'automotion-lock-'));
  dirs.push(dir);
  return join(dir, 'stage.lock');
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('FileLock', () => {
  it('acquires and records pid/host/runId', () => {
    const lock = new FileLock(tempLockPath());
    expect(lock.acquire('run-1')).toBe(true);
    const info = lock.readInfo();
    expect(info).not.toBeNull();
    expect(info?.pid).toBe(process.pid);
    expect(info?.runId).toBe('run-1');
    expect(typeof info?.host).toBe('string');
  });

  it('refuses second acquire while holder is alive', () => {
    const lock = new FileLock(tempLockPath());
    expect(lock.acquire('run-1')).toBe(true);
    expect(lock.acquire('run-2')).toBe(false);
  });

  it('releases and re-acquires', () => {
    const lock = new FileLock(tempLockPath());
    expect(lock.acquire('run-1')).toBe(true);
    lock.release();
    expect(existsSync(lock['lockPath'])).toBe(false);
    expect(lock.acquire('run-2')).toBe(true);
  });

  it('reclaims a stale lock whose holder process is gone', () => {
    const lockPath = tempLockPath();
    // 模拟崩溃残留：持有进程 99999999 不存在
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 99999999, host: 'fake', timestamp: new Date().toISOString(), runId: 'dead-run' }),
      'utf8',
    );
    const lock = new FileLock(lockPath);
    expect(lock.acquire('run-new')).toBe(true);
    expect(lock.readInfo()?.runId).toBe('run-new');
  });

  it('treats unreadable lock file as stale', () => {
    const lockPath = tempLockPath();
    writeFileSync(lockPath, 'not-json', 'utf8');
    const lock = new FileLock(lockPath);
    expect(lock.acquire('run-new')).toBe(true);
  });
});
