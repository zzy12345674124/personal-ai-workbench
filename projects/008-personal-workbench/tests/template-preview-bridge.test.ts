import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTemplatePreviewBridge, templatePreviewRouter } from '../server/bridges/template-preview.js';
import { DEFAULT_TEMPLATE_CONFIG } from '../server/template-config.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'template-preview-'));
  mkdirSync(join(root, 'video', 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, 'video', 'src', 'remotion-entry.ts'), 'registerRoot(() => null);');
  writeFileSync(join(root, 'node_modules', '.bin', 'remotion.cmd'), '@echo off');
  return root;
}

describe('template preview bridge', () => {
  it('status 识别在线 Remotion Studio', async () => {
    const bridge = createTemplatePreviewBridge(makeFixture(), {
      platform: 'win32',
      probe: async () => ({ reachable: true, isRemotion: true }),
    });
    await expect(bridge.status()).resolves.toMatchObject({
      available: true,
      online: true,
      portBusy: false,
      compositionId: 'template-realtime-preview',
    });
  });

  it('在线时 start 不重复启动进程', async () => {
    const spawnProcess = vi.fn();
    const bridge = createTemplatePreviewBridge(makeFixture(), {
      platform: 'win32',
      probe: async () => ({ reachable: true, isRemotion: true }),
      spawnProcess,
    });
    await expect(bridge.start()).resolves.toMatchObject({ started: false, alreadyRunning: true });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('离线且配置完整时只启动固定的 006 Studio 命令', async () => {
    const spawnProcess = vi.fn(() => ({ pid: 4321 }));
    const bridge = createTemplatePreviewBridge(makeFixture(), {
      platform: 'win32',
      port: 3108,
      probe: async () => ({ reachable: false, isRemotion: false }),
      spawnProcess,
    });
    await expect(bridge.start()).resolves.toMatchObject({ started: true, pid: 4321 });
    expect(spawnProcess).toHaveBeenCalledOnce();
    const [command, args, options] = spawnProcess.mock.calls[0];
    expect(String(command).toLowerCase()).toContain('cmd');
    expect(args.join(' ')).toContain('studio --port=3108 --no-open');
    expect(options).toMatchObject({ windowsHide: true });
  });

  it('端口被非 Remotion 服务占用时拒绝启动', async () => {
    const bridge = createTemplatePreviewBridge(makeFixture(), {
      platform: 'win32',
      probe: async () => ({ reachable: true, isRemotion: false }),
    });
    await expect(bridge.start()).rejects.toThrow('PREVIEW_PORT_IN_USE');
  });

  it('006 入口或依赖缺失时拒绝启动', async () => {
    const root = mkdtempSync(join(tmpdir(), 'template-preview-missing-'));
    const bridge = createTemplatePreviewBridge(root, {
      platform: 'win32',
      probe: async () => ({ reachable: false, isRemotion: false }),
    });
    await expect(bridge.start()).rejects.toThrow('PREVIEW_NOT_CONFIGURED');
  });
});

describe('template preview draft（只写临时目录）', () => {
  const makeBridge = () => {
    const root = mkdtempSync(join(tmpdir(), 'template-draft-'));
    const draftPath = join(root, 'draft.json');
    return {
      bridge: createTemplatePreviewBridge(makeFixture(), { platform: 'win32', draftPath }),
      draftPath,
    };
  };
  const valid = () => ({ schemaVersion: 1, workspaceTitle: '标题', accentColor: '#007ACC', workspaceTitleSize: 26 });

  it('草稿不存在：available=false, config=null', async () => {
    const { bridge } = makeBridge();
    await expect(bridge.readDraft()).resolves.toEqual({ available: false, config: null });
  });

  it('合法配置原子保存并规范化（去空白/大写/取整）', async () => {
    const { bridge, draftPath } = makeBridge();
    const saved = await bridge.saveDraft({
      schemaVersion: 1,
      workspaceTitle: '  新标题  ',
      accentColor: '#cc0067',
      workspaceTitleSize: 25.6,
    });
    expect(saved).toEqual({ ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '新标题', accentColor: '#CC0067', workspaceTitleSize: 26 });
    expect(existsSync(draftPath)).toBe(true);
    expect(JSON.parse(readFileSync(draftPath, 'utf8'))).toEqual(saved);
    await expect(bridge.readDraft()).resolves.toEqual({ available: true, config: saved });
  });

  it('无效配置不落盘（含已有旧草稿不被覆盖）', async () => {
    const { bridge, draftPath } = makeBridge();
    await expect(bridge.saveDraft({ ...valid(), schemaVersion: 2 })).rejects.toThrow('BAD_TEMPLATE_CONFIG');
    expect(existsSync(draftPath)).toBe(false);
    await bridge.saveDraft(valid());
    const before = readFileSync(draftPath, 'utf8');
    await expect(bridge.saveDraft({ ...valid(), workspaceTitle: '' })).rejects.toThrow('BAD_TEMPLATE_CONFIG');
    expect(readFileSync(draftPath, 'utf8')).toBe(before);
  });

  it('重启式新 bridge 可读旧草稿（持久化到磁盘）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'template-draft-'));
    const draftPath = join(root, 'draft.json');
    const first = createTemplatePreviewBridge(makeFixture(), { platform: 'win32', draftPath });
    const saved = await first.saveDraft({ ...valid(), workspaceTitle: '持久标题', accentColor: '#00aabb', workspaceTitleSize: 30 });
    const second = createTemplatePreviewBridge(makeFixture(), { platform: 'win32', draftPath });
    await expect(second.readDraft()).resolves.toEqual({ available: true, config: saved });
  });

  it('草稿文件损坏时显式报错（不静默回退默认值）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'template-draft-'));
    const draftPath = join(root, 'draft.json');
    mkdirSync(root, { recursive: true });
    writeFileSync(draftPath, '{broken', 'utf8');
    const bridge = createTemplatePreviewBridge(makeFixture(), { platform: 'win32', draftPath });
    await expect(bridge.readDraft()).rejects.toThrow('BAD_TEMPLATE_CONFIG');
  });
});

