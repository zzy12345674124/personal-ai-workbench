import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acquireLock,
  createInitialState,
  readState,
  releaseLock,
  transitionState,
  writeState,
} from '../server/collaboration/state.js';

describe('collaboration state', () => {
  it('只允许声明过的状态迁移并增加修订号', () => {
    const initial = createInitialState('task.md');
    expect(initial.maxRounds).toBe(6);
    const running = transitionState(initial, 'CLAUDE_RUNNING');
    expect(running.status).toBe('CLAUDE_RUNNING');
    expect(running.revision).toBe(1);
    expect(() => transitionState(running, 'APPROVED')).toThrow('INVALID_COLLABORATION_TRANSITION');
  });

  it('原子写入并读回状态', () => {
    const root = mkdtempSync(join(tmpdir(), 'collaboration-state-'));
    const statePath = join(root, 'runtime', 'state.json');
    const state = createInitialState(join(root, 'task.md'), { maxRounds: 2 });
    writeState(statePath, state);
    expect(readState(statePath)).toMatchObject({ status: 'READY_FOR_CLAUDE', maxRounds: 2 });
    expect(readFileSync(statePath, 'utf8')).toContain('"schemaVersion": 1');
  });

  it('存活进程持有锁时拒绝第二实例，释放后可重拿', () => {
    const root = mkdtempSync(join(tmpdir(), 'collaboration-lock-'));
    const lockPath = join(root, 'orchestrator.lock');
    expect(acquireLock(lockPath)).toMatchObject({ acquired: true, ownerPid: process.pid });
    expect(acquireLock(lockPath)).toMatchObject({ acquired: false, ownerPid: process.pid });
    releaseLock(lockPath);
    expect(acquireLock(lockPath).acquired).toBe(true);
    releaseLock(lockPath);
  });

  it('损坏或死亡 PID 的残留锁会自愈', () => {
    const root = mkdtempSync(join(tmpdir(), 'collaboration-stale-lock-'));
    const lockPath = join(root, 'orchestrator.lock');
    writeFileSync(lockPath, '{bad json', 'utf8');
    expect(acquireLock(lockPath).acquired).toBe(true);
    releaseLock(lockPath);
  });
});
