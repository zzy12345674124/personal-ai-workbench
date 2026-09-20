/* 会话管家前端逻辑：页面切换 / 深色模式 / 折叠树 / 搜索 / 操作 / 统计 / 设置 */
/* 架构注：pywebview 6.2.1 在页面加载完成后（navigation_completed）才通过 run_js
   注入 window.pywebview.api，早于其执行顶层 `const api = window.pywebview.api`
   会抛 TypeError（实测）。因此 api 获取与首次数据加载全部挂在 pywebviewready
   回调内；switchPage 与各控件监听不依赖 api，保持顶层注册，回调内以
   `if (api)` 防启动早期竞态。 */

// 页面切换（沿用 demo 的滑动+回弹）
const pages = document.querySelectorAll(".page");
const items = document.querySelectorAll(".nav-item");

function switchPage(name) {
  closeSessionMenu();
  const target = document.getElementById("p-" + name);
  pages.forEach((p) => {
    const dir = p.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
    if (p === target) {
      p.classList.remove("off-left");
      p.classList.add("on");
    } else if (p.classList.contains("on")) {
      p.classList.remove("on");
      p.classList.toggle("off-left", dir === 1);
    }
  });
  items.forEach((i) => i.classList.toggle("active", i.dataset.page === name));
}

items.forEach((item) => {
  item.addEventListener("click", () => switchPage(item.dataset.page));
});

// ---- 设置页控件（视觉即时生效；持久化在 api 就绪后） ----
const darkToggle = document.getElementById("darkToggle");
darkToggle.addEventListener("change", (e) => {
  document.body.classList.toggle("dark", e.target.checked);
  if (api) api.set_settings({ dark: e.target.checked });
});

const confirmToggle = document.getElementById("confirmToggle");
confirmToggle.addEventListener("change", (e) => {
  if (api) api.set_settings({ confirm_delete: e.target.checked });
});

const closeAfterEnter = document.getElementById("closeAfterEnter");
closeAfterEnter.addEventListener("change", (e) => {
  if (api) api.set_settings({ close_after_enter: e.target.checked });
});

const claudePath = document.getElementById("claudePath");
claudePath.addEventListener("change", (e) => {
  if (api) api.set_settings({ claude_path: e.target.value.trim() });
});

// ---- 搜索：250ms 防抖即时过滤 + 命中高亮 ----
let searchTimer = null;
document.getElementById("searchBox").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    if (!api) return;
    currentQuery = e.target.value.trim();
    sessionGroups = currentQuery ? await api.search(currentQuery) : await api.list_sessions();
    drawTree(sessionGroups);
  }, 250);
});

// ---- 主页快捷操作 ----
document.getElementById("enterRecentBtn").addEventListener("click", async () => {
  if (!api) return;
  const groups = await api.list_sessions();
  const s = groups.length && groups[0].sessions[0];
  if (s) enterSession(s.id, s.active);
});

// 进入会话：失败时页面内 toast 提示；成功且开启「会话进入后关闭本窗口」则关闭窗口
// （pywebview 6.2.1 的 JS window.close() 是空操作，必须走 Python 侧 api.close_window）
// active = 会话 10 分钟内仍在写入：再次进入会让 Claude Code 创建分叉副本
// （项目内出现两个相同对话，实测 2026-08-06），必须先确认。
// enteringSessionIds 防连点：同一会话并发 enter 会被后端冷却兜底，这里先行拦截。
const enteringSessionIds = new Set();
async function enterSession(id, active = false) {
  if (enteringSessionIds.has(id)) return;
  if (active && !(await modalConfirm(
    "该会话 10 分钟内仍有写入，可能正在另一个窗口运行。\n\n" +
    "再次进入会让 Claude 创建「分叉副本」，项目内会出现两个完全相同的对话（其中一个可能无法正常打开）。\n\n" +
    "确认仍要进入？"))) {
    return;
  }
  enteringSessionIds.add(id);
  try {
    let r = await api.enter(id);
    if (r && !r.ok && r.code === "project_dir_missing" && r.missing_path) {
      const confirmed = await modalConfirm(
        `原工作目录已被删除：\n${r.missing_path}\n\n是否重新创建空目录并恢复会话？历史对话仍会保留，但原项目文件不会恢复。`
      );
      if (!confirmed) return;
      r = await api.recover_missing_project(id);
      if (r && r.ok && r.created_path) toast(`已重建空目录：${r.created_path}`);
    }
    if (r && !r.ok) {
      toast(r.error || "无法启动 claude");
      return;
    }
    if (r && r.ok && (await api.get_settings()).close_after_enter) {
      await api.close_window();
    }
  } finally {
    enteringSessionIds.delete(id);
  }
}

