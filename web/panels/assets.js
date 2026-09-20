// web/panels/assets.js —— 素材预览器
// 偏离说明 1：007 素材子目录无 README，readmePreview 恒为空字符串，
//   故用「本地化素材」占位，避免卡片摘要留白（父任务约定）。
// 偏离说明 2：assets bridge 的 resolvePreview 只允许文件（目录/空路径一律 404），
//   brief 的 `${entry.name}/` 兜底恒不可用，故无 index.html 的素材改为占位卡提示，不再发 iframe。
// 2026-08-08 轻量版参数化预览：通用 key-value 参数面板 → iframe URL 参数 → 刷新。
// 现有 007 素材为静态 HTML 不读参数（面板对它们无效果）；demo 素材（/params-demo.html）用于验证链路；
// 未来外壳/素材按「支持 URL 参数」标准开发后，面板直接生效。
// 2026-08-08 Task 5 素材编辑器：卡片「✏ 编辑」→ 编辑模式（树/悬停高亮/属性表单/动画暂停/保存到版本桥），
//   编辑 UI 逻辑在 web/editor/editor-ui.js（window.assetEditor 挂载）。
// 2026-08-08 Task 6 版本 UI：卡片「▼ 版本」→ 版本列表（原版/定制版本：预览/添加/重命名/删除），
//   版本预览 = iframe 加载后 applyPatches 写副本；添加 = wb.pendingScene（不自动切面板，与拖拽流程一致）。
import { enterEditMode, esc, pauseAnimations, resumeAnimations } from '../editor/editor-ui.js';
import { applyPatches } from '../editor/patch-apply.js';
let paramRows = [];   // [{key, value}] 自由模式行（素材未声明 schema 时兜底）
let paramSchema = null; // 当前素材声明的参数 schema（params.json，2026-08-08 第三档）
let paramValues = {};   // 表单模式值 {key: value}（初始 = schema default）
let previewBaseSrc = ''; // 当前预览的基础 URL（不含查询参数）
// 最终审查 FIX-4：版本预览暂停动画后记下 doc，任何退出路径先恢复再重建 iframe（防动画停死泄漏）
let pausedPreviewDoc = null;

function paramPanelHtml() {
  return `
    <section class="card asset-inspector-card" id="paramPanel" hidden>
      <div class="section-heading inspector-heading">
        <span class="section-number">03</span>
        <div><h3>参数检查器</h3><p id="paramHint">调整后应用到当前预览。</p></div>
      </div>
      <div id="paramRows"></div>
      <div class="inspector-actions">
        <button class="btn" id="paramAdd" hidden>添加参数</button>
        <button class="btn" id="paramReset" hidden>恢复默认</button>
        <button class="btn btn-primary" id="paramApply">应用到预览</button>
      </div>
    </section>`;
}

function renderParamRows() {
  const rows = document.getElementById('paramRows');
  if (!rows) return;
  // 2026-08-08 自查修复：value 转义（用户自输入进 innerHTML——self-XSS 低危，顺手堵）
  rows.innerHTML = paramRows.map((p, i) =>
    `<div class="param-free-row">
      <input class="param-key" data-k="${i}" value="${esc(p.key)}" placeholder="参数名">
      <input class="param-value" data-v="${i}" value="${esc(p.value)}" placeholder="值">
      <button class="btn compact-icon-btn param-del" data-i="${i}" aria-label="删除参数">✕</button>
    </div>`).join('');
  rows.querySelectorAll('.param-del').forEach((b) =>
    b.addEventListener('click', () => { paramRows.splice(Number(b.dataset.i), 1); renderParamRows(); })
  );
  rows.querySelectorAll('[data-k]').forEach((el) =>
    el.addEventListener('input', () => { paramRows[Number(el.dataset.k)].key = el.value; })
  );
  rows.querySelectorAll('[data-v]').forEach((el) =>
    el.addEventListener('input', () => { paramRows[Number(el.dataset.v)].value = el.value; })
  );
}

