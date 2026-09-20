import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readClaudeWriteback, readTaskDocument, validateReview, writeCodexReview } from './document.js';
import { runClaude, runCodex, runProjectChecks } from './cli.js';
import { acquireLock, atomicWriteJson, createInitialState, readState, releaseLock, transitionState, writeState } from './state.js';

function compactResult(result) {
  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stderrTail: result.stderr.slice(-2000),
    stdoutTail: result.stdout.slice(-2000),
  };
}

function checksPassed(results) {
  return results.length === 3 && results.every((result) => result.exitCode === 0 && !result.timedOut);
}

function checksFeedback(results) {
  return results
    .filter((result) => result.exitCode !== 0 || result.timedOut)
    .map((result) => `${result.name} 失败（exit=${result.exitCode}, timedOut=${result.timedOut}）：${result.stderr.slice(-1500) || result.stdout.slice(-1500)}`);
}

export function buildClaudePrompt(state) {
  const feedback = state.feedback.length
    ? `\n本轮必须处理的上一轮反馈：\n${state.feedback.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
    : '';
  return `你是本任务的实施代理 Claude。请完整阅读并严格执行：${state.taskFile}

当前是第 ${state.round + 1}/${state.maxRounds} 轮。必须遵守任务书的文件所有权、允许修改范围、TDD 顺序和真实数据安全边界。
你可以修改任务书允许的代码文件，并且只能在任务书的“Claude 执行回填”章节记录执行证据；不得编辑“Codex 复核”章节。
禁止安装、登录、外发、删除真实数据、运行真实视频渲染、git reset/checkout/clean、全量 git add 或提交。
完成后必须把 Claude 回填状态写成“自动化验证通过，待用户验收”；若受阻则写成“受阻待确认”并停止。${feedback}`;
}

export function buildCodexPrompt(state) {
  const tests = state.testResults.map((item) => `${item.name}: exit=${item.exitCode}, timedOut=${item.timedOut}`).join('\n');
  return `你是只读审核代理 Codex。审核任务书 ${state.taskFile} 对应的当前实现。

要求：
1. 阅读任务书的合同、全局约束、Claude 回填和最终验收标准。
2. 检查 008 与 006 当前代码和 diff；工作区原本很脏，不得把既有修改误判为本任务缺陷。
3. 不修改任何文件，不安装、不外发、不运行真实视频；只做静态审核。
4. 重点检查：配置合同一致性、默认值、坏配置失败、跨源限制、原子写、真实 runs 隔离、Remotion 不自动启动、旧功能回归风险。
5. 只有没有 P0/P1 且合同完整时才能 decision=approved。可执行但需要用户决定时 decision=blocked。

编排器已独立运行的测试：
${tests || '无测试结果（应判 blocked）'}

严格按输出 Schema 返回审核结果。`;
}

export class CollaborationOrchestrator {
  constructor(options) {
    this.taskFile = options.taskFile;
    this.statePath = options.statePath;
    this.lockPath = options.lockPath;
    this.runtimeDir = options.runtimeDir;
    this.workbenchDir = options.workbenchDir;
    this.autoMotionDir = options.autoMotionDir;
    this.schemaFile = options.schemaFile;
    this.claudeRunner = options.claudeRunner ?? runClaude;
    this.codexRunner = options.codexRunner ?? runCodex;
    this.checkRunner = options.checkRunner ?? runProjectChecks;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  initialize(maxRounds = 6) {
    mkdirSync(this.runtimeDir, { recursive: true });
    const task = readTaskDocument(this.taskFile);
    if (existsSync(this.statePath)) {
      const existing = readState(this.statePath);
      if (existing.status === 'READY_FOR_CLAUDE' && existing.revision === 0 && existing.taskHash !== task.hash) {
        const refreshed = { ...existing, taskHash: task.hash, updatedAt: this.clock() };
        writeState(this.statePath, refreshed);
        return refreshed;
      }
      return existing;
    }
    const state = createInitialState(this.taskFile, { maxRounds, taskHash: task.hash });
    writeState(this.statePath, state);
    return state;
  }

  log(name, value) {
    const logDir = join(this.runtimeDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const stamp = this.clock().replaceAll(':', '-');
    const logPath = join(logDir, `${stamp}-${name}.json`);
    atomicWriteJson(logPath, value);
    return logPath;
  }

  async runOne() {
    const lock = acquireLock(this.lockPath);
    if (!lock.acquired) return { action: 'locked', ownerPid: lock.ownerPid };
    try {
      const state = this.initialize();
      if (state.status === 'READY_FOR_CLAUDE' || state.status === 'CHANGES_REQUESTED') return await this.runClaudeStep(state);
      if (state.status === 'READY_FOR_CODEX_REVIEW') return await this.runCodexStep(state);
      return { action: 'idle', status: state.status };
    } finally {
      releaseLock(this.lockPath);
    }
  }

  resumeForClaude() {
    const lock = acquireLock(this.lockPath);
    if (!lock.acquired) return { action: 'locked', ownerPid: lock.ownerPid };
    try {
      const state = this.initialize();
      if (state.status !== 'AWAITING_USER') return { action: 'not_awaiting_user', status: state.status };
      if (state.round >= state.maxRounds) return { action: 'max_rounds_reached', state };

      const task = readTaskDocument(this.taskFile);
      const resumed = transitionState(state, 'READY_FOR_CLAUDE', {
        round: state.round + 1,
        taskHash: task.hash,
        lastError: null,
      });
      writeState(this.statePath, resumed);
      return { action: 'resumed_for_claude', state: resumed };
    } finally {
      releaseLock(this.lockPath);
    }
  }

  extendForClaude(extraRounds = 1) {
    if (!Number.isInteger(extraRounds) || extraRounds < 1 || extraRounds > 7) {
      throw new Error('BAD_COLLABORATION_EXTRA_ROUNDS');
    }
    const lock = acquireLock(this.lockPath);
    if (!lock.acquired) return { action: 'locked', ownerPid: lock.ownerPid };
    try {
      const state = this.initialize();
      if (state.status !== 'AWAITING_USER') return { action: 'not_awaiting_user', status: state.status };
      if (state.maxRounds + extraRounds > 10) return { action: 'max_round_limit', state };

      const task = readTaskDocument(this.taskFile);
      const resumed = transitionState(state, 'READY_FOR_CLAUDE', {
        maxRounds: state.maxRounds + extraRounds,
        taskHash: task.hash,
        lastError: null,
      });
      writeState(this.statePath, resumed);
      return { action: 'extended_for_claude', state: resumed };
    } finally {
      releaseLock(this.lockPath);
    }
  }

  async runClaudeStep(initialState) {
    const before = readTaskDocument(this.taskFile);
    let state = transitionState(initialState, 'CLAUDE_RUNNING', { lastError: null });
    writeState(this.statePath, state);

    const result = await this.claudeRunner(buildClaudePrompt(state), {
      workbenchDir: this.workbenchDir,
      autoMotionDir: this.autoMotionDir,
    });
    const claudeLog = this.log(`round-${state.round + 1}-claude`, compactResult(result));
    state = { ...readState(this.statePath), claude: { ...compactResult(result), logPath: claudeLog } };
    if (result.exitCode !== 0 || result.timedOut) {
      state = transitionState(state, 'AWAITING_USER', { lastError: 'CLAUDE_PROCESS_FAILED' });
      writeState(this.statePath, state);
      return { action: 'claude_failed', state };
    }

    const after = readTaskDocument(this.taskFile);
    const writeback = readClaudeWriteback(after.text);
    if (after.hash === before.hash || writeback.status === '受阻待确认') {
      state = transitionState(state, 'AWAITING_USER', {
        taskHash: after.hash,
        lastError: after.hash === before.hash ? 'CLAUDE_DID_NOT_UPDATE_TASK_DOCUMENT' : 'CLAUDE_REPORTED_BLOCKED',
      });
      writeState(this.statePath, state);
      return { action: 'claude_needs_user', state };
    }
    if (writeback.status !== '自动化验证通过，待用户验收') {
      state = transitionState(state, 'AWAITING_USER', { taskHash: after.hash, lastError: 'CLAUDE_WRITEBACK_STATUS_INVALID' });
      writeState(this.statePath, state);
      return { action: 'claude_writeback_invalid', state };
    }

    const checks = await this.checkRunner(this.workbenchDir, this.autoMotionDir);
    const testResults = checks.map((item) => ({ name: item.name, ...compactResult(item) }));
    this.log(`round-${state.round + 1}-checks`, testResults);
    state = { ...state, taskHash: after.hash, testResults };
    if (!checksPassed(checks)) {
      const nextRound = state.round + 1;
      if (nextRound >= state.maxRounds) {
        state = transitionState(state, 'AWAITING_USER', { round: nextRound, feedback: checksFeedback(checks), lastError: 'MAX_ROUNDS_AFTER_TEST_FAILURE' });
      } else {
        state = transitionState(state, 'CHANGES_REQUESTED', { round: nextRound, feedback: checksFeedback(checks), lastError: null });
      }
      writeState(this.statePath, state);
      return { action: 'checks_failed', state };
    }

    state = transitionState(state, 'READY_FOR_CODEX_REVIEW', { feedback: [], lastError: null });
    writeState(this.statePath, state);
    return { action: 'claude_completed', state };
  }

  async runCodexStep(initialState) {
    let state = transitionState(initialState, 'CODEX_REVIEWING', { lastError: null });
    writeState(this.statePath, state);
    const outputFile = join(this.runtimeDir, `codex-review-round-${state.round + 1}.json`);
    rmSync(outputFile, { force: true });
    const result = await this.codexRunner(buildCodexPrompt(state), {
      schemaFile: this.schemaFile,
      outputFile,
      workbenchDir: this.workbenchDir,
      autoMotionDir: this.autoMotionDir,
    });
    const codexLog = this.log(`round-${state.round + 1}-codex`, compactResult(result));
    if (result.exitCode !== 0 || result.timedOut || !existsSync(outputFile)) {
      state = transitionState(state, 'AWAITING_USER', {
        codex: { ...compactResult(result), logPath: codexLog },
        lastError: 'CODEX_REVIEW_PROCESS_FAILED',
      });
      writeState(this.statePath, state);
      return { action: 'codex_failed', state };
    }

    let review;
    try {
      review = validateReview(JSON.parse(readFileSync(outputFile, 'utf8')));
    } catch (error) {
      state = transitionState(state, 'AWAITING_USER', {
        codex: { ...compactResult(result), logPath: codexLog },
        lastError: `CODEX_REVIEW_INVALID:${error.message}`,
      });
      writeState(this.statePath, state);
      return { action: 'codex_invalid', state };
    }

    const doc = writeCodexReview(this.taskFile, review, this.clock());
    state = { ...state, taskHash: doc.hash, codex: { decision: review.decision, summary: review.summary, findings: review.findings, logPath: codexLog } };
    if (review.decision === 'approved') {
      state = transitionState(state, 'APPROVED');
    } else if (review.decision === 'blocked') {
      state = transitionState(state, 'AWAITING_USER', { lastError: 'CODEX_REVIEW_BLOCKED' });
    } else {
      const nextRound = state.round + 1;
      const feedback = review.findings.map((item) => `${item.severity} ${item.title}: ${item.requiredChange}`);
      if (nextRound >= state.maxRounds) {
        state = transitionState(state, 'AWAITING_USER', { round: nextRound, feedback, lastError: 'MAX_REVIEW_ROUNDS_REACHED' });
      } else {
        state = transitionState(state, 'CHANGES_REQUESTED', { round: nextRound, feedback, lastError: null });
      }
    }
    writeState(this.statePath, state);
    return { action: 'codex_reviewed', review, state };
  }
}

export function createDefaultOrchestrator({ projectRoot, autoMotionDir, taskFile }) {
  const runtimeDir = join(projectRoot, 'runtime', 'collaboration');
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return new CollaborationOrchestrator({
    taskFile,
    statePath: join(runtimeDir, 'collaboration-state.json'),
    lockPath: join(runtimeDir, 'orchestrator.lock'),
    runtimeDir,
    workbenchDir: projectRoot,
    autoMotionDir,
    schemaFile: join(moduleDir, 'codex-review.schema.json'),
  });
}
