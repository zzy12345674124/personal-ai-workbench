import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readClaudeWriteback, validateReview, writeCodexReview } from '../server/collaboration/document.js';

const TASK_TEXT = `# 协同任务

## Claude 执行回填

- 状态：\`自动化验证通过，待用户验收\`
- [x] 任务 1：完成
- [x] 任务 2：完成

## Codex 复核

- 复核状态：\`待 Claude 回填\`
`;

describe('collaboration document', () => {
  it('只从 Claude 回填区读取状态和完成任务', () => {
    expect(readClaudeWriteback(TASK_TEXT)).toMatchObject({
      status: '自动化验证通过，待用户验收',
      completedTasks: [1, 2],
    });
  });

  it('确定性替换 Codex 复核区且保留 Claude 区', () => {
    const root = mkdtempSync(join(tmpdir(), 'collaboration-doc-'));
    const taskFile = join(root, 'task.md');
    writeFileSync(taskFile, TASK_TEXT, 'utf8');
    writeCodexReview(taskFile, {
      decision: 'changes_requested',
      summary: '需要修复一个问题',
      findings: [{ severity: 'P1', title: '错误', detail: '存在回归', requiredChange: '补测试', file: 'a.js', line: 9 }],
    }, '2026-08-11T10:00:00.000Z');
    const next = readFileSync(taskFile, 'utf8');
    expect(next).toContain('自动化验证通过，待用户验收');
    expect(next).toContain('复核状态：`需返工`');
    expect(next).toContain('P1｜错误');
    expect(next).not.toContain('待 Claude 回填');
  });

  it('通过结论不能携带 P0/P1', () => {
    expect(() => validateReview({
      decision: 'approved',
      summary: '通过',
      findings: [{ severity: 'P1', title: '阻断', detail: '有问题', requiredChange: '修复', file: null, line: null }],
    })).toThrow('APPROVED_REVIEW_HAS_BLOCKING_FINDINGS');
  });
});
