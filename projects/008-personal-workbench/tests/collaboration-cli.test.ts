import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, buildCodexArgs, resolveClaudeBin, resolveCodexBin } from '../server/collaboration/cli.js';

describe('collaboration cli contract', () => {
  it('Claude 只允许本地读写和指定验证命令，明确禁用联网工具', () => {
    const args = buildClaudeArgs('D:\\project_006');
    expect(args).toContain('dontAsk');
    expect(args.join(' ')).toContain('Bash(npm.cmd test*)');
    expect(args.join(' ')).toContain('WebFetch,WebSearch');
    expect(args).not.toContain('bypassPermissions');
  });

  it('Codex 固定只读、结构化输出和临时会话', () => {
    const args = buildCodexArgs({
      schemaFile: 'review.schema.json',
      outputFile: 'review.json',
      workbenchDir: 'D:\\008',
      autoMotionDir: 'D:\\006',
    });
    expect(args).toEqual(expect.arrayContaining(['--ephemeral', '--sandbox', 'read-only', '--output-schema', 'review.schema.json']));
    expect(args.at(-1)).toBe('-');
  });

  it('优先使用显式配置的 CLI 路径', () => {
    expect(resolveClaudeBin({ CLAUDE_BIN: 'X:\\claude.cmd' } as NodeJS.ProcessEnv)).toBe('X:\\claude.cmd');
    expect(resolveCodexBin({ CODEX_BIN: 'X:\\codex.cmd' } as NodeJS.ProcessEnv)).toBe('X:\\codex.cmd');
  });
});
