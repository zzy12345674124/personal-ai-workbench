// server/bridges/template-preview.js —— 006 Remotion Studio 状态与手动启动桥 + 实时参数草稿桥
// 固定连接本机 127.0.0.1，固定启动 006 已安装的 Remotion；不接受用户路径或命令参数。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { RUNTIME_DIR } from '../paths.js';
import { normalizeTemplateConfig } from '../template-config.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3108;
const COMPOSITION_ID = 'template-realtime-preview';
// 草稿跨源回传只接受 Remotion Studio 精确 Origin；008 同源请求（无 Origin）也允许（任务书 §2）
const ALLOWED_CROSS_ORIGIN = 'http://127.0.0.1:3108';
const DRAFT_BODY_LIMIT = 8 * 1024;

function probeRemotion({ host, port, timeoutMs = 1500 }) {
  return new Promise((resolve) => {
    const req = request({ host, port, path: '/', method: 'GET', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (body.length < 32_768) body += chunk;
      });
      res.on('end', () => {
        const isRemotion = res.statusCode === 200
          && body.includes('<title>Remotion Studio</title>')
          && body.includes('window.remotion_isStudio = true');
        resolve({ reachable: true, isRemotion });
      });
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', () => resolve({ reachable: false, isRemotion: false }));
    req.end();
  });
}

