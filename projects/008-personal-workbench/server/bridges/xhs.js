// server/bridges/xhs.js —— 小红书评论采集桥（工作台面板 → 爬虫 python）
// 启动/停止/状态（进度日志轮询）/+ 关键词二级扩展（Claude CLI + deepseek-v4-flash）
// job 状态保存在内存（进程内单任务），日志/结果在 runs/xhs-comments/
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { syncCommentSources } from '../comment-store.js';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const OUT_DIR = join(PROJECT_ROOT, 'runs', 'xhs-comments');
const PY = process.env.PYTHON ?? 'python';

// AI 成本记账：expand 调用累计（runs/xhs-comments/expand-usage.json——可视化页展示「AI 烧了多少钱」）
function addExpandUsage(tokens) {
  try {
    const p = join(OUT_DIR, 'expand-usage.json');
    let u = { count: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    if (existsSync(p)) u = JSON.parse(readFileSync(p, 'utf8'));
    u.count += 1;
    u.inputTokens += tokens?.inputTokens ?? 0;
    u.outputTokens += tokens?.outputTokens ?? 0;
    u.costUsd = u.inputTokens / 1e6 * 0.0028 + u.outputTokens / 1e6 * 0.0028; // DeepSeek 平峰 0.02 元/M ≈ 0.0028$/M
    writeFileSync(p, JSON.stringify(u, null, 2), 'utf8');
  } catch { /* 记账失败不阻断 */ }
}

// Claude CLI 定位（006 同款：where claude 找 .cmd；Windows CreateProcess 不能直接跑批处理）
function claudePath() {
  try {
    const out = execFileSync('cmd.exe', ['/d', '/s', '/c', 'where claude'], { encoding: 'utf8', windowsHide: true });
    const cmd = out.split(/\r?\n/).find((l) => /\.cmd$/i.test(l.trim()));
    if (cmd) return cmd.trim();
  } catch { /* 回退裸名 */ }
  return 'claude';
}

let current = null; // { jobId, child, startedAt }

export function createXhsBridge({ outDir = OUT_DIR, syncComments = null } = {}) {
  return {
    start(job) {
      if (current && current.child && current.child.exitCode === null) {
        throw new Error('XHS_BUSY'); // 单任务：已有采集在跑
      }
      mkdirSync(outDir, { recursive: true });
      const jobId = `xhs-${Date.now()}`;
      const jobPath = join(outDir, `${jobId}.job.json`);
      writeFileSync(jobPath, JSON.stringify({ ...job, jobId }, null, 2), 'utf8');
      // 清旧日志
      const logPath = join(outDir, `${jobId}.log`);
      // 关键词模式（2026-08-23 搜索链路接入）：urls 空但 keyword 存在 → spawn（job.py 关键词分支）
      writeFileSync(logPath, '', 'utf8');
      const child = spawn(PY, ['scripts/xhs-crawl-job.py', '--job', jobPath], {
        cwd: PROJECT_ROOT, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
      });
      current = { jobId, child, startedAt: new Date().toISOString(), job };
      current.child.on('exit', () => {
        if (current && current.jobId === jobId) current.child = null;
        if (syncComments) {
          try { syncComments(); } catch { /* 打开评论数据面板时会再次增量同步。 */ }
        }
      });
      return { jobId };
    },
    stop() {
      if (!current || !current.child || current.child.exitCode !== null) return { stopped: false };
      // Windows：杀进程树
      spawn('taskkill', ['/PID', String(current.child.pid), '/T', '/F'], { windowsHide: true });
      current.child = null;
      return { stopped: true };
    },
    status(jobId) {
      const logPath = join(outDir, `${jobId}.log`);
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
      const results = existsSync(outDir)
        ? readdirSync(outDir).filter((f) => f.startsWith(`${jobId}-`) || (f.endsWith('.json') && !f.includes('.'))).slice(0, 50)
        : [];
      const running = current && current.jobId === jobId && current.child && current.child.exitCode === null;
      return { jobId, running, log: log.slice(-4000), results };
    },
  };
}

export async function xhsRouter(req, res, url) {
  const bridge = createXhsBridge({ syncComments: () => syncCommentSources() });
  const json = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
  const readBody = async () => { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); };

  if (url.pathname === '/api/xhs/start' && req.method === 'POST') {
    try {
      const job = await readBody();
      // 关键词模式（搜索链路待接入）：urls 允许为空数组（bridge.start 登记任务不 spawn）
      if (!Array.isArray(job.urls)) return json(400, { ok: false, error: 'BAD_JOB' });
      return json(200, { ok: true, data: bridge.start(job) });
    } catch (e) { return json(e.message === 'XHS_BUSY' ? 409 : 500, { ok: false, error: e.message }); }
  }
  if (url.pathname === '/api/xhs/stop' && req.method === 'POST') {
    return json(200, { ok: true, data: bridge.stop() });
  }
  if (url.pathname === '/api/xhs/status' && req.method === 'GET') {
    const jobId = url.searchParams.get('id') ?? '';
    return json(200, { ok: true, data: bridge.status(jobId) });
  }
  if (url.pathname === '/api/xhs/expand' && req.method === 'POST') {
    const { keyword } = await readBody();
    if (!keyword || typeof keyword !== 'string') return json(400, { ok: false, error: 'BAD_KEYWORD' });
    try {
      // 直调 DeepSeek Anthropic 兼容端点（token 从 env，不落日志）；模型名取环境默认 id（端点承认的）
      const base = process.env.ANTHROPIC_BASE_URL ?? 'https://api.deepseek.com/anthropic';
      const token = process.env.ANTHROPIC_AUTH_TOKEN ?? '';
      const model = process.env.ANTHROPIC_DEFAULT_FABLE_MODEL ?? 'deepseek-chat';
      const prompt = `根据一级关键词「${keyword}」生成 8 个二级关键词（小红书内容搜索用）：要求中文、每词 ≤10 字、横向扩展（同领域别名/细分/具体表达），不重复一级词。输出 {\"words\": [\"词1\",...]} JSON。`;
      const resp = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': token, 'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!resp.ok) return json(502, { ok: false, error: `EXPAND_HTTP: ${resp.status}` });
      const j = await resp.json();
      addExpandUsage(j.usage); // 成本记账
      const text = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : '{}');
      const words = Array.isArray(parsed.words) ? parsed.words.filter((w) => typeof w === 'string' && w.trim()).slice(0, 10) : [];
      return json(200, { ok: true, data: { words } });
    } catch (e) {
      return json(500, { ok: false, error: `EXPAND: ${e.message}` });
    }
  }
  json(404, { ok: false, error: 'XHS_ROUTE_NOT_FOUND' });
}
