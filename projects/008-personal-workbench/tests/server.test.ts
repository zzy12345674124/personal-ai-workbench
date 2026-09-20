// tests/server.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..');
let child: ReturnType<typeof spawn>;
let port = 0;

beforeAll(async () => {
  // 占用一个临时端口
  const net = await import('node:net');
  const srv = net.createServer();
  await new Promise<void>((res) => srv.listen(0, '127.0.0.1', () => res()));
  port = (srv.address() as { port: number }).port;
  await new Promise<void>((res) => srv.close(() => res()));
  child = spawn(process.execPath, [join(ROOT, 'server/server.js')], {
    env: { ...process.env, PORT: String(port), VIBE_ASSETS_DIR: join(mkdtempSync(join(tmpdir(), 'wb-')), 'assets') },
    stdio: 'pipe',
  });
  await new Promise<void>((res) => setTimeout(res, 800));
});

afterAll(() => { child?.kill(); });

describe('server smoke', () => {
  it('GET / 返回 200 且为 html', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    expect(r.status).toBe(200);
    expect((await r.text()).includes('<html')).toBe(true);
  });
  it('GET /api/health 返回 ok:true', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    const j = (await r.json()) as { ok: boolean; data: { server: boolean } };
    expect(j.ok).toBe(true);
    expect(j.data.server).toBe(true);
  });
  it('GET /api/collector/capabilities 暴露采集能力且不依赖大模型', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/collector/capabilities`);
    const j = (await r.json()) as {
      ok: boolean; data: { aiRequired: boolean; platforms: Array<{ platform: string; ready: boolean }> };
    };
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.data.aiRequired).toBe(false);
    expect(j.data.platforms).toContainEqual({ platform: 'douyin', ready: true });
  });
  it('GET /api/video/open-dir 非法 runId 返回 404（防穿越，不触发资源管理器）', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/video/open-dir?id=../evil`);
    expect(r.status).toBe(404);
    const j = (await r.json()) as { ok: boolean };
    expect(j.ok).toBe(false);
  });
});
