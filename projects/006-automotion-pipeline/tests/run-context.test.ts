import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunContext } from '../src/run/run-context.js';

const dirs: string[] = [];

function tempBase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'automotion-run-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('RunContext', () => {
  it('creates run directory and task.json', () => {
    const ctx = RunContext.create(tempBase(), 'AI Agent 入门', '面向程序员');
    expect(existsSync(ctx.taskPath())).toBe(true);
    expect(existsSync(ctx.runDir)).toBe(true);
    const task = JSON.parse(readFileSync(ctx.taskPath(), 'utf8'));
    expect(task.topic).toBe('AI Agent 入门');
    expect(task.angle).toBe('面向程序员');
    expect(task.runMode).toBe('normal');
    expect(task.runId).toMatch(/^run-\d+$/);
  });

  it('loads an existing run context', () => {
    const base = tempBase();
    const created = RunContext.create(base, '主题A');
    const loaded = RunContext.load(created.runDir);
    expect(loaded.task.topic).toBe('主题A');
    expect(loaded.task.runId).toBe(created.task.runId);
    expect(loaded.task.paths.draft).toContain('codex_draft.json');
  });

  it('persists runMode changes', () => {
    const ctx = RunContext.create(tempBase(), '主题B');
    ctx.setRunMode('fallback_flash_glm');
    const reloaded = RunContext.load(ctx.runDir);
    expect(reloaded.task.runMode).toBe('fallback_flash_glm');
  });

  it('creates distinct paths per artifact', () => {
    const ctx = RunContext.create(tempBase(), '主题C');
    const { draft, review, verdict, state } = ctx.task.paths;
    expect(new Set([draft, review, verdict, state]).size).toBe(4);
  });
});
