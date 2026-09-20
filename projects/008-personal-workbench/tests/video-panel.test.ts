// tests/video-panel.test.ts —— web/panels/video.js 提交负载构造（纯函数，不启动浏览器）
// 第 4 轮 Codex P1 回归：localStorage 无配置 → 实际序列化请求体不得含 templateConfig:null——
// JSON.stringify 会保留该字段，服务端按合同将「字段存在但无效」判 400 BAD_TEMPLATE_CONFIG，
// 导致首次使用/损坏回退无法生成默认快照。修复后仅在已选配置非空时追加字段。
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildVideoSubmitBody } from '../web/panels/video.js';
import { parseStoredTemplateConfig, TEMPLATE_CONFIG_STORAGE_KEY } from '../web/template-config.js';
import { DEFAULT_TEMPLATE_CONFIG } from '../server/template-config.js';
import { videoRouter } from '../server/bridges/video.js';

// 端到端断言（序列化请求 → router → 默认快照）需要 router 不真 spawn——
// 否则会以真实 AUTOMOTION_DIR 执行 006 文本流水线。同 tests/video-bridge.test.ts 的 mock 模式。
const childProcessMock = vi.hoisted(() => {
  const makeChild = () => {
    const handlers = {};
    const child = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (name, fn) => { (handlers[name] ??= []).push(fn); return child; },
      emit: (name, ...args) => { (handlers[name] ?? []).forEach((fn) => fn(...args)); },
    };
    return child;
  };
  return {
    spawn: vi.fn(() => makeChild()),
    spawnSync: vi.fn(),
    exec: vi.fn(),
    execFile: vi.fn(),
  };
});
vi.mock('node:child_process', () => childProcessMock);

const makeUrl = () => new URL('http://127.0.0.1:8080/api/video/submit');
// node 测试环境无 localStorage：最小 stub 模拟面板读取（键不存在 → getItem 返回 null）
const localStorageMock = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
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
const makeReq = (body) => {
  const req = { method: 'POST', headers: {} };
  req[Symbol.asyncIterator] = async function* () {
    if (body !== undefined) yield Buffer.from(body, 'utf8');
  };
  return req;
};

describe('视频面板提交负载（第 4 轮 P1 回归）', () => {
  it('localStorage 无配置 → 序列化请求体不含 templateConfig 字段 → 服务端写默认快照', async () => {
    childProcessMock.spawn.mockClear();
    // 面板提交路径：parseStoredTemplateConfig(localStorage.getItem(KEY))——键不存在时 getItem 返回 null
    const stored = parseStoredTemplateConfig(localStorageMock.getItem(TEMPLATE_CONFIG_STORAGE_KEY));
    expect(stored).toEqual({ config: null, invalid: false });
    const body = JSON.stringify(buildVideoSubmitBody({
      topic: '主题',
      angle: '',
      sceneDraft: undefined,
      mode: 'fallback',
      timeliness: 'strict',
      timelinessRules: undefined,
      templateConfig: stored.config,
    }));
    // 实际序列化请求不得出现 templateConfig 键（旧缺陷：templateConfig:null 被服务端判「字段存在但无效」→ 400）
    expect(body).not.toContain('templateConfig');
    expect(JSON.parse(body)).not.toHaveProperty('templateConfig');
    const root = mkdtempSync(join(tmpdir(), 'wb-p1-'));
    const res = makeRes();
    await videoRouter(makeReq(body), res, makeUrl(), { runsDir: root });
    expect(res.out.status).toBe(200);
    expect(res.out.body.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(root, res.out.body.data.runId, 'template-config.json'), 'utf8'))).toEqual(DEFAULT_TEMPLATE_CONFIG);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
  });

  it('已选配置时字段照常透传（合法配置经序列化写规范化快照）', async () => {
    childProcessMock.spawn.mockClear();
    const stored = parseStoredTemplateConfig(JSON.stringify({
      schemaVersion: 1, workspaceTitle: '  已选  ', accentColor: '#a1b2c3', workspaceTitleSize: 30,
    }));
    const body = JSON.stringify(buildVideoSubmitBody({
      topic: '主题', angle: '', sceneDraft: undefined, mode: 'fallback', timeliness: 'strict', timelinessRules: undefined,
      templateConfig: stored.config,
    }));
    expect(JSON.parse(body).templateConfig).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '已选', accentColor: '#A1B2C3', workspaceTitleSize: 30,
    });
    const root = mkdtempSync(join(tmpdir(), 'wb-p1b-'));
    const res = makeRes();
    await videoRouter(makeReq(body), res, makeUrl(), { runsDir: root });
    expect(res.out.status).toBe(200);
    expect(JSON.parse(readFileSync(join(root, res.out.body.data.runId, 'template-config.json'), 'utf8')).workspaceTitle).toBe('已选');
  });
});
