import { mountNavFullscreen } from './nav-fullscreen.js';
import { mountFab } from './fab.js';
import { mountWelcome } from './welcome.js';
import { esc } from './utils.js';
import { publicApi } from './public-api.js';

const nav = document.getElementById('toolNav');
const stage = document.getElementById('stage');
const dot = document.getElementById('statusDot');

export const workbench = {
  tools: [],
  current: null,
  publicMode: true,
  api: publicApi,
  switchTool(id, force = false) {
    const tool = workbench.tools.find((item) => item.id === id);
    if (!tool || (!force && workbench.current === id)) return;
    workbench.current = id;
    workbench.setFabActions([]);
    nav.querySelectorAll('a').forEach((link) => {
      const active = link.dataset.id === id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    stage.innerHTML = '<div class="placeholder">加载中…</div>';
    import(`./${tool.panel}`)
      .then((module) => module.render(stage, workbench))
      .catch((error) => {
        stage.innerHTML = `<div class="card error-card"><h2>${esc(tool.name)} 面板加载失败</h2><pre>${esc(error.message)}</pre></div>`;
      });
  },
};

window.workbench = workbench;

async function init() {
  const response = await fetch('./tools.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`工具注册表读取失败：HTTP ${response.status}`);
  const toolsRes = await response.json();
  if (!Array.isArray(toolsRes.tools) || !toolsRes.tools.length) throw new Error('工具注册表为空');

  workbench.tools = toolsRes.tools;
  nav.innerHTML = toolsRes.tools.map((tool) => `
    <a data-id="${esc(tool.id)}" role="button" tabindex="0">
      <span class="tool-icon" aria-hidden="true">${esc(tool.icon)}</span>
      <span class="tool-label">${esc(tool.name)}</span>
      <span class="tool-chevron" aria-hidden="true">›</span>
    </a>`).join('');

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => workbench.switchTool(link.dataset.id));
    link.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        workbench.switchTool(link.dataset.id);
      }
    });
  });

  dot.classList.add('ok');
  dot.title = '公开浏览模式：界面与本地工作台一致，不执行真实任务';
  document.getElementById('btnRefresh').addEventListener('click', () => {
    if (workbench.current) workbench.switchTool(workbench.current, true);
  });

  const fab = mountFab(document.getElementById('fabHost'));
  workbench.setFabActions = (list) => fab.setActions(list);
  mountNavFullscreen(document.getElementById('navHost'), {
    actions: workbench.tools,
    onSelect: (id) => workbench.switchTool(id),
  });
  mountWelcome();
  workbench.switchTool(toolsRes.tools[0].id);
}

init().catch((error) => {
  stage.innerHTML = `<div class="card error-card"><h2>工作台初始化失败</h2><pre>${esc(error.message)}</pre></div>`;
  dot.classList.add('warn');
});
