// tests/sessions-bridge.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionsBridge } from '../server/bridges/sessions.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'sb-'));
  writeFileSync(
    join(root, 'session_manager_projects.json'),
    JSON.stringify([{ name: 'project_006', path: 'D:\\x\\project_006', count: 2 }]),
  );
  writeFileSync(
    join(root, 'session_manager_settings.json'),
    JSON.stringify({ dark: true, confirm_delete: false, claude_path: '', close_after_enter: false }),
  );
  mkdirSync(join(root, 'projects', 'D--Count-Obsidian-main'), { recursive: true });
  writeFileSync(join(root, 'projects', 'D--Count-Obsidian-main', 'abc.jsonl'), '{"x":1}\n');
  return root;
}

describe('sessions bridge', () => {
  it('status 返回进程状态、项目列表与最近会话', () => {
    const s = createSessionsBridge(makeFixture()).status();
    expect(s.projects[0].name).toBe('project_006');
    expect(s.recentSessions[0].scope).toBe('D--Count-Obsidian-main');
    expect(typeof s.processRunning).toBe('boolean');
  });
  it('状态文件缺失时防御性返回空数组不崩溃', () => {
    const s = createSessionsBridge(mkdtempSync(join(tmpdir(), 'sb2-'))).status();
    expect(s.projects).toEqual([]);
    expect(s.recentSessions).toEqual([]);
  });
  it('detectProcess 注入 true 时 processRunning 为 true', () => {
    const s = createSessionsBridge(makeFixture(), { detectProcess: () => true }).status();
    expect(s.processRunning).toBe(true);
  });
  it('detectProcess 注入 false 时 processRunning 为 false', () => {
    const s = createSessionsBridge(makeFixture(), { detectProcess: () => false }).status();
    expect(s.processRunning).toBe(false);
  });
  it('projects 不返回 path 字段', () => {
    const s = createSessionsBridge(makeFixture(), { detectProcess: () => false }).status();
    expect(s.projects[0]).toEqual({ name: 'project_006', count: 2 });
    expect('path' in s.projects[0]).toBe(false);
  });
});
