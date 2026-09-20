// server/server.js —— 零依赖静态服务 + API 路由
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WEB_DIR, probeAvailability } from './paths.js';
import { loadDotEnv } from './env.js';

loadDotEnv(); // 项目根 .env → process.env（TAVILY_API_KEY 等密钥，2026-08-07）

const PORT = Number(process.env.PORT ?? 8080);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
};

async function serveStatic(req, res, pathname) {
  // 只允许 web/ 目录内，防目录穿越
  const rel = normalize(pathname).replace(/^[/\\]+/, '');
  let file = join(WEB_DIR, rel);
  // 目录请求回退到 index.html（brief 未含该回退；否则 GET / 恒 404，Task 6 前端骨架验收也会踩到）
  if (rel === '' || rel.endsWith('/')) file = join(file, 'index.html');
  if (!file.startsWith(WEB_DIR)) return false;
  let info;
  try { info = await stat(file); } catch { return false; }
  if (!info.isFile()) return false;
  const data = await readFile(file);
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(data);
  return true;
}

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

// 偏离说明（见 task-2-report.md）：bridges/*.js 是 Task 3/4/5 的产出，本任务时尚不存在，
// 故三个 router 采用「存在则动态 import、不存在则 404」的惰性加载；动态 import 失败不会被缓存，
// 后续文件补齐后无需重启服务即生效。其余代码与 brief 原样一致。
async function bridgeRoute(relPath, exportName, req, res, url) {
  try {
    // Windows 下动态 import 必须用 file:// URL（裸盘符路径会抛 ERR_UNSUPPORTED_ESM_URL_SCHEME）
    const mod = await import(pathToFileURL(join(import.meta.dirname, relPath)).href);
    return await mod[exportName](req, res, url);
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND') {
      return json(res, 404, { ok: false, error: 'NOT_FOUND: ' + url.pathname });
    }
    throw e;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const { pathname } = url;
  try {
    if (pathname === '/api/health') return json(res, 200, { ok: true, data: { server: true, ...probeAvailability() } });
    // 素材版本桥（2026-08-08）：必须排在 /api/assets 通配分支之前——
    // /api/assets/versions 同样命中该前缀，若放其后会被 assetsRouter 吞成 404
    if (pathname.startsWith('/api/assets/versions')) return await bridgeRoute('./bridges/asset-versions.js', 'assetVersionsRouter', req, res, url);
    if (pathname.startsWith('/api/assets')) {
      // 最终审查修复（必修 I-1）：路径式预览路由 /api/assets/preview/<name>/<file...>。
      // 素材 HTML 内的相对引用（style.css / gsap.min.js / assets/flair-logo.svg）按 iframe src
      // 的 URL 基址解析；若基址是 /api/assets/preview?path=...，它们会变成 /api/style.css → 404。
      // 改用 /api/assets/preview/<name>/index.html 让基址落到素材目录内。安全约定：
      // ① 用原始 req.url 解析（URL 解析器会把 .. 段提前规范化吞掉，穿越检测失效）；
      // ② name 必须是单一目录段（不含 /、\、.、..）；
      // ③ file 拒绝 . / .. 段（防 baseDir 内歧义解析）；
      // ④ 整体 containment 仍由 assets bridge 的 resolvePreview 白名单最终把关。
      // 校验通过后重写为既有 ?path= 查询式路由复用同一逻辑（该路由保留不动，向后兼容）。
      const rawPath = req.url.split('?')[0];
      const m = rawPath.match(/^\/api\/assets\/preview\/([^/]+)\/(.+)$/);
      if (m) {
        let name, file;
        try { name = decodeURIComponent(m[1]); file = decodeURIComponent(m[2]); }
        catch { return json(res, 400, { ok: false, error: 'ASSETS_PREVIEW: BAD_ENCODING' }); }
        const isDotSeg = (s) => s === '.' || s === '..';
        if (name.includes('/') || name.includes('\\') || isDotSeg(name) || file.split(/[/\\]/).some(isDotSeg)) {
          return json(res, 403, { ok: false, error: 'ASSETS_PREVIEW: FORBIDDEN' });
        }
        const rewritten = new URL(url.href);
        rewritten.pathname = '/api/assets/preview';
        rewritten.search = '?path=' + encodeURIComponent(`${name}/${file}`);
        return await bridgeRoute('./bridges/assets.js', 'assetsRouter', req, res, rewritten);
      }
      return await bridgeRoute('./bridges/assets.js', 'assetsRouter', req, res, url);
    }
    if (pathname.startsWith('/api/sessions')) return await bridgeRoute('./bridges/sessions.js', 'sessionsRouter', req, res, url);
    if (pathname.startsWith('/api/template-preview')) return await bridgeRoute('./bridges/template-preview.js', 'templatePreviewRouter', req, res, url);
    if (pathname.startsWith('/api/voice')) return await bridgeRoute('./bridges/voice.js', 'voiceRouter', req, res, url);
    // 2026-08-23 小红书评论采集
    if (pathname.startsWith('/api/xhs')) return await bridgeRoute('./bridges/xhs.js', 'xhsRouter', req, res, url);
    // 多平台采集公共入口；默认仅报告能力，真实平台需通过实施闸门后显式启用。
    if (pathname.startsWith('/api/collector')) return await bridgeRoute('./bridges/collector.js', 'collectorRouter', req, res, url);
    if (pathname.startsWith('/api/comments')) return await bridgeRoute('./bridges/comments.js', 'commentsRouter', req, res, url);
    if (pathname.startsWith('/api/video')) return await bridgeRoute('./bridges/video.js', 'videoRouter', req, res, url);
    if (await serveStatic(req, res, pathname)) return;
    json(res, 404, { ok: false, error: 'NOT_FOUND: ' + pathname });
  } catch (e) {
    json(res, 500, { ok: false, error: 'SERVER: ' + (e.message ?? String(e)) });
  }
});

server.listen(PORT, HOST, () => console.log(`工作台已启动 http://${HOST}:${PORT}`));