// 轻量 toast（替代原生 alert：WebView2 下 alert 与 confirm 一样不可用）
let toastTimer = null;
function toast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function wirePurge(id) {
  document.getElementById(id).addEventListener("click", async () => {
    if (!api) return;
    if (!(await modalConfirm("永久清空回收站？此操作不可恢复！"))) return;
    if (!(await modalConfirm("再次确认：回收站内所有会话将被物理删除。"))) return;
    await api.purge();
    refreshAll();
  });
}
wirePurge("trashPurgeBtn");
wirePurge("homePurgeBtn");

// ---- 数据与渲染（refreshAll 在 pywebviewready 回调内被调用） ----
let api = null;
let sessionGroups = [];
let currentQuery = "";

// ---- 拖拽状态（项目页）：卡片排序 / 会话移入其他项目 ----
// {kind:"project", path} 拖卡片；{kind:"session", id, fromPath} 拖会话行手柄
let dragState = null;

function clearDragState() {
  document.querySelectorAll(".project-card").forEach((c) =>
    c.classList.remove("drag-over", "drag-before", "drag-after"));
  dragState = null;
}

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
}

// 本地 SVG sprite 图标。name 只由代码内固定值传入，不接受用户数据。
function icon(name) {
  return `<svg class="fluent-icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

// 会话行的“更多”菜单挂到 body，避免被 .group-body 的滚动区域裁剪。
let activeSessionMenu = null;

function closeSessionMenu() {
  if (!activeSessionMenu) return;
  activeSessionMenu.anchor.setAttribute("aria-expanded", "false");
  activeSessionMenu.menu.remove();
  activeSessionMenu = null;
}

async function renameSession(s, onMutated) {
  const val = await modalRename(s.title || "");
  if (val === null) return;
  const t = val.trim();
  if (!t) { toast("标题未变"); return; }
  const r = await api.rename_session(s.id, t);
  if (r && !r.ok) { toast(r.error || "重命名失败"); return; }
  onMutated();
}

async function deleteSession(s, onMutated) {
  if (!(await confirmDelete())) return;
  await api.delete([s.id]);
  onMutated();
}

function openSessionMenu(anchor, s, onMutated) {
  closeSessionMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button type="button" role="menuitem" data-act="rename">${icon("edit")}<span>重命名</span></button>
    <div class="menu-separator"></div>
    <button type="button" role="menuitem" class="danger-item" data-act="delete">${icon("trash")}<span>删除到回收站</span></button>`;
  menu.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.body.appendChild(menu);

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  let left = anchorRect.right - menuRect.width;
  let top = anchorRect.bottom + 4;
  left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
  if (top + menuRect.height > window.innerHeight - margin) {
    top = anchorRect.top - menuRect.height - 4;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(margin, top)}px`;

  anchor.setAttribute("aria-expanded", "true");
  activeSessionMenu = { menu, anchor };
  menu.querySelector('[data-act="rename"]').onclick = async () => {
    closeSessionMenu();
    await renameSession(s, onMutated);
  };
  menu.querySelector('[data-act="delete"]').onclick = async () => {
    closeSessionMenu();
    await deleteSession(s, onMutated);
  };
  menu.querySelector("button").focus();
}

document.addEventListener("pointerdown", (e) => {
  if (activeSessionMenu && !activeSessionMenu.menu.contains(e.target) && !e.target.closest(".more-btn")) {
    closeSessionMenu();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSessionMenu();
});
window.addEventListener("resize", closeSessionMenu);
window.addEventListener("scroll", closeSessionMenu, true);

// 共享会话行渲染：会话列表页与项目页展开共用（避免两套行渲染漂移）。
// ctx: {q: 搜索词小写（可空，空则不命中高亮）, onMutated: 删除/重命名成功后的
// 刷新回调（默认 refreshAll；项目页传对应项目局部刷新）,
// dragToProjects: 项目页展开行为 true → 渲染拖拽手柄（拖到其他项目卡片移动）,
// fromPath: 本行所属项目路径（拖拽落点守卫用）}
function buildSessionRow(s, ctx) {
  const q = (ctx && ctx.q) || "";
  const onMutated = (ctx && ctx.onMutated) || refreshAll;
  const dragToProjects = !!(ctx && ctx.dragToProjects) && !s.readonly;
  const item = document.createElement("div");
  item.className = "row session-row";
  item.dataset.id = s.id;
  // 命中高亮：标题与预览分别判定（搜索现已匹配 title，见 sessions_core.search）
  const titleHit = q && s.title && s.title.toLowerCase().includes(q);
  const prevHit = q && s.preview.toLowerCase().includes(q);
  // 目录独占一条次级信息行；窄窗口不再和标题抢宽度。title 提供完整路径提示。
  const srcHtml = s.source ? `<div class="s-source" title="${esc(s.source)}">
    ${icon("folder")}<span>${esc(s.source)}</span></div>` : "";
  const activeHtml = s.active ? `<span class="active-indicator" title="活动会话"></span>` : "";
  // 分叉副本徽标：同项目内存在更早创建的同一对话文件（Claude Code 分叉产物，
  // 常见于对正在运行的会话重复点「进入」）。tooltip 说明来龙去脉，避免用户
  // 误以为列表重复是数据损坏。
  const forkHtml = s.forked ? `<span class="fork-badge" title="分叉副本：与同项目内另一个会话同源（同一对话被 Claude 复制成两个文件，常见于对正在运行的会话重复点「进入」）。两份内容各自独立，可分别保留或删除。">分叉</span>` : "";
  const toolHtml = s.source_tool === "codex"
    ? `<span class="tool-badge" title="Codex 本地转录；当前仅提供只读全文搜索">Codex${s.archived ? " · 已归档" : ""}</span>`
    : "";
  let midHtml;
  if (s.title) {
    midHtml = `<div class="s-title-line"><span class="s-title${titleHit ? " hit" : ""}" title="${esc(s.title)}">${esc(s.title)}${activeHtml}${forkHtml}${toolHtml}</span></div>
      <div class="s-prev${prevHit ? " hit" : ""}" title="${esc(s.preview)}">${esc(s.preview)}</div>${srcHtml}`;
  } else {
    midHtml = `<div class="prev-line"><span class="prev${prevHit ? " hit" : ""}" title="${esc(s.preview)}">${esc(s.preview)}${activeHtml}${forkHtml}${toolHtml}</span></div>${srcHtml}`;
  }
  const actionsHtml = s.readonly
    ? `<span class="readonly-badge" title="只搜索本地记录，不会修改或恢复该 Codex 会话">只读</span>`
    : `<button type="button" class="btn enter-btn">${icon("enter")}<span>进入</span></button>
      <button type="button" class="btn ghost icon-btn more-btn" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="false">${icon("more")}</button>`;
  item.innerHTML = `${dragToProjects ? `<span class="drag-handle" draggable="true" title="拖拽到其他项目" aria-hidden="true">${icon("grip")}</span>` : ""}
    <span class="when">${esc(String(s.when))}</span>
    <div class="mid">${midHtml}</div>
    <span class="size">${s.size_kb}KB</span>
    ${actionsHtml}`;
  const enterBtn = item.querySelector(".enter-btn");
  const moreBtn = item.querySelector(".more-btn");
  if (enterBtn) enterBtn.onclick = () => enterSession(s.id, s.active);
  if (moreBtn) moreBtn.onclick = (e) => {
      e.stopPropagation();
      openSessionMenu(e.currentTarget, s, onMutated);
    };
  if (dragToProjects) {
    const handle = item.querySelector(".drag-handle");
    handle.addEventListener("dragstart", (e) => {
      dragState = { kind: "session", id: s.id, fromPath: ctx.fromPath };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", s.id);
      item.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      clearDragState();
    });
  }
  return item;
}

const expandedGroups = new Set();   // 按显示名记住展开的组：刷新/轮询重绘后保持展开

function drawTree(groups) {
  const box = document.getElementById("sessionTree");
  box.innerHTML = "";
  if (!groups.length) {
    box.innerHTML = `<div class="empty">${currentQuery ? "没有找到匹配的会话" : "还没有会话记录"}</div>`;
    return;
  }
  const q = currentQuery.toLowerCase();
  for (const g of groups) {
    const row = document.createElement("div");
    row.className = "group-row";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-expanded", String(expandedGroups.has(g.friendly)));
    row.innerHTML = `<span class="g-name">${esc(g.friendly)}</span>
      <span class="g-meta">${g.count} 个 · ${g.size_kb}KB</span>
      <span class="g-arrow">${icon("chevron-down")}</span>`;
    const body = document.createElement("div");
    body.className = "group-body";
    if (expandedGroups.has(g.friendly)) {   // 重绘恢复展开态（自动轮询/刷新不打断浏览）
      body.classList.add("open");
      row.querySelector(".g-arrow").classList.add("open");
    }
    for (const s of g.sessions) {
      body.appendChild(buildSessionRow(s, { q }));
    }
    const toggleGroup = () => {    // 点组行任意位置展开/收起
      const nowOpen = body.classList.toggle("open");
      row.querySelector(".g-arrow").classList.toggle("open");
      row.setAttribute("aria-expanded", String(nowOpen));
      if (nowOpen) expandedGroups.add(g.friendly);
      else expandedGroups.delete(g.friendly);
    };
    row.onclick = toggleGroup;
    row.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(); }
    };
    box.append(row, body);
  }
}

async function renderSessions() {
  // 尊重搜索框当前值：删除等操作触发 refreshAll 后仍保持过滤状态
  currentQuery = document.getElementById("searchBox").value.trim();
  sessionGroups = currentQuery ? await api.search(currentQuery) : await api.list_sessions();
  drawTree(sessionGroups);
}

async function renderTrash() {
  const box = document.getElementById("trashList");
  const items = await api.trash_list();
  box.innerHTML = "";
  if (!items.length) {
    box.innerHTML = `<div class="empty">回收站是空的</div>`;
    return;
  }
  for (const t of items) {
    const item = document.createElement("div");
    item.className = "row";
    item.dataset.id = t.id;
    item.innerHTML = `<span class="when">${esc(String(t.when))}</span>
      <span class="prev">${esc(t.preview)}</span>
      <span class="size">${t.size_kb}KB</span>
      <button class="btn restore-btn">${icon("restore")}<span>恢复</span></button>`;
    item.querySelector(".restore-btn").onclick = async () => {
      await api.restore([t.id]);
      refreshAll();
    };
    box.appendChild(item);
  }
}

async function renderStats() {
  const box = document.getElementById("statsBars");
  const st = await api.stats();
  box.innerHTML = "";
  if (!st.per_project.length) {
    box.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...st.per_project.map((p) => p.count), 1);
  for (const p of st.per_project) {
    const item = document.createElement("div");
    item.className = "proj-bar";
    const w = ((p.count / max) * 100).toFixed(1);
    item.innerHTML = `<span class="proj-name">${esc(p.friendly)}</span>
      <div class="track"><span style="width:${w}%"></span></div>
      <span class="proj-count">${p.count}</span>`;
    box.appendChild(item);
  }
}

async function renderHome() {
  const st = await api.stats();
  document.getElementById("statTotal").textContent = st.total;
  document.getElementById("statSize").textContent = (st.total_size_kb / 1024).toFixed(1) + " MB";
  document.getElementById("statTrash").textContent = st.trash_count;
}

// ---- 项目页（Codex 式）：卡片列表 + 展开历史会话 + 开始对话/删除/新建 ----
const expandedProjectPaths = new Set();   // 重新渲染后保持展开状态（操作后刷新不收起）
const projectSessionsCache = new Map();   // 项目路径 → 会话列表（展开时回源、操作后失效）

async function fillProjectBody(path, body) {
  if (!projectSessionsCache.has(path)) {
    projectSessionsCache.set(path, await api.project_sessions(path));
  }
  const sessions = projectSessionsCache.get(path);
  body.innerHTML = "";
  if (!sessions.length) {
    body.innerHTML = `<div class="empty">该项目还没有对话</div>`;
    return;
  }
  for (const s of sessions) {
    // 用默认 onMutated=refreshAll：删除/重命名后全局刷新（含回收站/统计同步），
    // refreshAll 开头已清 projectSessionsCache，展开态由 expandedProjectPaths 保持
    body.appendChild(buildSessionRow(s, { dragToProjects: true, fromPath: path }));
  }
}

async function renderProjects() {
  const box = document.getElementById("projectsList");
  const projects = await api.list_projects();
  box.innerHTML = "";
  if (!projects.length) {
    box.innerHTML = `<div class="empty">还没有项目。点击「新建项目」选择文件夹，即可在该文件夹中开启全新的 Claude 对话。<br>该文件夹下的历史会话可从卡片的展开按钮查看。</div>`;
    return;
  }
  for (const p of projects) {
    const card = document.createElement("div");
    card.className = "project-card";
    card.dataset.path = p.path;
    card.innerHTML = `<span class="drag-handle" draggable="true" title="拖拽调整顺序" aria-hidden="true">${icon("grip")}</span>
      <div class="proj-info">
        <div class="proj-name">${esc(p.name)}</div>
        <div class="proj-path">${esc(p.path)}</div>
      </div>
      <span class="proj-count">${p.count} 个会话</span>
      <span class="proj-arrow" title="展开历史会话" role="button" tabindex="0" aria-expanded="false">${icon("chevron-down")}</span>
      <div class="proj-actions">
        <button class="btn start-btn">${icon("enter")}<span>开始对话</span></button>
        <button class="btn ghost rename-btn" title="重命名" aria-label="重命名">${icon("edit")}</button>
        <button class="btn ghost del-btn">${icon("trash")}<span>删除</span></button>
      </div>`;
    card.querySelector(".start-btn").onclick = async () => {
      const r = await api.start_project_session(p.path);
      if (r && !r.ok) { toast(r.error || "无法启动 claude"); return; }
      renderProjects();                 // 立即刷新计数（乐观）
      setTimeout(refreshAll, 8000);     // 等 claude 建好转录后全局刷新，新对话立即可见
    };
    card.querySelector(".rename-btn").onclick = async () => {
      // 复用输入模态（预填当前名称）；重命名只改显示标签，path 不变，
      // 展开态与展开行会话数据（均按 path 键）不受影响
      const val = await modalRename(p.name, "重命名项目", "输入新名称（50 字以内）", 50);
      if (val === null) return;                 // Esc/取消：静默关闭
      const t = val.trim();
      if (!t) { toast("名称未变"); return; }    // 留空=不改（与会话重命名约定一致）
      const r = await api.rename_project(p.path, t);
      if (r && !r.ok) { toast(r.error || "重命名失败"); return; }
      renderProjects();
    };
    card.querySelector(".del-btn").onclick = async () => {
      // 名称不在此处转义：modalConfirm 内部会 esc()，双重转义会把
      // & < > 显示成 &amp;amp; 字面（名称含 & 时确认框文案错乱）
      if (!(await modalConfirm(`确认移除项目「${p.name}」？仅移除列表记录，文件夹本身不受影响。`))) return;
      const r = await api.remove_project(p.path);
      if (r && !r.ok) toast(r.error || "移除失败");   // 保存失败时给反馈，项目留在列表
      expandedProjectPaths.delete(p.path);            // 项目没了，展开态与缓存一并清理
      projectSessionsCache.delete(p.path);
      renderProjects();
    };
    const body = document.createElement("div");
    body.className = "group-body project-body";       // 复用会话列表的弹性展开样式
    const arrow = card.querySelector(".proj-arrow");
    const toggleProject = () => {       // 点箭头展开/收起本项目历史会话
      const opening = !body.classList.contains("open");
      body.classList.toggle("open", opening);
      arrow.classList.toggle("open", opening);
      arrow.setAttribute("aria-expanded", String(opening));
      if (opening) {
        expandedProjectPaths.add(p.path);
        fillProjectBody(p.path, body);  // 异步：先弹性展开，再填充行
      } else {
        expandedProjectPaths.delete(p.path);
      }
    };
    arrow.onclick = toggleProject;
    arrow.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleProject(); }
    };
    if (expandedProjectPaths.has(p.path)) {   // 删除/重命名后 renderProjects 保持展开
      body.classList.add("open");
      arrow.classList.add("open");
      fillProjectBody(p.path, body);
    }

    // ---- 拖拽：手柄拖动卡片排序；会话手柄拖到卡片 = 移入该项目 ----
    // 卡片是两种拖拽的公共落点：拖项目 → 上/下指示线（before/after）；拖会话 →
    // 整卡高亮（移入）。会话拖回自己所在卡片不是落点（后端同样拒绝）。
    card.querySelector(".drag-handle").addEventListener("dragstart", (e) => {
      dragState = { kind: "project", path: p.path };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", p.path);
      card.classList.add("dragging");
    });
    card.querySelector(".drag-handle").addEventListener("dragend", () => {
      card.classList.remove("dragging");
      clearDragState();
    });
    card.addEventListener("dragover", (e) => {
      if (!dragState) return;
      if (dragState.kind === "session" && dragState.fromPath === p.path) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.remove("drag-over", "drag-before", "drag-after");
      if (dragState.kind === "session") {
        card.classList.add("drag-over");
      } else if (dragState.path !== p.path) {
        const rect = card.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) card.classList.add("drag-before");
        else card.classList.add("drag-after");
      }
    });
    card.addEventListener("dragleave", (e) => {
      if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".project-card")) {
        card.classList.remove("drag-over", "drag-before", "drag-after");
      }
    });
    card.addEventListener("drop", async (e) => {
      if (!dragState) return;
      e.preventDefault();
      const st = dragState;
      clearDragState();
      if (st.kind === "session") {
        if (st.fromPath === p.path) return;          // 已在本项目，无需移动
        const r = await api.move_session_to_project(st.id, p.path);
        if (r && r.ok) {
          toast(`已移动到「${p.name}」`);
          expandedProjectPaths.add(p.path);          // 展开目标卡片，移动后立即可见
          projectSessionsCache.delete(p.path);
          refreshAll();
        } else {
          toast((r && r.error) || "移动失败");
        }
        return;
      }
      // 项目排序：落在目标卡片上半 → 插到它之前；下半 → 插到它之后（取下一张
      // 卡片为基准，没有则移到末尾）；与自身相邻的原地落点跳过
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      let dst;
      if (before) {
        dst = p.path;
      } else {
        const cards = [...box.querySelectorAll(".project-card")];
        const next = cards[cards.indexOf(card) + 1];
        dst = next ? next.dataset.path : "";
      }
      if (dst === st.path) return;
      const r = await api.move_project(st.path, dst);
      if (r && r.ok) renderProjects();
      else toast((r && r.error) || "排序失败");
    });
    box.append(card, body);
  }
}

document.getElementById("newProjectBtn").addEventListener("click", async () => {
  if (!api) return;
  const r = await api.pick_folder();            // 原生文件夹选择对话框
  if (r && !r.ok) { toast(r.error || "选择文件夹失败"); return; }
  if (!r || !r.path) return;                    // 用户取消选择
  const defaultName = String(r.name || "").slice(0, 50);
  const val = await modalRename(defaultName, "新建项目", "输入项目名称（50 字以内）", 50);
  if (val === null) return;                     // Esc/取消
  const name = val.trim();
  if (!name) { toast("名称不能为空"); return; }
  const res = await api.add_project(name, r.path);
  if (res && !res.ok) { toast(res.error || "添加失败"); return; }
  renderProjects();
});

// 模态确认框：WebView2（pywebview 6.2.1）下 window.confirm() 永久阻塞渲染线程且
// 不显示任何对话框（exe 冒烟实测），删除/清空二次确认统一改用页面内模态框。
function modalConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `<div class="confirm-box"><p>${esc(message)}</p>
      <div class="confirm-actions">
        <button class="btn ghost" data-act="no">取消</button>
        <button class="btn" data-act="yes">确定</button>
      </div></div>`;
    overlay.querySelector('[data-act="no"]').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('[data-act="yes"]').onclick = () => { overlay.remove(); resolve(true); };
    document.body.appendChild(overlay);
    overlay.querySelector('[data-act="no"]').focus();
  });
}

// 输入模态：modalConfirm 的文本输入变体（复用 confirm-overlay 样式）。
// 输入框 + 确定/取消；Enter 确定、Esc 取消；resolve(value | null)
// 默认即重命名会话标题；项目新建复用同一模态（heading/placeholder/maxlength 可定制）
function modalRename(currentTitle, heading = "设置会话标题",
                     placeholder = "输入新标题（留空则不修改）", maxlength = 100) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `<div class="confirm-box"><p>${esc(heading)}</p>
      <input class="text-input rename-input" type="text" maxlength="${maxlength}"
        value="${esc(currentTitle)}" placeholder="${esc(placeholder)}">
      <div class="confirm-actions" style="margin-top:14px">
        <button class="btn ghost" data-act="no">取消</button>
        <button class="btn" data-act="yes">确定</button>
      </div></div>`;
    const input = overlay.querySelector(".rename-input");
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('[data-act="no"]').onclick = () => close(null);
    overlay.querySelector('[data-act="yes"]').onclick = () => close(input.value);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); close(input.value); }
      if (e.key === "Escape") { e.preventDefault(); close(null); }
    });
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

function confirmDelete() {
  return new Promise(async (resolve) => {
    const s = await api.get_settings();
    if (!s.confirm_delete) return resolve(true);
    resolve(await modalConfirm("确认删除到回收站？"));
  });
}

async function refreshAll() {
  closeSessionMenu();
  // 跨页操作（会话列表页删除/回收站恢复等）后项目页展开行必须回源：
  // 只清缓存不动 expandedProjectPaths，展开态保持、仅本次全局刷新重新拉取
  projectSessionsCache.clear();
  await Promise.all([renderSessions(), renderTrash(), renderStats(), renderHome(), renderProjects()]);
}

// ---- 维护：清理残留进程（分叉残留 / 孤儿会话） ----
// 流程：扫描 → 模态列出残留清单 → 用户确认 → 后端 taskkill /F（后端会重新
// 扫描交叉验证，只杀仍属残留集合的进程，防误杀活跃会话）。
document.getElementById("staleCleanupBtn").addEventListener("click", async () => {
  if (!api) return;
  const r = await api.scan_stale_processes();
  if (!r) { toast("扫描失败，请稍后重试"); return; }
  if (!r.stale.length) { toast("没有发现残留进程"); return; }
  const lines = r.stale.map((p) =>
    `PID ${p.pid} · ${p.kind}${p.session_id ? " · " + p.session_id.slice(0, 8) : ""}`);
  const confirmed = await modalConfirm(
    `发现 ${r.stale.length} 个残留进程（窗口已关闭但仍在后台运行）：\n\n${lines.join("\n")}\n\n确认终止它们？`);
  if (!confirmed) return;
  const res = await api.kill_stale_processes(r.stale.map((p) => p.pid));
  const failed = Object.entries(res).filter(([, v]) => v !== "已终止");
  if (!failed.length) toast(`已清理 ${r.stale.length} 个残留进程`);
  else toast(`${r.stale.length - failed.length} 个已清理，${failed.length} 个失败：${failed[0][1]}`);
});

// ---- 静默轮询：应用外新建的会话/回收站变化无需重启即可见 ----
// 只比对轻量签名（会话数/回收站数/总大小），变了才 refreshAll；
// 不变则完全不重绘，不打扰用户正在展开的状态（成本：每 20s 一次 stats）
let lastSignature = null;
async function sessionSignature() {
  const st = await api.stats();
  return `${st.total}|${st.trash_count}|${st.total_size_kb}`;
}
async function checkAndRefresh() {
  try {
    const sig = await sessionSignature();
    if (sig !== lastSignature) {
      lastSignature = sig;
      await refreshAll();
    }
  } catch (e) { /* 桥接异常静默跳过，下次轮询再试 */ }
}

// 首次加载：取 api、渲染全部页面、按持久化设置同步控件（T8 修复确立的模式）
window.addEventListener("pywebviewready", async () => {
  api = window.pywebview.api;
  const s = await api.get_settings();
  document.body.classList.toggle("dark", s.dark);
  darkToggle.checked = !!s.dark;
  confirmToggle.checked = !!s.confirm_delete;
  closeAfterEnter.checked = !!s.close_after_enter;
  claudePath.value = s.claude_path || "";
  await refreshAll();
  // 手动刷新按钮：立即全量刷新（先更新基线，避免轮询紧接着重复刷新）
  document.getElementById("refreshBtn").addEventListener("click", async () => {
    lastSignature = await sessionSignature();
    await refreshAll();
  });
  lastSignature = await sessionSignature();   // 初始化轮询基线
  setInterval(checkAndRefresh, 20000);        // 每 20 秒静默检查外部变化
});
