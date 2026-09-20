// server/bridges/assets.js —— 007 素材清单与白名单预览
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

const PARAM_TYPES = new Set(['text', 'number', 'bool', 'color']);

export function createAssetsBridge(baseDir) {
  // 读取素材声明的参数 schema（params.json）——2026-08-08 第三档：面板按 schema 渲染表单。
  // 校验：必须是 {params:[{key,label?,type?,default?,desc?,min?,max?,step?}]}；非法条目过滤。
  function readParams(dir) {
    const p = join(dir, 'params.json');
    if (!existsSync(p)) return [];
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      if (!raw || !Array.isArray(raw.params)) return [];
      return raw.params
        .filter((x) => x && typeof x.key === 'string' && x.key.trim())
        .map((x) => ({
          key: x.key,
          label: typeof x.label === 'string' ? x.label : x.key,
          type: PARAM_TYPES.has(x.type) ? x.type : 'text',
          default: x.default != null ? String(x.default) : '',
          desc: typeof x.desc === 'string' ? x.desc : '',
          ...(x.min != null ? { min: x.min } : {}),
          ...(x.max != null ? { max: x.max } : {}),
          ...(x.step != null ? { step: x.step } : {}),
        }));
    } catch { return []; } // 损坏的 params.json 不阻断素材列表
  }

  function list() {
    const dirs = readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const readme = join(baseDir, d.name, 'README.md');
        return {
          name: d.name,
          readmePreview: existsSync(readme) ? readFileSync(readme, 'utf8').slice(0, 300) : '',
          // Task 9：标记该素材目录是否自带 index.html，供素材预览器决定预览入口
          indexHtml: existsSync(join(baseDir, d.name, 'index.html')),
          // 2026-08-08 参数化第三档：素材声明的参数 schema（面板据此渲染表单）
          params: readParams(join(baseDir, d.name)),
          // 2026-08-08 素材视频化（录制器产物 demo.mp4）：有则前端卡片提供「▶ 演示」播放
          videoUrl: existsSync(join(baseDir, d.name, 'demo.mp4')) ? `/api/assets/preview/${d.name}/demo.mp4` : null,
        };
      });
    const manifestPath = join(baseDir, '..', 'vibe-motion-app', 'portable-manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
    return { dirs, manifest };
  }

  function resolvePreview(relPath) {
    if (!relPath || relPath.includes('\0')) throw new Error('INVALID_PATH');
    const target = resolve(baseDir, relPath);
    if (!target.startsWith(resolve(baseDir) + sep)) throw new Error('FORBIDDEN');
    if (!existsSync(target) || !statSync(target).isFile()) throw new Error('NOT_FOUND');
    return target;
  }

  return { list, resolvePreview, baseDir };
}

export async function assetsRouter(req, res, url) {
  const { createAssetsBridge } = await import('./assets.js');
  const { VIBE_ASSETS_DIR } = await import('../paths.js');
  const bridge = createAssetsBridge(VIBE_ASSETS_DIR);
  const json = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };

  if (url.pathname === '/api/assets/list') {
    try {
      const data = bridge.list();
      json(200, { ok: true, data });
    } catch (e) { json(500, { ok: false, error: 'ASSETS_LIST: ' + e.message }); }
    return;
  }
  if (url.pathname === '/api/assets/preview') {
    const rel = url.searchParams.get('path') ?? '';
    try {
      const file = bridge.resolvePreview(rel);
      const { readFileSync } = await import('node:fs');
      const { extname } = await import('node:path');
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.woff': 'font/woff' };
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch (e) {
      json(e.message === 'FORBIDDEN' ? 403 : 404, { ok: false, error: 'ASSETS_PREVIEW: ' + e.message });
    }
    return;
  }
  json(404, { ok: false, error: 'ASSETS_ROUTE_NOT_FOUND' });
}