function spawnDetached(command, args, options) {
  const child = spawn(command, args, { ...options, detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

export function createTemplatePreviewBridge(
  autoMotionDir,
  {
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    platform = process.platform,
    probe = probeRemotion,
    spawnProcess = spawnDetached,
    killByPid = (pid) => execFileSync('taskkill', ['/PID', String(pid), '/T', '/F']),
    netstatOut = () => execFileSync('netstat', ['-ano'], { encoding: 'utf8' }),
    draftPath = join(RUNTIME_DIR, 'template-preview-draft.json'),
  } = {},
) {
  const url = `http://${host}:${port}/`;
  const cliPath = join(autoMotionDir, 'node_modules', '.bin', platform === 'win32' ? 'remotion.cmd' : 'remotion');
  const entryPath = join(autoMotionDir, 'video', 'src', 'remotion-entry.ts');

  async function status() {
    const available = existsSync(cliPath) && existsSync(entryPath);
    const connection = await probe({ host, port });
    return {
      available,
      online: connection.reachable && connection.isRemotion,
      portBusy: connection.reachable && !connection.isRemotion,
      url,
      compositionId: COMPOSITION_ID,
    };
  }

  async function start() {
    const current = await status();
    if (current.online) return { ...current, started: false, alreadyRunning: true };
    if (current.portBusy) throw new Error('PREVIEW_PORT_IN_USE');
    if (!current.available) throw new Error('PREVIEW_NOT_CONFIGURED');

    let child;
    if (platform === 'win32') {
      const command = process.env.ComSpec ?? 'cmd.exe';
      const commandLine = `"${cliPath}" studio --port=${port} --no-open`;
      // 2026-08-11 修复（用户实测「启动预览服务」打不开 Studio）：
      // Node 默认会把 commandLine 内的引号转义成 `\"`，cmd 不认 → 路径被当作字面程序名（`'ount' 不是命令`）。
      // 必须 windowsVerbatimArguments:true 原样传递（本场景命令行含引号；与踩坑日志 2.6 codex 长 prompt
      // 场景相反——那条是不含内部引号的命令行、默认转义无害）
      child = spawnProcess(command, ['/d', '/s', '/c', commandLine], {
        cwd: autoMotionDir,
        windowsHide: true,
        windowsVerbatimArguments: true,
      });
    } else {
      child = spawnProcess(cliPath, ['studio', `--port=${port}`, '--no-open'], {
        cwd: autoMotionDir,
      });
    }

    return { ...current, started: true, alreadyRunning: false, pid: child.pid ?? null };
  }

  // 2026-08-11 用户需求：关闭预览服务——按端口找占用进程杀进程树（固定端口 3108，
  // 不依赖 PID 文件；防残留进程 PID 失效后关不掉）。测试注入 killByPid。
  async function stop() {
    let pid = null;
    try {
      const out = netstatOut();
      for (const line of out.split('\n')) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const cols = line.trim().split(/\s+/);
          pid = cols[cols.length - 1] || null;
          break;
        }
      }
    } catch { /* netstat 失败按未找到处理 */ }
    if (!pid) return { stopped: false, pid: null };
    try {
      killByPid(pid);
      return { stopped: true, pid };
    } catch (error) {
      throw new Error(`PREVIEW_STOP_FAILED: ${error.message}`);
    }
  }

  // 读取实时草稿：文件不存在是正常状态（available:false）；存在但损坏/不合规必须显式报错，
  // 禁止静默回退默认值（任务书 §1/§2）
  async function readDraft() {
    if (!existsSync(draftPath)) return { available: false, config: null };
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(draftPath, 'utf8'));
    } catch {
      throw new Error('BAD_TEMPLATE_CONFIG');
    }
    const config = normalizeTemplateConfig(parsed);
    return { available: true, config };
  }

  // 校验并原子写入实时草稿：先写同目录临时文件再重命名；返回规范化配置
  async function saveDraft(input) {
    const config = normalizeTemplateConfig(input);
    mkdirSync(dirname(draftPath), { recursive: true });
    const tmpPath = `${draftPath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, draftPath);
    return config;
  }

  return { status, start, stop, readDraft, saveDraft };
}

export async function templatePreviewRouter(req, res, url, options = {}) {
  const { AUTOMOTION_DIR } = await import('../paths.js');
  const bridge = createTemplatePreviewBridge(AUTOMOTION_DIR, {
    port: Number(process.env.TEMPLATE_PREVIEW_PORT ?? DEFAULT_PORT),
    // 测试注入临时 draftPath；生产默认 008/runtime/template-preview-draft.json
    ...(options.draftPath ? { draftPath: options.draftPath } : {}),
  });
  const origin = req.headers?.origin;
  // 跨源回传仅接受 Studio 的精确 Origin（第 8 轮 P2 统一策略：GET/POST/OPTIONS 一致）
  const crossOrigin = origin === ALLOWED_CROSS_ORIGIN;
  const corsHeaders = (allowedOrigin) => ({
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  const json = (code, payload) => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    // 允许 Origin 的所有响应（200/400/413/500）都返回精确 ACAO，Studio 才能读到成功与错误体
    if (crossOrigin) Object.assign(headers, corsHeaders(origin));
    res.writeHead(code, headers);
    res.end(JSON.stringify(payload));
  };
  // 统一 Origin 策略（第 8 轮 P2）：draft 的 GET/POST/OPTIONS 一律执行——
  // 无 Origin（008 同源）放行、精确 Studio Origin 放行、其余显式 403（响应不带 ACAO）
  const isDraftRoute = url.pathname === '/api/template-preview/draft';
  if (isDraftRoute && origin !== undefined && origin !== ALLOWED_CROSS_ORIGIN) {
    return json(403, { ok: false, error: 'FORBIDDEN_ORIGIN' });
  }
  // POST 正文上限 8 KiB；超限返回 413，不解析不落盘
  const readBody = async () => {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      chunks.push(chunk);
      total += chunk.length;
      if (total > DRAFT_BODY_LIMIT) throw new Error('BODY_TOO_LARGE');
    }
    return Buffer.concat(chunks).toString('utf8');
  };

  if (isDraftRoute && req.method === 'OPTIONS') {
    res.writeHead(204, crossOrigin ? corsHeaders(origin) : {});
    res.end();
    return;
  }

  if (isDraftRoute && req.method === 'POST') {
    let text;
    try {
      text = await readBody();
    } catch (error) {
      if (error.message === 'BODY_TOO_LARGE') return json(413, { ok: false, error: 'BODY_TOO_LARGE' });
      return json(400, { ok: false, error: 'BAD_TEMPLATE_CONFIG' });
    }
    let parsed;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      return json(400, { ok: false, error: 'BAD_TEMPLATE_CONFIG' });
    }
    try {
      const config = await bridge.saveDraft(parsed);
      return json(200, { ok: true, data: { available: true, config } });
    } catch (error) {
      if (error.message === 'BAD_TEMPLATE_CONFIG') return json(400, { ok: false, error: 'BAD_TEMPLATE_CONFIG' });
      return json(500, { ok: false, error: `TEMPLATE_DRAFT_SAVE: ${error.message}` });
    }
  }

  if (isDraftRoute && req.method === 'GET') {
    try {
      return json(200, { ok: true, data: await bridge.readDraft() });
    } catch (error) {
      // 草稿文件损坏/不合规 → 显式失败，不回退默认值
      return json(500, { ok: false, error: `TEMPLATE_DRAFT_READ: ${error.message}` });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/template-preview/status') {
    try {
      return json(200, { ok: true, data: await bridge.status() });
    } catch (error) {
      return json(500, { ok: false, error: `TEMPLATE_PREVIEW_STATUS: ${error.message}` });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/template-preview/start') {
    try {
      return json(202, { ok: true, data: await bridge.start() });
    } catch (error) {
      const conflict = error.message === 'PREVIEW_PORT_IN_USE';
      const missing = error.message === 'PREVIEW_NOT_CONFIGURED';
      return json(conflict ? 409 : missing ? 503 : 500, { ok: false, error: error.message });
    }
  }

  // 2026-08-11 用户需求：关闭预览服务（停止 3108 上的 Studio 进程树）
  if (req.method === 'POST' && url.pathname === '/api/template-preview/stop') {
    try {
      return json(200, { ok: true, data: await bridge.stop() });
    } catch (error) {
      return json(500, { ok: false, error: error.message });
    }
  }

  return json(404, { ok: false, error: 'TEMPLATE_PREVIEW_ROUTE_NOT_FOUND' });
}
