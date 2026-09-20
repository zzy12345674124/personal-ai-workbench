// tests/template-preview-panel.test.ts —— web/panels/template-preview.js 草稿轮询生命周期
// 第 4 轮 Codex P2 回归：离开模板面板后轮询必须停止。切换工具时框架只替换
// stage.innerHTML（web/app.js switchTool），stage 本身始终连接、renderSequence 也不变
// （本面板不再渲染）——旧实现用 stage.isConnected 判存活，旧面板会继续每 750ms 请求草稿
// 并更新已脱离页面的节点。修复后存活判断基于本次渲染拥有的根节点 host（被替换即脱离文档）。
// 不启动浏览器：用最小 fake DOM 驱动 render()，vi.useFakeTimers 控制轮询节奏。
// 第 6 轮修复：host/liveEl 捕获必须在 render 之后——setup 的元素由 stage.querySelector 惰性创建，
// render 前 els 尚空，捕获必为 undefined（test:67 「Cannot read properties of undefined」）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../web/panels/template-preview.js';

const makeEl = () => {
  const el = {
    isConnected: true,
    className: '',
    textContent: '',
    hidden: false,
    disabled: false,
    href: '#',
    title: '',
    innerHTML: '',
    replaceChildren: vi.fn(),
    querySelectorAll: () => [],
    // 第 5 轮修复：setBadge（template-preview.js）读取 badge 的 strong/small 子节点赋值
    // （badge.querySelector('strong').textContent）——原 fixture 返回 null 会在 showOnline 时
    // 抛「Cannot set properties of null」；返回假子节点以覆盖在线路径
    querySelector: () => makeEl(),
  };
  // 第 8 轮：登记事件监听，供测试驱动「点击刷新连接」复现在途请求期间的在线刷新
  el.listeners = {};
  el.addEventListener = vi.fn((type, fn) => {
    el.listeners[type] = fn;
  });
  el.click = () => {
    if (el.listeners.click) el.listeners.click();
  };
  return el;
};

const setup = ({ controlledDraft = false } = {}) => {
  const els = {};
  const stage = makeEl();
  stage.querySelector = (sel) => (els[sel] ??= makeEl());
  const calls = [];
  // 第 8 轮：controlledDraft 时草稿请求挂起，由测试手动 resolve——模拟「草稿请求未完成」
  const deferreds = [];
  const wb = {
    api: vi.fn(async (path) => {
      calls.push(path);
      if (path === '/api/template-preview/status') {
        return { ok: true, data: { online: true, url: 'http://127.0.0.1:3108/' } };
      }
      if (path === '/api/template-preview/draft') {
        if (controlledDraft) return new Promise((resolve) => deferreds.push(resolve));
        return { ok: true, data: { available: true, config: { schemaVersion: 1, workspaceTitle: '轮询标题', accentColor: '#123456', workspaceTitleSize: 26 } } };
      }
      return { ok: false, error: 'NOT_FOUND' };
    }),
    deferreds,
  };
  // 2026-08-11 Claude 接手：deferreds 顶层返回（此前只挂在 wb.deferreds，测试顶层解构为
  // undefined → 114 行 deferreds[0] 抛 TypeError）——第 8 轮回归用例的夹具接线修复
  return { stage, els, calls, wb, deferreds };
};

describe('模板面板草稿轮询（第 4 轮 P2 回归）', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  it('面板存活时按 750ms 轮询草稿；面板被替换（host 脱离文档）后不再发起请求、不再改 DOM', async () => {
    vi.useFakeTimers();
    const { stage, els, calls, wb } = setup();
    globalThis.document = { createElement: () => makeEl() };
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    await render(stage, wb); // refreshStatus → showOnline → 启动 750ms 草稿轮询
    // 第 6 轮修复：元素由 setup 的 stage.querySelector 惰性创建（els[sel] ??= makeEl()），
    // 必须在 render 之后取值——此前在 render 前捕获，els 尚空，host/liveEl 均为 undefined，
    // 导致「Cannot read properties of undefined (reading 'innerHTML')」
    const host = els['#templatePreviewHost'];
    const liveEl = els['#templateConfigLive'];
    const draftCalls = () => calls.filter((p) => p === '/api/template-preview/draft').length;
    await vi.advanceTimersByTimeAsync(750);
    expect(draftCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(draftCalls()).toBe(3); // 面板存活期间每 750ms 一轮
    const liveHtmlAtDetach = liveEl.innerHTML;
    // 模拟切换工具：框架替换 stage.innerHTML → 本次渲染的 host 节点脱离文档（stage 仍连接）
    host.isConnected = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(draftCalls()).toBe(3); // 无后续请求（定时器链终止）
    expect(liveEl.innerHTML).toBe(liveHtmlAtDetach); // 不继续改已脱离页面的 DOM
  });

  it('草稿请求未完成时在线刷新：旧请求不能更新状态或再次排期（第 8 轮 P2 回归）', async () => {
    vi.useFakeTimers();
    const { stage, els, calls, wb, deferreds } = setup({ controlledDraft: true });
    globalThis.document = { createElement: () => makeEl() };
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    await render(stage, wb); // 在线 → 启动 750ms 草稿轮询
    const liveEl = els['#templateConfigLive'];
    const refreshButton = els['#templatePreviewRefresh'];
    const draftCalls = () => calls.filter((p) => p === '/api/template-preview/draft').length;

    await vi.advanceTimersByTimeAsync(750); // 首个草稿请求发出并保持挂起（网络未完成）
    expect(draftCalls()).toBe(1);
    const before = liveEl.innerHTML;

    // 草稿请求仍在途时点击「刷新连接」→ refreshStatus → showOnline → 重启轮询（代次递增）
    await vi.advanceTimersByTimeAsync(50);
    refreshButton.click();
    await vi.advanceTimersByTimeAsync(0); // 冲刷 refreshStatus 的 await，新轮询定时器已排

    // 旧请求此刻才返回：代次已失效 → 不得更新状态、finally 不得再次排期
    deferreds[0]({ ok: true, data: { available: true, config: { schemaVersion: 1, workspaceTitle: '过期标题', accentColor: '#0000FF', workspaceTitleSize: 30 } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(liveEl.innerHTML).toBe(before);

    // 只剩新轮询链：每 750ms 一次，无并行复制链（deferreds[0] 已消费，从 1 开始结算）
    let settled = 1;
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(750);
      while (deferreds.length > settled) {
        const resolve = deferreds[settled];
        settled += 1;
        resolve({ ok: true, data: { available: true, config: { schemaVersion: 1, workspaceTitle: '新链', accentColor: '#654321', workspaceTitleSize: 26 } } });
        await vi.advanceTimersByTimeAsync(0);
      }
    }
    expect(draftCalls()).toBe(4); // 1 次过期请求 + 新链 3 次（若旧 finally 复制排期则为 7）
  });
});
