import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const COLLABORATION_STATES = Object.freeze([
  'READY_FOR_CLAUDE',
  'CLAUDE_RUNNING',
  'READY_FOR_CODEX_REVIEW',
  'CODEX_REVIEWING',
  'CHANGES_REQUESTED',
  'APPROVED',
  'AWAITING_USER',
  'FAILED',
]);

const TRANSITIONS = Object.freeze({
  READY_FOR_CLAUDE: ['CLAUDE_RUNNING'],
  CLAUDE_RUNNING: ['READY_FOR_CODEX_REVIEW', 'CHANGES_REQUESTED', 'AWAITING_USER', 'FAILED'],
  READY_FOR_CODEX_REVIEW: ['CODEX_REVIEWING'],
  CODEX_REVIEWING: ['APPROVED', 'CHANGES_REQUESTED', 'AWAITING_USER', 'FAILED'],
  CHANGES_REQUESTED: ['CLAUDE_RUNNING', 'AWAITING_USER'],
  APPROVED: [],
  AWAITING_USER: ['READY_FOR_CLAUDE', 'READY_FOR_CODEX_REVIEW'],
  FAILED: ['READY_FOR_CLAUDE'],
});

function nowIso() {
  return new Date().toISOString();
}

export function createInitialState(taskFile, options = {}) {
  const createdAt = nowIso();
  return {
    schemaVersion: 1,
    taskFile: resolve(taskFile),
    status: 'READY_FOR_CLAUDE',
    revision: 0,
    round: 0,
    maxRounds: options.maxRounds ?? 6,
    createdAt,
    updatedAt: createdAt,
    taskHash: options.taskHash ?? null,
    feedback: [],
    testResults: [],
    claude: null,
    codex: null,
    lastError: null,
  };
}

export function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('BAD_COLLABORATION_STATE');
  if (state.schemaVersion !== 1) throw new Error('BAD_COLLABORATION_STATE_VERSION');
  if (!COLLABORATION_STATES.includes(state.status)) throw new Error('BAD_COLLABORATION_STATUS');
  if (!Number.isInteger(state.revision) || state.revision < 0) throw new Error('BAD_COLLABORATION_REVISION');
  if (!Number.isInteger(state.round) || state.round < 0) throw new Error('BAD_COLLABORATION_ROUND');
  if (!Number.isInteger(state.maxRounds) || state.maxRounds < 1 || state.maxRounds > 10) throw new Error('BAD_COLLABORATION_MAX_ROUNDS');
  if (typeof state.taskFile !== 'string' || state.taskFile.length === 0) throw new Error('BAD_COLLABORATION_TASK_FILE');
  if (!Array.isArray(state.feedback) || !Array.isArray(state.testResults)) throw new Error('BAD_COLLABORATION_HISTORY');
  return state;
}

export function transitionState(state, nextStatus, patch = {}) {
  validateState(state);
  if (!COLLABORATION_STATES.includes(nextStatus)) throw new Error(`UNKNOWN_COLLABORATION_STATUS:${nextStatus}`);
  if (!TRANSITIONS[state.status].includes(nextStatus)) {
    throw new Error(`INVALID_COLLABORATION_TRANSITION:${state.status}->${nextStatus}`);
  }
  return validateState({
    ...state,
    ...patch,
    status: nextStatus,
    revision: state.revision + 1,
    updatedAt: nowIso(),
  });
}

export function readState(statePath) {
  return validateState(JSON.parse(readFileSync(statePath, 'utf8')));
}

export function atomicWriteJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}

export function writeState(statePath, state) {
  validateState(state);
  atomicWriteJson(statePath, state);
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const handle = openSync(lockPath, 'wx');
  try {
    writeFileSync(handle, `${JSON.stringify({ pid: process.pid, createdAt: nowIso() })}\n`, 'utf8');
  } finally {
    closeSync(handle);
  }
  return { acquired: true, ownerPid: process.pid };
}

export function acquireLock(lockPath) {
  try {
    return createLock(lockPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let ownerPid = null;
  try {
    ownerPid = JSON.parse(readFileSync(lockPath, 'utf8')).pid;
  } catch {
    ownerPid = null;
  }
  if (isProcessAlive(ownerPid)) return { acquired: false, ownerPid };

  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') return { acquired: false, ownerPid };
  }
  try {
    return createLock(lockPath);
  } catch (error) {
    if (error?.code === 'EEXIST') return { acquired: false, ownerPid: null };
    throw error;
  }
}

export function releaseLock(lockPath) {
  if (!existsSync(lockPath)) return;
  try {
    const owner = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (owner.pid !== process.pid && isProcessAlive(owner.pid)) return;
  } catch {
    // 损坏锁视为残留锁；只有持有编排流程的当前进程会走到这里。
  }
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