// 参数面板总调度（2026-08-08 第三档）：素材声明 schema → 渲染中文标签表单；无 schema → 自由 key=value 模式
function renderParamPanel() {
  const rows = document.getElementById('paramRows');
  const addBtn = document.getElementById('paramAdd');
  const resetBtn = document.getElementById('paramReset');
  const hint = document.getElementById('paramHint');
  if (!rows || !addBtn || !resetBtn || !hint) return;
  if (paramSchema && paramSchema.length) {
    hint.textContent = '（按素材声明的参数调整）';
    addBtn.hidden = true;
    resetBtn.hidden = false;
    rows.innerHTML = paramSchema.map((p) => {
      const label = esc(p.label || p.key);
      const val = paramValues[p.key] ?? p.default ?? '';
      const desc = p.desc ? `<div class="param-desc">${esc(p.desc)}</div>` : '';
      let ctl = '';
      if (p.type === 'number') {
        ctl = `<input class="param-control param-number" type="number" data-param="${esc(p.key)}" value="${esc(val)}"${p.min != null ? ` min="${esc(p.min)}"` : ''}${p.max != null ? ` max="${esc(p.max)}"` : ''}${p.step != null ? ` step="${esc(p.step)}"` : ''}>`;
      } else if (p.type === 'bool') {
        ctl = `<input class="param-check" type="checkbox" data-param="${esc(p.key)}"${val === 'true' || val === true ? ' checked' : ''}>`;
      } else if (p.type === 'color') {
        ctl = `<input class="param-color" type="color" data-param="${esc(p.key)}" value="${esc(val)}">`;
      } else {
        ctl = `<input class="param-control" type="text" data-param="${esc(p.key)}" value="${esc(val)}">`;
      }
      return `<div class="param-schema-row"><label>${label}</label>${ctl}${desc}</div>`;
    }).join('');
    rows.querySelectorAll('[data-param]').forEach((el) =>
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        paramValues[el.dataset.param] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
      })
    );
  } else {
    hint.textContent = '（该素材未声明参数——自由填 key=value 仍可用）';
    addBtn.hidden = false;
    resetBtn.hidden = true;
    renderParamRows();
  }
}

