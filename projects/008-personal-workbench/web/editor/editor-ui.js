// web/editor/editor-ui.js —— 素材编辑器 UI（树/高亮/表单/暂停/保存）
// 零依赖；只操作同源 iframe（/api/assets/preview/...）的 contentDocument，永不修改素材源文件。
// 依赖同目录纯函数：toTree/filterCandidates（候选树）、buildSelector/buildPatch（选择器/补丁）、
// applyPatches（写回 iframe，与渲染注入同一语义）。
import { toTree, filterCandidates } from './editor-tree.js';
import { buildSelector, buildPatch } from './editor-utils.js';
import { applyPatches } from './patch-apply.js';

// ── 内部状态 ──
const state = {
  iframe: null,
  doc: null,
  asset: '',
  wb: null,
  sideEl: null,
  candidates: [],       // NodeInfo[]（filterCandidates(toTree(doc)) 结果，对象引用全程稳定）
  expanded: new Set(),  // 展开节点（按 NodeInfo 对象引用记，懒展开）
  selected: null,       // { info, ancestors, el, selector }
  highlightEl: null,    // 当前高亮的 iframe 元素（悬停，mouseleave 清除）
  edits: [],            // [{selector, prop, value}]（确定保存时一次性 POST）
  onExit: null,
};

// HTML 转义：版本名经 POST/rename 可含任意字符（如 " < >），进入 innerHTML 前必须转义
// 导出：Task 6 版本 UI（assets.js 版本列表/行内输入）复用同一转义，审查 I-1 教训
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 属性表单字段：prop 与补丁契约一致（textContent 直写 / style.X 写 style）
const FIELDS = [
  { prop: 'textContent', label: '文本内容', ph: '输入文本内容' },
  { prop: 'style.color', label: '文字颜色', ph: '如 #ff6b6b / red' },
  { prop: 'style.fontSize', label: '字号', ph: '如 20px' },
  { prop: 'style.background', label: '背景色', ph: '如 #141829' },
  { prop: 'style.borderColor', label: '边框色', ph: '如 #63EAFF' },
  { prop: 'style.width', label: '宽', ph: '如 200px / 50%' },
  { prop: 'style.height', label: '高', ph: '如 200px / 50%' },
];

// ── 动画暂停/恢复（brief 指定脚本；恢复 = 清 inline 值回落样式表 + gsap 继续）──
// 导出（最终审查 FIX-4）：版本预览（assets.js previewVersion）暂停动画后，退出预览时对称恢复，防止素材动画停死
export function pauseAnimations(doc) {
  try { if (doc.defaultView && doc.defaultView.gsap) doc.defaultView.gsap.globalTimeline.pause(); } catch { /* 素材无 gsap */ }
  try { doc.querySelectorAll('*').forEach((el) => { el.style.animationPlayState = 'paused'; }); } catch { /* 遍历失败忽略 */ }
}
export function resumeAnimations(doc) {
  try { if (doc.defaultView && doc.defaultView.gsap) doc.defaultView.gsap.globalTimeline.play(); } catch { /* 素材无 gsap */ }
  try { doc.querySelectorAll('*').forEach((el) => { el.style.animationPlayState = ''; }); } catch { /* 遍历失败忽略 */ }
}

// ── 入口/出口 ──
export function enterEditMode(iframe, asset, wb, sideEl, onExit) {
  exitEditMode(); // 防重入：先恢复上一个会话
  const doc = iframe.contentDocument;
  if (!doc) {
    sideEl.innerHTML = `<div class="card error-card">无法访问素材文档（跨域或未加载完成）</div>`;
    return;
  }
  Object.assign(state, { iframe, doc, asset, wb, sideEl, onExit });
  pauseAnimations(doc);
  state.candidates = filterCandidates(toTree(doc));
  renderPanel();
}

export function exitEditMode() {
  clearHighlight(); // deferred minors（M-3）：退出前先恢复高亮元素的原 outline，防残留
  if (state.doc) resumeAnimations(state.doc);
  state.iframe = state.doc = state.sideEl = state.onExit = null;
  state.candidates = [];
  state.expanded = new Set();
  state.selected = state.highlightEl = null;
  state.edits = [];
}

