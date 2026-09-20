import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, buildCodexArgs, resolveClaudeBin, runCli } from '../src/adapters/cli.js';

const NODE = process.execPath;

describe('buildCodexArgs', () => {
  it('passes schema file path and output file, prompt goes via stdin', () => {
    expect(buildCodexArgs('C:\\schema.json', 'C:\\out.json')).toEqual([
      'exec',
      '--ephemeral',
      '--sandbox', 'read-only',
      '--output-schema', 'C:\\schema.json',
      '--output-last-message', 'C:\\out.json',
      '--skip-git-repo-check',
    ]);
    // 无 outputFile 时不带 --output-last-message
    expect(buildCodexArgs('C:\\schema.json')).not.toContain('--output-last-message');
  });
});

describe('resolveClaudeBin', () => {
  it('returns CLAUDE_BIN when set', () => {
    const prev = process.env.CLAUDE_BIN;
    process.env.CLAUDE_BIN = 'C:\fake\claude.exe';
    try {
      expect(resolveClaudeBin()).toBe('C:\fake\claude.exe');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = prev;
    }
  });

  it('resolves a .cmd path on Windows (or falls back to bare name)', () => {
    const bin = resolveClaudeBin();
    expect(bin.length).toBeGreaterThan(0);
    if (process.platform === 'win32' && bin !== 'claude') {
      expect(bin.toLowerCase()).toMatch(/\.cmd$/);
    }
  });
});

describe('buildClaudeArgs', () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };

  it('defaults to deepseek-v4-flash and serializes schema inline', () => {
    const args = buildClaudeArgs('hi', schema);
    expect(args[1]).toBe('--model');
    expect(args[2]).toBe('deepseek-v4-flash');
    const schemaIndex = args.indexOf('--json-schema');
    expect(schemaIndex).toBeGreaterThan(0);
    expect(JSON.parse(args[schemaIndex + 1] ?? '{}')).toEqual(schema);
    // 2026-08-06 回归防护：prompt 不得出现在命令行参数（cmd /c 上限 8191，长 prompt 走 stdin）
    expect(args).not.toContain('hi');
  });

  it('honors an explicit model override', () => {
    const args = buildClaudeArgs('hi', schema, 'claude-sonnet-5');
    expect(args[2]).toBe('claude-sonnet-5');
  });

  it('passes empty tools as an empty string argument', () => {
    const args = buildClaudeArgs('hi', schema);
    const toolsIndex = args.indexOf('--tools');
    expect(args[toolsIndex + 1]).toBe('');
  });
});

describe('runCli', () => {
  it('captures stdout and exit code on success', async () => {
    const result = await runCli(NODE, ['-e', "console.log('hello')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
    expect(result.timedOut).toBe(false);
  });

  it('reports nonzero exit codes', async () => {
    const result = await runCli(NODE, ['-e', 'process.exit(3)']);
    expect(result.exitCode).toBe(3);
  });

  it('kills the child on timeout', async () => {
    const result = await runCli(NODE, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('writes stdin to the child', async () => {
    const result = await runCli(NODE, ['-e', "process.stdin.on('data', d => process.stdout.write('got:' + d))"], {
      stdin: 'abc',
    });
    expect(result.stdout).toBe('got:abc');
  });

  it('resolves gracefully when the file does not exist', async () => {
    const result = await runCli('C:\\nonexistent\\tool.exe', ['--version']);
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('runs .cmd batch files through cmd.exe /c', async () => {
    const codexCmd = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'codex.cmd') : '';
    if (!codexCmd || !existsSync(codexCmd)) return; // 本机无 codex 时跳过
    const result = await runCli(codexCmd, ['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('codex-cli');
  });
});