export async function render(stage, wb) {
  window.removeEventListener('ae-version-saved', onVersionSaved); // 防累积：render 开头移除旧监听
  paramRows = []; // 切面板回来不残留上一轮参数行（模块级状态，render 时重置）
  paramSchema = null; // 第三档：schema 与表单值一并重置
  paramValues = {};
  stage.innerHTML = `
    <section class="panel-hero asset-hero">
      <div>
        <span class="panel-eyebrow">MATERIAL LIBRARY</span>
        <h2>挑选、调整，再放进视频。</h2>
        <p>素材本体来自 007；所有定制只保存为 008 的版本补丁，不会改动原件。</p>
      </div>
      <div class="asset-hero-badge"><strong>只读素材源</strong><span>安全编辑</span></div>
    </section>

    <section class="card asset-library-card">
      <div class="section-heading library-heading">
        <span class="section-number">01</span>
        <div><h3>素材库</h3><p>选择卡片预览，也可以直接拖到“视频生成”。</p></div>
      </div>
      <div id="assetList" class="asset-rail"></div>
      <div id="assetVersionsHost"></div>
    </section>

    <div class="asset-notice" id="assetNotice"></div>
    <div class="asset-studio inspector-hidden" id="assetStudio">
      <section class="card asset-preview-card">
        <div class="asset-preview-toolbar">
          <div><span class="section-number">02</span><span><strong id="assetSelectionTitle">预览工作区</strong><small id="assetSelectionMeta">选择上方素材开始</small></span></div>
          <span class="preview-safety">预览副本 · 原件不变</span>
        </div>
        <div id="previewHost" class="asset-preview-host">
          <div class="asset-empty"><span>◇</span><strong>选择一个素材</strong><small>预览、调参、编辑和版本管理都会在这里完成。</small></div>
        </div>
      </section>
      <aside class="asset-inspector">${paramPanelHtml()}</aside>
    </div>`;
  const listEl = stage.querySelector('#assetList');
  const previewHost = stage.querySelector('#previewHost');
  const studio = stage.querySelector('#assetStudio');
  const versionsHost = stage.querySelector('#assetVersionsHost');
  const selectionTitle = stage.querySelector('#assetSelectionTitle');
  const selectionMeta = stage.querySelector('#assetSelectionMeta');
  const assetNotice = stage.querySelector('#assetNotice');
  let r;
  try { r = await wb.api('/api/assets/list'); }
  catch (error) { listEl.innerHTML = `<div class="card error-card">素材清单请求失败：${esc(error.message)}</div>`; return; }
  if (!r.ok) { listEl.innerHTML = `<div class="card error-card">素材清单读取失败：${esc(r.error)}</div>`; return; }
  const { dirs } = r.data;
  listEl.innerHTML = dirs.map((d) => `
    <article class="asset-card" draggable="true" data-name="${esc(d.name)}" tabindex="0" aria-label="预览素材 ${esc(d.name)}">
      <div class="asset-card-top"><span class="asset-glyph">${d.videoUrl ? '▶' : '◇'}</span><span class="asset-kind">${d.videoUrl ? 'HTML + VIDEO' : 'HTML'}</span></div>
      <strong title="${esc(d.name)}">${esc(d.name)}</strong>
      <p>${esc((d.readmePreview || '本地化交互素材').replace(/^#+\s*/gm, '').slice(0, 72))}</p>
      <div class="asset-card-actions">
        <button class="btn ae-add-btn" data-name="${esc(d.name)}">添加</button>
        <button class="btn ae-edit-btn" data-name="${esc(d.name)}">编辑</button>
        ${d.indexHtml ? `<button class="btn ae-ver-btn" data-name="${esc(d.name)}">版本</button>` : ''}
        ${d.videoUrl ? `<button class="btn ae-demo-btn" data-name="${esc(d.name)}">演示</button>` : ''}
      </div>
    </article>`).join('');

  // 2026-08-08：参数化演示入口（验证参数面板 → iframe 链路）
  listEl.innerHTML += `
    <article class="asset-card asset-card-demo" id="paramDemoBtn" tabindex="0" aria-label="打开参数化演示">
      <div class="asset-card-top"><span class="asset-glyph">⌘</span><span class="asset-kind">DEMO</span></div>
      <strong>参数化演示</strong>
      <p>验证 URL 参数与右侧检查器的实时预览链路。</p>
      <div class="asset-card-actions"><button class="btn">打开演示</button></div>
    </article>`;

  // 编辑模式退出：恢复 iframe 动画 + 重建普通预览布局（参数面板可用）
  const exitEditorSafely = () => { try { window.assetEditor?.exitEditMode(); } catch { /* 编辑未激活 */ } };
  // 版本预览退出（最终审查 FIX-4）：恢复被暂停的预览 iframe 动画；与 exitEditorSafely 并列调用，任何重建预览路径都先恢复
  const exitVersionPreview = () => {
    if (pausedPreviewDoc) {
      try { resumeAnimations(pausedPreviewDoc); } catch { /* doc 已失效 */ }
      pausedPreviewDoc = null;
    }
  };
  let activeAssetName = '';
  const selectCard = (name) => {
    listEl.querySelectorAll('.asset-card[data-name]').forEach((card) => card.classList.toggle('active', card.dataset.name === name));
    document.getElementById('paramDemoBtn')?.classList.toggle('active', name === '参数化演示');
  };
  const setSelection = (name, meta = '素材预览') => {
    activeAssetName = name;
    selectionTitle.textContent = name || '预览工作区';
    selectionMeta.textContent = meta;
    selectCard(name);
  };
  const setInspectorVisible = (visible) => studio.classList.toggle('inspector-hidden', !visible);
  const notify = (message) => {
    assetNotice.textContent = message;
    assetNotice.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => assetNotice.classList.remove('show'), 2600);
  };

  const showNoPreview = (name) => {
    setSelection(name, '该素材暂时没有本地预览入口');
    setInspectorVisible(false);
    previewHost.innerHTML = `<div class="asset-empty"><span>—</span><strong>暂无本地预览</strong><small>「${esc(name)}」没有 index.html。</small></div>`;
    document.getElementById('paramPanel').hidden = true;
  };

  const openPreview = (src, name = activeAssetName, meta = '原版素材预览') => {
    exitEditorSafely(); // 若在编辑模式，先恢复旧 iframe 动画再重建预览区
    exitVersionPreview(); // 若在版本预览中，先恢复动画再重建（含「原版」预览路径）
    setSelection(name, meta);
    setInspectorVisible(true);
    previewBaseSrc = src;
    previewHost.innerHTML = `<iframe class="preview" src="${esc(src)}"></iframe>`;
    document.getElementById('paramPanel').hidden = false;
  };

  // 进入编辑模式：左树右 iframe 工作区；iframe load 后再建树（contentDocument 才就绪）
  const openEditor = (entry) => {
    exitEditorSafely();
    exitVersionPreview(); // 版本预览中的 iframe 将被替换，先恢复动画
    setSelection(entry.name, '编辑模式 · 修改只保存为版本补丁');
    setInspectorVisible(false);
    previewBaseSrc = `/api/assets/preview/${encodeURIComponent(entry.name)}/index.html`;
    document.getElementById('paramPanel').hidden = true;
    previewHost.innerHTML = `
      <div class="ae-workspace">
        <div class="ae-side" id="aeSide"></div>
        <iframe class="preview" src="${esc(previewBaseSrc)}"></iframe>
      </div>`;
    const iframe = previewHost.querySelector('iframe');
    iframe.addEventListener('load', () => {
      enterEditMode(iframe, entry.name, wb, document.getElementById('aeSide'), () => openPreview(previewBaseSrc, entry.name));
    }, { once: true });
  };

  listEl.querySelectorAll('[draggable="true"]').forEach((el) => {
    el.addEventListener('click', async () => {
      const entry = dirs.find((d) => d.name === el.dataset.name);
      if (!entry.indexHtml) {
        showNoPreview(entry.name);
        return;
      }
      // 最终审查修复（必修 I-1）：改用路径式预览路由——iframe 按 src 的 URL 基址解析素材 HTML
      // 内的相对引用（style.css 等），?path= 查询式会让它们变成 /api/style.css → 404
      // 2026-08-08 bug 修复：切素材时重置参数状态（防「参数化演示」预填行残留误应用）
      // 第三档：素材声明 schema → 表单模式（初始值 = schema default）；无 → 自由模式
      paramSchema = entry.params?.length ? entry.params : null;
      paramValues = paramSchema
        ? Object.fromEntries(paramSchema.map((p) => [p.key, p.default ?? (p.type === 'bool' ? 'false' : '')]))
        : {};
      paramRows = [];
      renderParamPanel();
      openPreview(`/api/assets/preview/${encodeURIComponent(entry.name)}/index.html`, entry.name);
    });
    el.addEventListener('dragstart', (e) => {
      const entry = dirs.find((d) => d.name === el.dataset.name);
      e.dataTransfer.setData('application/x-scene', JSON.stringify({ type: 'asset', name: entry.name }));
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); }
    });
  });

  // 主操作“添加”：原版素材进入待消费队列，切到视频生成面板后落入场景草稿。
  listEl.querySelectorAll('.ae-add-btn').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = dirs.find((d) => d.name === b.dataset.name);
      if (!entry) return;
      (wb.pendingScenes ??= []).push({ type: 'asset', name: entry.name });
      notify(`已将「${entry.name}」添加到场景草稿`);
    });
  });

  // ▶ 演示按钮（2026-08-08 素材视频化）：播放录制器产物 demo.mp4（隐藏参数面板——视频无参数）
  listEl.querySelectorAll('.ae-demo-btn').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = dirs.find((d) => d.name === b.dataset.name);
      if (!entry?.videoUrl) return;
      exitEditorSafely();
      exitVersionPreview();
      setSelection(entry.name, '录制演示视频 · 循环播放');
      setInspectorVisible(false);
      document.getElementById('paramPanel').hidden = true;
      previewHost.innerHTML = `<video class="preview" src="${esc(entry.videoUrl)}" controls autoplay loop playsinline></video>`;
    });
  });

  // ✏ 编辑按钮：直接进入编辑模式（不经过普通预览；按钮点击不触发卡片预览）
  listEl.querySelectorAll('.ae-edit-btn').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = dirs.find((d) => d.name === b.dataset.name);
      if (!entry.indexHtml) { showNoPreview(entry.name); return; }
      openEditor(entry);
    });
  });

  // ── Task 6 版本管理 UI：▼ 展开版本列表（原版 + 定制版本：预览/添加/重命名/删除 + 新建）──
  // 命名转义（审查 I-1 教训）：版本名可含任意字符，进入 innerHTML 一律 esc()（textContent 赋值天然安全）；
  // 预览补丁经 applyPatches 只作用于 iframe 副本，永不写素材源文件。
  const baseSrc = (entry) => `/api/assets/preview/${encodeURIComponent(entry.name)}/index.html`;
  let versionsPanel = null; // 当前展开的版本面板（单开）
  let versionsSeq = 0;      // 展开序号：防并发 fetch 竞态（旧请求迟到覆盖新面板）

  // 版本预览：iframe 加载完成后对 contentDocument 应用补丁；退出 = 点卡片/「原版」恢复普通预览
  const previewVersion = (entry, v) => {
    exitEditorSafely();
    exitVersionPreview(); // 上一个版本预览先恢复（防连续预览时动画停死）
    setSelection(entry.name, `版本预览 · ${v.name || v.id}`);
    setInspectorVisible(false);
    previewBaseSrc = baseSrc(entry);
    document.getElementById('paramPanel').hidden = true;
    previewHost.innerHTML = `
      <div class="version-preview-layout">
        <div class="version-preview-note">
          <span>版本预览：${esc(v.name || v.id)}（补丁只作用于预览，不写素材文件；点卡片/「原版」恢复普通预览）</span>
          <span id="verPatchMsg"></span>
        </div>
        <iframe class="preview version-preview-frame" src="${esc(previewBaseSrc)}"></iframe>
      </div>`;
    const iframe = previewHost.querySelector('iframe');
    iframe.addEventListener('load', () => {
      try {
        // deferred minors（M-1）：load 竞态防护——预览被替换/关闭后旧 iframe 已脱离 DOM，
        // 迟到的 load 事件不再执行补丁/文案覆盖（避免写进新预览的文档或覆盖新面板文案）
        if (!iframe.isConnected) return;
        // 最终审查 FIX-4：先暂停动画再 applyPatches（与编辑模式同一语义）；退出预览时 exitVersionPreview 恢复
        const doc = iframe.contentDocument;
        if (doc) { pauseAnimations(doc); pausedPreviewDoc = doc; }
        const { applied, skipped } = applyPatches(doc, v.patches ?? []);
        const msg = document.getElementById('verPatchMsg');
        if (msg) msg.textContent = skipped.length
          ? `已应用 ${applied} 处补丁，跳过 ${skipped.length} 处（${skipped[0]}）`
          : `已应用 ${applied} 处补丁`;
      } catch (e) {
        const msg = document.getElementById('verPatchMsg');
        if (msg) msg.textContent = `补丁应用失败：${e.message}`;
      }
    }, { once: true });
  };

  const showVersionsPanel = async (entry, card) => {
    const seq = ++versionsSeq;
    if (versionsPanel) versionsPanel.remove();
    versionsPanel = null;
    // 拉取版本列表（版本桥 GET /api/assets/versions）
    let versions = [];
    let loadErr = '';
    try {
      const r = await wb.api(`/api/assets/versions?asset=${encodeURIComponent(entry.name)}`);
      if (!r.ok) loadErr = r.error || '未知错误';
      else versions = r.data.versions ?? [];
    } catch (e) { loadErr = e.message; }
    if (seq !== versionsSeq) return; // 期间又有新的展开/收起，丢弃本次结果

    const panel = document.createElement('div');
    panel.className = 'asset-version-panel';
    panel.innerHTML = `
      <div class="asset-version-heading">
        <span class="asset-version-title">版本列表 · ${esc(entry.name)}</span>
        <span id="verMsg" class="asset-version-message"></span>
        <button class="btn compact-btn ae-ver-close">收起</button>
      </div>
      <div id="verRows"></div>
      <div class="asset-version-footer">
        <button class="btn ae-ver-new">+ 新建定制版本</button>
      </div>`;
    const rows = panel.querySelector('#verRows');
    const setMsg = (t) => { const m = panel.querySelector('#verMsg'); if (m) m.textContent = t; };

    // 第一行「原版」：点击 → 普通预览（无补丁）
    const origRow = document.createElement('div');
    origRow.className = 'asset-version-row';
    const origName = document.createElement('span');
    origName.className = 'asset-version-name is-clickable';
    origName.textContent = '原版';
    const origTag = document.createElement('span');
    origTag.className = 'asset-version-date';
    origTag.textContent = '无补丁';
    const origBtn = document.createElement('button');
    origBtn.className = 'btn compact-btn';
    origBtn.textContent = '预览';
    // 2026-08-08 用户验收反馈：原版也可直接「添加」进场景草稿（无 version = 原版，兼容旧拖拽流程）
    const origAdd = document.createElement('button');
    origAdd.className = 'btn compact-btn';
    origAdd.textContent = '添加';
    const origActions = document.createElement('div');
    origActions.className = 'asset-version-actions';
    const previewOrig = () => openPreview(baseSrc(entry), entry.name); // 退出版本预览 = 恢复普通预览
    origName.addEventListener('click', previewOrig);
    origBtn.addEventListener('click', previewOrig);
    origAdd.addEventListener('click', () => {
      // 2026-08-08 队列化：pendingScenes 数组（单槽 pendingScene 连续添加会被覆盖——用户实测 bug）
      (wb.pendingScenes ??= []).push({ type: 'asset', name: entry.name });
      setMsg('已添加「原版」到场景草稿（视频生成面板可见）');
    });
    origActions.append(origBtn, origAdd);
    origRow.append(origName, origTag, origActions);
    rows.appendChild(origRow);

    // 行内重命名（页面内输入框 + 确认/取消；Enter 提交 / Esc 取消）
    const startRename = (row, v) => {
      if (row.querySelector('.ae-ver-input')) return;
      const nameEl = row.querySelector('.ae-ver-name');
      const renameBtn = row.querySelector('.ae-ver-rename');
      const wrap = document.createElement('span');
      wrap.className = 'asset-version-rename';
      wrap.innerHTML = `
        <input class="ae-ver-input" value="${esc(v.name || v.id)}" placeholder="新版本名">
        <button class="btn compact-btn ae-ver-ok">确认</button>
        <button class="btn compact-btn ae-ver-cancel">取消</button>`;
      nameEl.replaceWith(wrap);
      renameBtn.hidden = true;
      const input = wrap.querySelector('input');
      const restore = () => {
        const back = document.createElement('span');
        back.className = 'ae-ver-name asset-version-name';
        back.dataset.vid = v.id; // 审查 I-1 修复：与行渲染路径一致保留 data-vid，否则删空判定（querySelector [data-vid]）误判
        back.textContent = v.name || v.id; // textContent 赋值，天然防注入
        back.title = v.name || v.id;
        wrap.replaceWith(back);
        renameBtn.hidden = false;
      };
      const submit = async () => {
        const newName = input.value.trim();
        if (!newName) { setMsg('版本名不能为空'); return; }
        try {
          const r = await wb.api('/api/assets/versions/rename', { method: 'POST', body: JSON.stringify({ asset: entry.name, id: v.id, newName }) });
          if (r.ok) { v.name = newName; restore(); setMsg('版本已重命名'); }
          else setMsg(`重命名失败：${r.error || '未知错误'}`);
        } catch (e) { setMsg(`重命名失败：${e.message}`); }
      };
      wrap.querySelector('.ae-ver-ok').addEventListener('click', submit);
      wrap.querySelector('.ae-ver-cancel').addEventListener('click', restore);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') restore(); });
      input.focus();
    };

    // 单行：版本名 + 日期 + [预览] [添加] [重命名] [✕]（删除两步确认，4 秒内再点执行）
    // 2026-08-08 交互修复：进入「确认删除」态时旁边出现「取消」按钮——不想删了可直接取消（此前只能干等超时）
    let pendingDelBtn = null;
    let pendingDelCancel = null; // 当前待确认行的「取消」按钮（复位时一并移除）
    const resetPendingDel = () => {
      if (pendingDelBtn) {
        pendingDelBtn.textContent = '✕';
        if (pendingDelCancel) { pendingDelCancel.remove(); pendingDelCancel = null; }
        pendingDelBtn = null;
      }
    };
    const versionRowEl = (v) => {
      const row = document.createElement('div');
      row.className = 'asset-version-row';
      row.innerHTML = `
        <span class="ae-ver-name asset-version-name" data-vid="${esc(v.id)}" title="${esc(v.name || v.id)}">${esc(v.name || v.id)}</span>
        <span class="asset-version-date">${esc((v.createdAt || '').slice(0, 10))}</span>
        <div class="asset-version-actions">
          <button class="btn compact-btn ae-ver-preview">预览</button>
          <button class="btn compact-btn ae-ver-add">添加</button>
          <button class="btn compact-btn ae-ver-rename">重命名</button>
          <button class="btn compact-icon-btn ae-ver-del" aria-label="删除版本">✕</button>
        </div>`;
      row.querySelector('.ae-ver-preview').addEventListener('click', () => previewVersion(entry, v));
      // 添加：只 push pendingScenes 队列不切面板（与拖拽流程一致）；video.js render 时一次消费全部
      row.querySelector('.ae-ver-add').addEventListener('click', () => {
        (wb.pendingScenes ??= []).push({ type: 'asset', name: entry.name, version: v.name });
        setMsg(`已添加到场景草稿（${v.name}）——切到「视频生成」面板可见`);
      });
      row.querySelector('.ae-ver-rename').addEventListener('click', () => startRename(row, v));
      const delBtn = row.querySelector('.ae-ver-del');
      delBtn.addEventListener('click', async () => {
        if (pendingDelBtn === delBtn) { // 第二步：确认删除
          delBtn.textContent = '…';
          try {
            const r = await wb.api('/api/assets/versions', { method: 'DELETE', body: JSON.stringify({ asset: entry.name, id: v.id }) });
            if (r.ok) {
              row.remove();
              resetPendingDel(); // 行已移除，取消按钮随行销毁；仅清状态
              setMsg('版本已删除');
              if (!rows.querySelector('.ae-ver-name[data-vid]')) {
                const hint = document.createElement('div');
                hint.className = 'asset-version-hint';
                hint.textContent = '暂无定制版本';
                rows.appendChild(hint);
              }
            } else {
              setMsg(`删除失败：${r.error || '未知错误'}`);
              resetPendingDel();
            }
          } catch (e) {
            setMsg(`删除失败：${e.message}`);
            resetPendingDel();
          }
          return;
        }
        // 第一步：复位其他行待确认态，本行进入待确认（4 秒不点自动复位；旁边出现「取消」按钮）
        resetPendingDel();
        pendingDelBtn = delBtn;
        delBtn.textContent = '确认删除';
        const cancel = document.createElement('button');
        cancel.className = 'btn compact-btn muted-action';
        cancel.textContent = '取消';
        cancel.addEventListener('click', (e) => { e.stopPropagation(); resetPendingDel(); });
        delBtn.insertAdjacentElement('afterend', cancel);
        pendingDelCancel = cancel;
        setTimeout(() => { if (pendingDelBtn === delBtn) resetPendingDel(); }, 4000);
      });
      return row;
    };

    if (loadErr) {
      const eRow = document.createElement('div');
      eRow.className = 'error-card asset-version-error';
      eRow.textContent = `版本列表读取失败：${loadErr}`;
      rows.appendChild(eRow);
    } else if (!versions.length) {
      const hint = document.createElement('div');
      hint.className = 'asset-version-hint';
      hint.textContent = '暂无定制版本——先「✏ 编辑」或「+ 新建定制版本」保存一个';
      rows.appendChild(hint);
    } else {
      versions.forEach((v) => rows.appendChild(versionRowEl(v)));
    }

    panel.querySelector('.ae-ver-close').addEventListener('click', () => { versionsSeq++; panel.remove(); versionsPanel = null; });
    panel.querySelector('.ae-ver-new').addEventListener('click', () => openEditor(entry)); // 复用 Task 5 编辑模式
    panel._asset = entry.name;
    panel._card = card;
    versionsHost.replaceChildren(panel);
    versionsPanel = panel;
  };

  // deferred minors（M-3）：编辑器「确定保存」成功 → 若版本面板仍展开则重新拉取（新版本立即可见）
  // 具名函数 + render 首尾成对移除/添加：面板每次切换都会 render，防监听器累积重复触发
  function onVersionSaved() {
    if (!versionsPanel) return;
    const assetName = versionsPanel._asset;
    const card = versionsPanel._card;
    if (!card) return;
    const entry = dirs.find((d) => d.name === assetName);
    if (!entry) return;
    showVersionsPanel(entry, card); // 内部先 remove 旧面板再展开新的（含 seq 防竞态）
  }

  // ▼ 版本按钮：单开展开/收起（其他卡片的面板先收起）
  listEl.querySelectorAll('.ae-ver-btn').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = dirs.find((d) => d.name === b.dataset.name);
      if (!entry) return;
      if (!entry.indexHtml) { showNoPreview(entry.name); return; }
      if (versionsPanel && versionsPanel._asset === entry.name) {
        versionsSeq++;
        versionsPanel.remove();
        versionsPanel = null;
        return;
      }
      showVersionsPanel(entry, b.closest('.asset-card'));
    });
  });

  // 参数化演示：加载读 URL 参数的 demo 素材（无 schema → 自由模式）
  const paramDemoButton = document.getElementById('paramDemoBtn');
  paramDemoButton.addEventListener('click', () => {
    paramSchema = null;
    paramValues = {};
    openPreview('/params-demo.html', '参数化演示', '自由参数模式 · 验证预览链路');
    if (!paramRows.length) {
      paramRows = [
        { key: 'title', value: '参数化素材演示' },
        { key: 'sub', value: '改我试试——点击「应用参数」' },
        { key: 'accent', value: '#63EAFF' },
      ];
    }
    renderParamPanel();
  });
  paramDemoButton.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === paramDemoButton) { e.preventDefault(); paramDemoButton.click(); }
  });

  // 参数面板逻辑
  document.getElementById('paramAdd').addEventListener('click', () => {
    paramRows.push({ key: '', value: '' });
    renderParamPanel();
  });
  // 第三档：「恢复默认」——表单值回到 schema default（调乱了一键复位）
  document.getElementById('paramReset').addEventListener('click', () => {
    if (!paramSchema) return;
    paramValues = Object.fromEntries(paramSchema.map((p) => [p.key, p.default ?? (p.type === 'bool' ? 'false' : '')]));
    renderParamPanel();
  });
  document.getElementById('paramApply').addEventListener('click', () => {
    if (!previewBaseSrc) return;
    // 第三档：有 schema → 收集表单值（空值跳过，让素材用内置默认）；无 → 自由行
    const entries = paramSchema?.length
      ? Object.entries(paramValues).filter(([, v]) => String(v ?? '').trim() !== '')
      : paramRows.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value]);
    const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    previewHost.innerHTML = `<iframe class="preview" src="${esc(previewBaseSrc)}${qs ? '?' + qs : ''}"></iframe>`;
  });
  renderParamPanel();
  window.addEventListener('ae-version-saved', onVersionSaved);
}