// ── 面板渲染 ──
function renderPanel() {
  state.sideEl.innerHTML = `
    <div class="card ae-panel-card">
      <div class="ae-panel-heading">
        <span class="ae-panel-title">✏ 素材编辑器</span>
        <button class="btn compact-btn ae-exit">退出编辑</button>
      </div>
      <div class="ae-panel-hint">悬停树节点高亮素材元素；点击节点编辑属性；改动实时预览</div>
      <div id="aeTree" class="ae-tree"></div>
      <div id="aeForm" class="ae-form"></div>
      <div class="ae-panel-actions">
        <button class="btn ae-save">确定保存</button>
        <button class="btn ae-clear">清空修改</button>
        <span id="aeMsg" class="ae-panel-message"></span>
      </div>
      <div id="aeVersions" class="ae-versions"></div>
    </div>`;
  state.sideEl.querySelector('.ae-exit').addEventListener('click', () => {
    const cb = state.onExit;
    exitEditMode();
    if (cb) cb();
  });
  state.sideEl.querySelector('.ae-save').addEventListener('click', saveVersion);
  state.sideEl.querySelector('.ae-clear').addEventListener('click', () => {
    state.edits = [];
    setMsg('已清空修改');
    renderForm();
  });
  renderTree();
  renderForm();
  loadVersions();
}

function setMsg(text) {
  const m = state.sideEl && state.sideEl.querySelector('#aeMsg');
  if (m) m.textContent = text;
}

// ── 候选树渲染（懒展开；行 = tag + #id + .class + 文本摘要）──
function renderTree() {
  const t = state.sideEl.querySelector('#aeTree');
  t.innerHTML = '';
  if (!state.candidates.length) {
    t.innerHTML = `<div class="ae-tree-empty">未找到可编辑元素</div>`;
    return;
  }
  state.candidates.forEach((info) => t.appendChild(nodeRowEl(info, [], 0)));
}

function nodeRowEl(info, ancestors, depth) {
  const row = document.createElement('div');
  row.className = 'ae-node' + (state.selected && state.selected.info === info ? ' selected' : '');
  row.style.paddingLeft = `${4 + depth * 14}px`;
  const hasChildren = info.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'ae-toggle';
  toggle.textContent = hasChildren ? (state.expanded.has(info) ? '▼' : '▶') : '';
  row.appendChild(toggle);

  const tag = document.createElement('span');
  tag.className = 'ae-tag';
  tag.textContent = info.tag;
  row.appendChild(tag);
  if (info.id) {
    const s = document.createElement('span');
    s.className = 'ae-id';
    s.textContent = `#${info.id}`;
    row.appendChild(s);
  }
  if (info.classes.length) {
    const s = document.createElement('span');
    s.className = 'ae-cls';
    const shown = info.classes.slice(0, 3).map((c) => `.${c}`).join('');
    s.textContent = shown + (info.classes.length > 3 ? `+${info.classes.length - 3}` : '');
    row.appendChild(s);
  }
  if (info.text) {
    const s = document.createElement('span');
    s.className = 'ae-text';
    s.textContent = `“${info.text.slice(0, 20)}${info.text.length > 20 ? '…' : ''}”`;
    row.appendChild(s);
  }
  row.title = [info.tag, info.id ? `#${info.id}` : '', ...info.classes.map((c) => `.${c}`)].join(' ').trim();

  if (hasChildren) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.expanded.has(info)) state.expanded.delete(info); else state.expanded.add(info);
      renderTree();
    });
  }
  row.addEventListener('mouseenter', () => highlight(info, ancestors));
  row.addEventListener('mouseleave', clearHighlight);
  row.addEventListener('click', () => selectNode(info, ancestors));
  // 展开的子节点是 row 的兄弟（row 是 flex 容器，不能内嵌）
  const frag = document.createDocumentFragment();
  frag.appendChild(row);
  if (hasChildren && state.expanded.has(info)) {
    info.children.forEach((c) => frag.appendChild(nodeRowEl(c, [...ancestors, info], depth + 1)));
  }
  return frag;
}

// ── 悬停高亮（buildSelector 定位；多元素命中只高亮首个）──
function resolveEl(info, ancestors) {
  try { return state.doc.querySelector(buildSelector(info, ancestors)); } catch { return null; }
}
function highlight(info, ancestors) {
  const el = resolveEl(info, ancestors);
  if (!el) return;
  clearHighlight();
  // deferred minors（M-3）：高亮前把元素自带 inline outline 暂存到 dataset，
  // 清除时恢复原值而非置空——否则高亮会抹掉素材自身的描边样式
  el.dataset.aeOrigOutline = el.style.outline || '';
  el.dataset.aeOrigOutlineOffset = el.style.outlineOffset || '';
  el.style.outline = '3px solid #ff6b6b';
  el.style.outlineOffset = '1px';
  state.highlightEl = el;
}
function clearHighlight() {
  if (state.highlightEl) {
    state.highlightEl.style.outline = state.highlightEl.dataset.aeOrigOutline || '';
    state.highlightEl.style.outlineOffset = state.highlightEl.dataset.aeOrigOutlineOffset || '';
    delete state.highlightEl.dataset.aeOrigOutline;
    delete state.highlightEl.dataset.aeOrigOutlineOffset;
    state.highlightEl = null;
  }
}

// ── 选中 → 属性表单 ──
function selectNode(info, ancestors) {
  const el = resolveEl(info, ancestors);
  if (!el) return;
  state.selected = { info, ancestors, el, selector: buildSelector(info, ancestors) };
  renderTree(); // 刷新选中态高亮
  renderForm();
}

