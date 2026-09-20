// server/bridges/asset-versions.js —— 素材定制版本桥（迷你 DevTools）：命名版本落盘
// asset-versions/<素材名>/<版本id>.json，只读不改素材源文件；素材名/版本 id 白名单防目录穿越。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSET_RE = /^[A-Za-z0-9_\-一-龥]+$/;

export function createAssetVersionsBridge({ versionsDir }) {
  const assetDir = (asset) => {
    if (!ASSET_RE.test(asset)) throw new Error('BAD_ASSET_NAME');
    return join(versionsDir, asset);
  };
  // 偏离说明（brief 参考实现未校验 id，rename/delete 拼接 `${id}.json` 可被 `../` 穿越出素材目录）：
  // 与 asset 同规则校验 id，仅接受生成格式（YYYY-MM-DD-定制-N），不改变公开接口与测试行为
  const versionFile = (asset, id) => {
    if (!ASSET_RE.test(id)) throw new Error('BAD_VERSION_ID');
    return join(assetDir(asset), `${id}.json`);
  };
  // 偏离说明（brief 用 toISOString().slice(0,10)，UTC+8 凌晨 0-8 点会落到昨天，用户感知错位）：
  // 改用本地日期拼 YYYY-MM-DD，id 默认 `YYYY-MM-DD-定制-N` 语义不变
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // 最终审查 FIX-1：nextId 不再按文件数量取号（删中间版本后数量少 1，新 id 会撞现存文件被覆盖）。
  // 改为解析现存 `YYYY-MM-DD-定制-N.json` 文件名取最大 N + 1——id 后缀只增不减，绝不覆盖现存版本。
  const nextId = (asset) => {
    const dir = assetDir(asset);
    let max = 0;
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        const m = /^(\d{4}-\d{2}-\d{2})-定制-(\d+)\.json$/.exec(f);
        if (m) max = Math.max(max, Number(m[2]));
      }
    }
    return `${localToday()}-定制-${max + 1}`;
  };
  return {
    listVersions(asset) {
      const dir = assetDir(asset);
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
        try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; }
      }).filter(Boolean).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    },
    saveVersion(asset, name, patches) {
      const dir = assetDir(asset);
      mkdirSync(dir, { recursive: true });
      const id = nextId(asset);
      const v = { id, asset, name: name || id, createdAt: new Date().toISOString(), patches: Array.isArray(patches) ? patches : [] };
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(v, null, 2), 'utf8');
      return v;
    },
    renameVersion(asset, id, newName) {
      // deferred minors（M-1）：newName 非字符串/空串 → 不落盘（前端已校验，此为服务端防御层）
      if (typeof newName !== 'string' || !newName.trim()) return false;
      const p = versionFile(asset, id);
      if (!existsSync(p)) return false;
      // deferred minors（M-4）：文件损坏（非 JSON）→ 返回 false 不抛错
      let v;
      try { v = JSON.parse(readFileSync(p, 'utf8')); } catch { return false; }
      v.name = newName;
      writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
      return true;
    },
    deleteVersion(asset, id) {
      const p = versionFile(asset, id);
      if (!existsSync(p)) return false;
      rmSync(p);
      return true;
    },
  };
}

// 路由挂载沿用现有模式（sessions/video 同款）：server.js 惰性 import 本 router，
// 路由内局部 json/readBody，与 server.js 的 json(res,...) 签名解耦
export async function assetVersionsRouter(req, res, url) {
  const { ASSET_VERSIONS_DIR } = await import('../paths.js');
  const bridge = createAssetVersionsBridge({ versionsDir: ASSET_VERSIONS_DIR });
  const json = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
  const readBody = async () => { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); };

  if (url.pathname === '/api/assets/versions' && req.method === 'GET') {
    // ?asset=<素材名>：不存在的素材返回空数组；非法名 400
    const asset = url.searchParams.get('asset') ?? '';
    try { return json(200, { ok: true, data: { versions: bridge.listVersions(asset) } }); }
    catch (e) { return json(400, { ok: false, error: e.message }); }
  }
  if (url.pathname === '/api/assets/versions' && req.method === 'POST') {
    const { asset, name, patches } = await readBody();
    try { return json(200, { ok: true, data: { version: bridge.saveVersion(asset, name, patches) } }); }
    catch (e) { return json(400, { ok: false, error: e.message }); }
  }
  if (url.pathname === '/api/assets/versions/rename' && req.method === 'POST') {
    const { asset, id, newName } = await readBody();
    // 最终审查 FIX-3：版本不存在时 404 但 payload 不再恒 {ok:true}——前端据此识别失败（删除/重命名假成功）
    try {
      const ok = bridge.renameVersion(asset, id, newName);
      return json(ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: 'VERSION_NOT_FOUND' });
    }
    catch (e) { return json(400, { ok: false, error: e.message }); }
  }
  if (url.pathname === '/api/assets/versions' && req.method === 'DELETE') {
    const { asset, id } = await readBody();
    try {
      const ok = bridge.deleteVersion(asset, id);
      return json(ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: 'VERSION_NOT_FOUND' });
    }
    catch (e) { return json(400, { ok: false, error: e.message }); }
  }
  json(404, { ok: false, error: 'ASSET_VERSIONS_ROUTE_NOT_FOUND' });
}
