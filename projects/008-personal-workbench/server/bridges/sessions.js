// server/bridges/sessions.js —— 005 会话管家状态只读（字段白名单；不返回路径；进程检测可注入）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

function readJsonSafe(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

// 进程检测默认实现：PowerShell Get-Process 查「会话管家」进程。
// 修复轮 1：tasklist 通配符过滤器（IMAGENAME eq 会话管家*.exe）本机报「无法识别的筛选器」，
// 且 tasklist 输出 GBK 按 utf8 解码成乱码导致 includes 恒 false，故改用 PowerShell 并显式 UTF8。
function defaultDetectProcess() {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; if (Get-Process -Name "会话管家*" -ErrorAction SilentlyContinue) { "1" } else { "0" }'],
      { encoding: 'utf8', windowsHide: true },
    );
    return out.includes('1');
  } catch { return false; }
}

export function createSessionsBridge(claudeDir, { detectProcess = defaultDetectProcess } = {}) {
  function status() {
    // 项目列表：session_manager_projects.json（005 管理数据），形状为 [{name,path,count}]
    // 修复轮 1：仅透出 name/count，path 按「不返回路径」约束移除
    const rawProjects = readJsonSafe(join(claudeDir, 'session_manager_projects.json'));
    const projects = Array.isArray(rawProjects)
      ? rawProjects
          .filter((p) => p && typeof p.name === 'string')
          .map((p) => ({ name: p.name, count: typeof p.count === 'number' ? p.count : 0 }))
      : [];

    const rawSettings = readJsonSafe(join(claudeDir, 'session_manager_settings.json'));
    const settings = rawSettings && typeof rawSettings === 'object'
      ? { dark: Boolean(rawSettings.dark), confirm_delete: Boolean(rawSettings.confirm_delete) }
      : {};

    // 最近会话：.claude/projects/<scope>/ 下最新的 .jsonl（只取文件名与 mtime，不读内容）
    const projectsDir = join(claudeDir, 'projects');
    const recentSessions = [];
    if (existsSync(projectsDir)) {
      for (const scope of readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const scopeDir = join(projectsDir, scope.name);
        const sessions = readdirSync(scopeDir).filter((f) => f.endsWith('.jsonl'));
        if (!sessions.length) continue;
        const newest = sessions
          .map((f) => ({ file: f, mtime: statSync(join(scopeDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)[0];
        recentSessions.push({ scope: scope.name, file: newest.file, modifiedAt: new Date(newest.mtime).toISOString() });
      }
      recentSessions.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
    }

    return { processRunning: detectProcess(), projects: projects.slice(0, 50), settings, recentSessions: recentSessions.slice(0, 20) };
  }
  return { status };
}

export async function sessionsRouter(req, res, url) {
  const { createSessionsBridge } = await import('./sessions.js');
  const { CLAUDE_DIR } = await import('../paths.js');
  const json = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
  if (url.pathname === '/api/sessions/status') {
    try {
      // 进程检测已内聚进 status()（默认 PowerShell 实现，测试可注入），路由只负责组装响应
      const s = createSessionsBridge(CLAUDE_DIR).status();
      json(200, { ok: true, data: s });
    } catch (e) { json(500, { ok: false, error: 'SESSIONS_STATUS: ' + e.message }); }
    return;
  }
  json(404, { ok: false, error: 'SESSIONS_ROUTE_NOT_FOUND' });
}