// 树行文本同步（deferred minors M-4）：更新选中行（.selected）的文本摘要 span；
// 编辑前节点无文本 → 行里没有 .ae-text span，重建整棵树补上（展开态按对象引用保留）
function refreshTreeRowText() {
  const row = state.sideEl && state.sideEl.querySelector('.ae-node.selected .ae-text');
  if (row) {
    const t = state.selected.info.text;
    row.textContent = `“${t.slice(0, 20)}${t.length > 20 ? '…' : ''}”`;
  } else {
    renderTree();
  }
}

function renderForm() {
  const f = state.sideEl.querySelector('#aeForm');
  f.innerHTML = '';
  const sel = state.selected;
  if (!sel) {
    f.innerHTML = `<div class="ae-form-empty">点击树节点选中元素 → 在此编辑属性（改动即时生效）</div>`;
    return;
  }
  const head = document.createElement('div');
  head.className = 'ae-form-head';
  head.textContent = `编辑 ${sel.selector}`;
  f.appendChild(head);
  FIELDS.forEach((field) => {
    const wrap = document.createElement('div');
    wrap.className = 'ae-field';
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement('input');
    input.placeholder = field.ph;
    input.value = currentValue(sel.el, field.prop);
    input.addEventListener('input', () => {
      recordEdit(sel.selector, field.prop, input.value);
      applyPatches(state.doc, [{ selector: sel.selector, prop: field.prop, value: input.value }]); // 实时预览
      // deferred minors（M-4）：textContent 编辑后同步树行文本（节点文本摘要），
      // 无文本 span（编辑前为空）则重建树补上
      if (field.prop === 'textContent') {
        sel.info.text = input.value;
        refreshTreeRowText();
      }
    });
    wrap.append(label, input);
    f.appendChild(wrap);
  });
}

function currentValue(el, prop) {
  if (prop === 'textContent') return el.textContent ?? '';
  return el.style[prop.slice(6)] ?? '';
}

// 收集修改：同一 selector+prop 只留最新值（覆盖式）
function recordEdit(selector, prop, value) {
  const i = state.edits.findIndex((e) => e.selector === selector && e.prop === prop);
  if (i >= 0) state.edits[i].value = value;
  else state.edits.push({ selector, prop, value });
  setMsg(state.edits.length ? `已记录 ${state.edits.length} 处修改` : '');
}

// ── 确定保存 → 版本桥 ──
async function saveVersion() {
  if (!state.edits.length) { setMsg('没有修改可保存'); return; }
  setMsg('保存中…');
  try {
    // name 传空字符串 → 服务端生成「YYYY-MM-DD-定制-N」（asset-versions bridge 的 nextId）
    const r = await state.wb.api('/api/assets/versions', {
      method: 'POST',
      body: JSON.stringify(buildPatch(state.asset, '', state.edits)),
    });
    if (r.ok) {
      setMsg(`已保存「${r.data.version.id}」`);
      state.edits = [];
      renderForm(); // 重新预填当前值（仍为编辑后状态）
      loadVersions(); // 刷新版本列表
      // deferred minors（M-3）：通知资产页——若「▼ 版本」面板仍展开则重新拉取（assets.js 监听）
      window.dispatchEvent(new CustomEvent('ae-version-saved'));
    } else {
      setMsg(`保存失败：${r.error || '未知错误'}`);
    }
  } catch (e) {
    setMsg(`保存失败：${e.message}`);
  }
}

// 已保存版本列表（Task 6 将接管的版本管理 UI 的轻量占位；成功后自动刷新）
export async function loadVersions() {
  const box = state.sideEl && state.sideEl.querySelector('#aeVersions');
  if (!box) return;
  try {
    const r = await state.wb.api(`/api/assets/versions?asset=${encodeURIComponent(state.asset)}`);
    const versions = (r.ok ? r.data.versions : []) ?? [];
    box.innerHTML = versions.length
      ? `<div class="ae-saved-heading">已保存版本（${versions.length}）</div>` +
        versions.map((v) =>
          `<div class="ae-saved-row" title="${esc(v.name || '')}">${esc(v.id)} · ${esc(v.name || v.id)}</div>`
        ).join('')
      : '';
  } catch { box.innerHTML = ''; }
}

// 调试/接线入口（app.js 同款模式：ES module 顶层导出不挂 window，显式挂载）
// 第 5 轮授权最小防护：vitest 默认 node 环境无 window——面板回归测试（template-preview-panel /
// video-panel）经 web/panels/*.js 导入本模块取 esc 等纯函数时跳过挂载；浏览器环境行为不变
if (typeof window !== 'undefined') {
  window.assetEditor = { enterEditMode, exitEditMode, loadVersions };
}
