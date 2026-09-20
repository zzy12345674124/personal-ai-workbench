import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CollaborationOrchestrator } from '../server/collaboration/orchestrator.js';
import { readState, transitionState, writeState } from '../server/collaboration/state.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'collaboration-orchestrator-'));
  const taskFile = join(root, 'task.md');
  const runtimeDir = join(root, 'runtime');
  writeFileSync(taskFile, `# 任务

## Claude 执行回填

- 状态：\`待 Claude 执行\`
- [ ] 任务 1：实现

## Codex 复核

- 复核状态：\`待 Claude 回填\`
`, 'utf8');
  return {
    root,
    taskFile,
    runtimeDir,
    statePath: join(runtimeDir, 'state.json'),
    lockPath: join(runtimeDir, 'orchestrator.lock'),
    schemaFile: join(root, 'review.schema.json'),
  };
}

function passingChecks() {
  return [
    { name: '008 npm test', exitCode: 0, timedOut: false, stdout: 'ok', stderr: '' },
    { name: '006 npm run build', exitCode: 0, timedOut: false, stdout: 'ok', stderr: '' },
    { name: '006 npm test', exitCode: 0, timedOut: false, stdout: 'ok', stderr: '' },
  ];
}

describe('collaboration orchestrator', () => {
  it('Claude 回填并通过本地检查后才进入 Codex 审核', async () => {
    const fixture = makeFixture();
    const claudeRunner = vi.fn(async () => {
      const text = readFileSync(fixture.taskFile, 'utf8')
        .replace('待 Claude 执行', '自动化验证通过，待用户验收')
        .replace('- [ ] 任务 1', '- [x] 任务 1');
      writeFileSync(fixture.taskFile, text, 'utf8');
      return { exitCode: 0, timedOut: false, stdout: '{}', stderr: '' };
    });
    const orchestrator = new CollaborationOrchestrator({
      ...fixture,
      workbenchDir: fixture.root,
      autoMotionDir: join(fixture.root, '006'),
      claudeRunner,
      codexRunner: vi.fn(),
      checkRunner: vi.fn(async () => passingChecks()),
    });
    orchestrator.initialize();
    const result = await orchestrator.runOne();
    expect(result.action).toBe('claude_completed');
    expect(readState(fixture.statePath).status).toBe('READY_FOR_CODEX_REVIEW');
  });

  it('Codex 结构化通过后写回审核区并结束', async () => {
    const fixture = makeFixture();
    const claudeRunner = async () => {
      writeFileSync(fixture.taskFile, readFileSync(fixture.taskFile, 'utf8').replace('待 Claude 执行', '自动化验证通过，待用户验收'), 'utf8');
      return { exitCode: 0, timedOut: false, stdout: '{}', stderr: '' };
    };
    const codexRunner = vi.fn(async (_prompt, options) => {
      writeFileSync(options.outputFile, JSON.stringify({ decision: 'approved', summary: '合同与测试均通过', findings: [] }), 'utf8');
      return { exitCode: 0, timedOut: false, stdout: '{}', stderr: '' };
    });
    const orchestrator = new CollaborationOrchestrator({
      ...fixture,
      workbenchDir: fixture.root,
      autoMotionDir: join(fixture.root, '006'),
      claudeRunner,
      codexRunner,
      checkRunner: async () => passingChecks(),
      clock: () => '2026-08-11T12:00:00.000Z',
    });
    orchestrator.initialize();
    await orchestrator.runOne();
    const result = await orchestrator.runOne();
    expect(result.review.decision).toBe('approved');
    expect(readState(fixture.statePath).status).toBe('APPROVED');
    expect(readFileSync(fixture.taskFile, 'utf8')).toContain('复核状态：`复核通过`');
  });

  it('本地检查失败时不消耗 Codex 审核轮次，直接要求 Claude 返工', async () => {
    const fixture = makeFixture();
    const codexRunner = vi.fn();
    const orchestrator = new CollaborationOrchestrator({
      ...fixture,
      workbenchDir: fixture.root,
      autoMotionDir: join(fixture.root, '006'),
      claudeRunner: async () => {
        writeFileSync(fixture.taskFile, readFileSync(fixture.taskFile, 'utf8').replace('待 Claude 执行', '自动化验证通过，待用户验收'), 'utf8');
        return { exitCode: 0, timedOut: false, stdout: '{}', stderr: '' };
      },
      codexRunner,
      checkRunner: async () => [{ name: '008 npm test', exitCode: 1, timedOut: false, stdout: '', stderr: 'failed' }],
    });
    orchestrator.initialize();
    const result = await orchestrator.runOne();
    expect(result.action).toBe('checks_failed');
    expect(readState(fixture.statePath)).toMatchObject({ status: 'CHANGES_REQUESTED', round: 1 });
    expect(codexRunner).not.toHaveBeenCalled();
  });

  it('Claude 没有回填文档时暂停等待用户，不继续审核', async () => {
    const fixture = makeFixture();
    const orchestrator = new CollaborationOrchestrator({
      ...fixture,
      workbenchDir: fixture.root,
      autoMotionDir: join(fixture.root, '006'),
      claudeRunner: async () => ({ exitCode: 0, timedOut: false, stdout: '{}', stderr: '' }),
      codexRunner: vi.fn(),
      checkRunner: vi.fn(),
    });
    orchestrator.initialize();
    const result = await orchestrator.runOne();
    expect(result.action).toBe('claude_needs_user');
    expect(readState(fixture.statePath)).toMatchObject({ status: 'AWAITING_USER', lastError: 'CLAUDE_DID_NOT_UPDATE_TASK_DOCUMENT' });
  });

  it('用户授权后可从受阻状态恢复到最后一轮 Claude 执行', () => {
    const fixture = makeFixture();
    const orchestrator = new CollaborationOrchestrator({
      ...fixture,
      workbenchDir: fixture.root,
      autoMotionDir: join(fixture.root, '006'),
      claudeRunner: vi.fn(),
      codexRunner: vi.fn(),
      checkRunner: vi.fn(),
    });
    const initial = orchestrator.initialize();
    const running = transitionState(initial, 'CLAUDE_RUNNING');
    const waiting = transitionState(running, 'AWAITING_USER', { round: 1, feedback: ['修复已授权'] });
    writeState(fixture.statePath, waiting);

    const result = orchestrator.resumeForClaude();
    expect(result.action).toBe('resumed_for_claude');
    expect(readState(fixture.statePath)).toMatchObject({
      status: 'READY_FOR_CLAUDE',
      round: 2,
      feedback: ['修复已授权'],
      lastError: null,
    });
  });

  it('用户额外授权后可扩展轮次并恢复 Claude 执行', () => {
    const fixture = makeFixture();
    const orchestrator = new CollaborationOrchestrator({
      ...fixture,
      workbenchDir: fixture.root,
      autoMotionDir: join(fixture.root, '006'),
      claudeRunner: vi.fn(),
      codexRunner: vi.fn(),
      checkRunner: vi.fn(),
    });
    const initial = orchestrator.initialize();
    const running = transitionState(initial, 'CLAUDE_RUNNING');
    const waiting = transitionState(running, 'AWAITING_USER', { round: 3, maxRounds: 3, feedback: ['审核返工'] });
    writeState(fixture.statePath, waiting);

    const result = orchestrator.extendForClaude(1);
    expect(result.action).toBe('extended_for_claude');
    expect(readState(fixture.statePath)).toMatchObject({
      status: 'READY_FOR_CLAUDE',
      round: 3,
      maxRounds: 4,
      feedback: ['审核返工'],
      lastError: null,
    });
  });
});
