// web/app.js —— 工作台主框架
// Task 8：全屏导航 + FAB + Logo 乱码 接线（brief Step 3 追加的 import）
import { mountNavFullscreen } from './nav-fullscreen.js';
import { mountFab } from './fab.js';
import { mountWelcome } from './welcome.js';
import { esc } from './editor/editor-ui.js';

const nav = document.getElementById('toolNav');
const stage = document.getElementById('stage');
const dot = document.getElementById('statusDot');

export const workbench = {
  tools: [],
  current: null,
  api: async (path, opts = {}) => {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    return r.json();
  },
  switchTool(id, force = false) {
    const tool = workbench.tools.find((t) => t.id === id);
    // force=true 允许重渲染当前面板（刷新按钮/历史查看用）——修复同面板守卫拦截刷新
    if (!tool || (!force && workbench.current === id)) return;
    window.dispatchEvent(new CustomEvent('workbench:tool-switch', { detail: { from: workbench.current, to: id } }));
    workbench.current = id;
    // 审查修复（Critical #1）：切换面板先清空 FAB 动作，防止上一面板动作残留
    // （assets/sessions 不调 setFabActions → stale 闭包会在已替换的 stage 上 querySelector 抛错）
    workbench.setFabActions([]);
    document.querySelectorAll('#toolNav a').forEach((a) => {
      const active = a.dataset.id === id;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    stage.innerHTML = '<div class="placeholder">加载中…</div>';
    import(`./${tool.panel}`).then((m) => m.render(stage, workbench))
      .catch((e) => { stage.innerHTML = `<div class="card error-card"><h2>${esc(tool.name)} 面板加载失败</h2><pre>${esc(e.message)}</pre></div>`; });
  },
};

// Task 8 接线所需：ES module 顶层 export 不会挂到 window，先显式挂载（brief Step 3 的 window.workbench.* 依赖它）
window.workbench = workbench;

async function init() {
  let toolsRes;
  try {
    const response = await fetch('tools.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    toolsRes = await response.json();
    if (!Array.isArray(toolsRes.tools) || !toolsRes.tools.length) throw new Error('工具注册表为空');
  } catch (error) {
    stage.innerHTML = `<div class="card error-card"><h2>工作台启动失败</h2><pre>${esc(error.message)}</pre></div>`;
    dot.classList.add('warn');
    dot.title = '工具注册表读取失败';
    return;
  }
  let health = { ok: false };
  try { health = await workbench.api('/api/health'); } catch { /* 导航仍可加载，状态点标记异常 */ }
  workbench.tools = toolsRes.tools;
  nav.innerHTML = toolsRes.tools
    .map((t) => `<a data-id="${esc(t.id)}" role="button" tabindex="0"><span class="tool-icon" aria-hidden="true">${esc(t.icon)}</span><span class="tool-label">${esc(t.name)}</span><span class="tool-chevron" aria-hidden="true">›</span></a>`)
    .join('');
  nav.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => workbench.switchTool(a.dataset.id));
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        workbench.switchTool(a.dataset.id);
      }
    });
    // 2026-08-06（用户反馈）：素材拖拽中无法点击侧栏——侧栏项作为拖放目标：
    // 拖素材到任意导航项 → 切面板 + 素材经 workbench.pendingScene 交给目标面板
    a.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-scene')) e.preventDefault();
    });
    a.addEventListener('drop', (e) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/x-scene');
      if (!raw) return;
      // pendingScenes 是素材面板与视频面板的统一队列协议；单槽 pendingScene 会在连续拖放时丢数据，
      // 且 video.js 已只消费 pendingScenes。导航重构时一并收口，保持侧栏拖放可用。
      try { (workbench.pendingScenes ??= []).push(JSON.parse(raw)); } catch { return; }
      workbench.switchTool(a.dataset.id);
    });
  });
  dot.classList.add(health.ok ? 'ok' : 'warn');
  dot.title = health.ok ? 'server 在线' : 'server 异常';
  // 顶栏刷新按钮（2026-08-06 用户指示）：重新渲染当前面板（视频面板会恢复轮询最新阶段）
  document.getElementById('btnRefresh').addEventListener('click', () => {
    if (workbench.current) workbench.switchTool(workbench.current, true);
  });

  // ── Task 8 接线（brief Step 3 追加代码）──
  // 偏离说明：mountNavFullscreen 挂载时一次性渲染菜单项（无 re-render 接口），
  // 必须放在 tools.json 加载之后执行，故置于 init() 内而非文件末尾；
  // 变量名 nav → navFS：与模块顶层的侧栏 nav 重名会直接语法错误。
  const fab = mountFab(document.getElementById('fabHost'));
  window.workbench.fab = fab;
  const navFS = mountNavFullscreen(document.getElementById('navHost'), {
    actions: workbench.tools,
    onSelect: (id) => workbench.switchTool(id),
  });
  // 乱码文字效果已从顶栏移除（2026-08-06 用户指示）：scrambleText 保留在
  // web/vendor/scramble.js，预留欢迎界面使用，勿删。
  // 面板注册 FAB 动作的接口
  window.workbench.setFabActions = (list) => fab.setActions(list);

  // 欢迎界面（2026-08-08 优化）：首次加载全屏覆盖，一句欢迎语 + 自动淡出（无交互入口）；
  // 默认行为不变——下方仍进第一个工具，浮层淡出后即见
  mountWelcome();
  workbench.switchTool(toolsRes.tools[0].id);
}

init().catch((error) => {
  stage.innerHTML = `<div class="card error-card"><h2>工作台初始化失败</h2><pre>${esc(error.message)}</pre></div>`;
  dot.classList.add('warn');
});