describe('template preview draft router（CORS 与响应合同）', () => {
  const draftUrl = (pathname = '/api/template-preview/draft') => new URL(`http://127.0.0.1:8080${pathname}`);
  const makeRes = () => {
    const out = { status: 0, headers: {}, body: null };
    return {
      out,
      writeHead(code, headers = {}) {
        out.status = code;
        out.headers = headers;
      },
      end(payload) {
        if (typeof payload === 'string') {
          try { out.body = JSON.parse(payload); } catch { out.body = payload; }
        } else {
          out.body = payload;
        }
      },
    };
  };
  const makeReq = (method, origin, body) => {
    const req = { method, headers: origin ? { origin } : {} };
    req[Symbol.asyncIterator] = async function* () {
      if (body !== undefined) yield Buffer.from(body, 'utf8');
    };
    return req;
  };
  const valid = () => ({ schemaVersion: 1, workspaceTitle: '路由标题', accentColor: '#aa0011', workspaceTitleSize: 28 });

  it('允许 Origin 的 OPTIONS 返回 204 且 ACAO 为精确 Origin（不用 *）', async () => {
    const res = makeRes();
    await templatePreviewRouter(makeReq('OPTIONS', 'http://127.0.0.1:3108'), res, draftUrl(), { draftPath: join(mkdtempSync(join(tmpdir(), 'tc-')), 'd.json') });
    expect(res.out.status).toBe(204);
    expect(res.out.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:3108');
  });

  it('非法 Origin 的 OPTIONS 被拒绝', async () => {
    const res = makeRes();
    await templatePreviewRouter(makeReq('OPTIONS', 'http://evil.example'), res, draftUrl(), { draftPath: join(mkdtempSync(join(tmpdir(), 'tc-')), 'd.json') });
    expect(res.out.status).toBe(403);
  });

  it('非法 Origin 的 POST 被拒绝且不落盘', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const res = makeRes();
    await templatePreviewRouter(makeReq('POST', 'http://evil.example', JSON.stringify(valid())), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(403);
    expect(existsSync(draftPath)).toBe(false);
  });

  it('允许 Origin 的 POST 校验并原子保存，成功响应含规范化配置', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const res = makeRes();
    await templatePreviewRouter(makeReq('POST', 'http://127.0.0.1:3108', JSON.stringify({ ...valid(), workspaceTitle: '  路由标题  ', accentColor: '#aa0011' })), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(200);
    expect(res.out.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:3108');
    expect(res.out.body).toEqual({
      ok: true,
      data: { available: true, config: { ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '路由标题', accentColor: '#AA0011', workspaceTitleSize: 28 } },
    });
    expect(existsSync(draftPath)).toBe(true);
  });

  it('无 Origin 的同源 POST 也允许（008 页面自身）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const res = makeRes();
    await templatePreviewRouter(makeReq('POST', undefined, JSON.stringify(valid())), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(200);
    expect(existsSync(draftPath)).toBe(true);
  });

  it('无效请求返回 400 BAD_TEMPLATE_CONFIG 且不落盘', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const res = makeRes();
    await templatePreviewRouter(makeReq('POST', 'http://127.0.0.1:3108', '{bad json'), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(400);
    expect(res.out.body).toEqual({ ok: false, error: 'BAD_TEMPLATE_CONFIG' });
    expect(existsSync(draftPath)).toBe(false);
  });

  it('POST 正文超 8 KiB 返回 413 BODY_TOO_LARGE', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const res = makeRes();
    const big = JSON.stringify({ ...valid(), workspaceTitle: 'x'.repeat(9 * 1024) });
    await templatePreviewRouter(makeReq('POST', 'http://127.0.0.1:3108', big), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(413);
    expect(res.out.body).toEqual({ ok: false, error: 'BODY_TOO_LARGE' });
    expect(existsSync(draftPath)).toBe(false);
  });

  it('GET 草稿不存在返回 available:false；存在返回 config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const res = makeRes();
    await templatePreviewRouter(makeReq('GET', undefined), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(200);
    expect(res.out.body).toEqual({ ok: true, data: { available: false, config: null } });
    const bridge = createTemplatePreviewBridge(makeFixture(), { platform: 'win32', draftPath });
    await bridge.saveDraft(valid());
    const res2 = makeRes();
    await templatePreviewRouter(makeReq('GET', undefined), res2, draftUrl(), { draftPath });
    expect(res2.out.status).toBe(200);
    expect(res2.out.body).toEqual({ ok: true, data: { available: true, config: { ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '路由标题', accentColor: '#AA0011', workspaceTitleSize: 28 } } });
  });

  // 第 8 轮 P2（Codex）：GET 与 POST/OPTIONS 统一执行精确 Origin 策略；
  // 允许 Origin 的所有响应（200/400/413/500）都返回精确 ACAO，Studio 才能读到错误体
  it('非法 Origin 的 GET 被拒绝（403）且不返回草稿内容', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const bridge = createTemplatePreviewBridge(makeFixture(), { platform: 'win32', draftPath });
    await bridge.saveDraft(valid());
    const res = makeRes();
    await templatePreviewRouter(makeReq('GET', 'http://evil.example'), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(403);
    expect(res.out.body).toEqual({ ok: false, error: 'FORBIDDEN_ORIGIN' });
    expect(res.out.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('允许 Origin 的 GET 成功响应含精确 ACAO', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const bridge = createTemplatePreviewBridge(makeFixture(), { platform: 'win32', draftPath });
    await bridge.saveDraft(valid());
    const res = makeRes();
    await templatePreviewRouter(makeReq('GET', 'http://127.0.0.1:3108'), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(200);
    expect(res.out.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:3108');
    expect(res.out.body).toEqual({
      ok: true,
      data: { available: true, config: { ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '路由标题', accentColor: '#AA0011', workspaceTitleSize: 28 } },
    });
  });

  it('允许 Origin 的 400/413 错误响应含精确 ACAO（Studio 可读错误体）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    const res400 = makeRes();
    await templatePreviewRouter(makeReq('POST', 'http://127.0.0.1:3108', '{bad json'), res400, draftUrl(), { draftPath });
    expect(res400.out.status).toBe(400);
    expect(res400.out.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:3108');
    expect(res400.out.body).toEqual({ ok: false, error: 'BAD_TEMPLATE_CONFIG' });
    const res413 = makeRes();
    const big = JSON.stringify({ ...valid(), workspaceTitle: 'x'.repeat(9 * 1024) });
    await templatePreviewRouter(makeReq('POST', 'http://127.0.0.1:3108', big), res413, draftUrl(), { draftPath });
    expect(res413.out.status).toBe(413);
    expect(res413.out.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:3108');
    expect(res413.out.body).toEqual({ ok: false, error: 'BODY_TOO_LARGE' });
  });

  it('允许 Origin 的 GET 遇损坏草稿返回 500 且含精确 ACAO', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-'));
    const draftPath = join(root, 'd.json');
    writeFileSync(draftPath, '{broken', 'utf8');
    const res = makeRes();
    await templatePreviewRouter(makeReq('GET', 'http://127.0.0.1:3108'), res, draftUrl(), { draftPath });
    expect(res.out.status).toBe(500);
    expect(res.out.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:3108');
    expect(res.out.body).toEqual({ ok: false, error: 'TEMPLATE_DRAFT_READ: BAD_TEMPLATE_CONFIG' });
  });

  it('stop：端口无占用返回 stopped:false 且不调用 killByPid', async () => {
    const killByPid = vi.fn();
    const bridge = createTemplatePreviewBridge(makeFixture(), {
      port: 3108,
      netstatOut: () => 'no such line here\n',
      killByPid,
    });
    await expect(bridge.stop()).resolves.toEqual({ stopped: false, pid: null });
    expect(killByPid).not.toHaveBeenCalled();
  });

  it('stop：端口被占用时杀进程树并返回 PID', async () => {
    const killByPid = vi.fn();
    const bridge = createTemplatePreviewBridge(makeFixture(), {
      port: 3108,
      netstatOut: () => '  TCP    0.0.0.0:3108         0.0.0.0:0              LISTENING       12345\n',
      killByPid,
    });
    await expect(bridge.stop()).resolves.toEqual({ stopped: true, pid: '12345' });
    expect(killByPid).toHaveBeenCalledWith('12345');
  });

  it('stop：killByPid 失败时显式抛错（PREVIEW_STOP_FAILED）', async () => {
    const bridge = createTemplatePreviewBridge(makeFixture(), {
      port: 3108,
      netstatOut: () => '  TCP    0.0.0.0:3108         0.0.0.0:0              LISTENING       12345\n',
      killByPid: () => { throw new Error('denied'); },
    });
    await expect(bridge.stop()).rejects.toThrow('PREVIEW_STOP_FAILED');
  });
});
