// web/panels/sessions.js —— 会话管家状态面板（严格只读）
import { esc } from '../editor/editor-ui.js';

const formatTime = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '时间未知';
  const diff = Math.max(0, Date.now() - d.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return d.toLocaleString();
};

export async function render(stage, wb) {
  stage.innerHTML = `
    <section class="panel-hero sessions-hero">
      <div>
        <span class="panel-eyebrow">SESSION OVERVIEW</span>
        <h2>会话状态，一眼掌握。</h2>
        <p>这里只展示会话管家的只读摘要，不启动、恢复、移动或删除任何真实会话。</p>
      </div>
      <div class="readonly-badge"><span></span><strong>只读监控</strong></div>
    </section>
    <div id="sessBox"><div class="sessions-loading"><span></span>正在读取本地状态…</div></div>`;

  const box = stage.querySelector('#sessBox');
  let r;
  try { r = await wb.api('/api/sessions/status'); }
  catch (error) {
    box.innerHTML = `<div class="card sessions-error"><span>!</span><div><strong>状态请求失败</strong><p>${esc(error.message)}</p></div></div>`;
    return;
  }
  if (!r.ok) {
    box.innerHTML = `<div class="card sessions-error"><span>!</span><div><strong>状态读取失败</strong><p>${esc(r.error)}</p></div></div>`;
    return;
  }

  const { processRunning, projects = [], recentSessions = [] } = r.data;
  const totalSessions = projects.reduce((sum, p) => sum + (Number(p.count) || 0), 0);
  const projectCards = projects.length
    ? projects.map((p, i) => `
        <article class="session-project-card">
          <span class="session-project-index">${String(i + 1).padStart(2, '0')}</span>
          <div><strong title="${esc(p.name)}">${esc(p.name)}</strong><small>已纳入会话管家</small></div>
          <span class="session-count"><b>${Number(p.count) || 0}</b><small>会话</small></span>
        </article>`).join('')
    : '<div class="sessions-empty"><span>◇</span><strong>暂无管理项目</strong><small>会话管家的项目清单当前为空。</small></div>';

  const sessionRows = recentSessions.length
    ? recentSessions.map((s) => `
        <div class="recent-session-row">
          <span class="recent-session-dot"></span>
          <div class="recent-session-copy">
            <strong title="${esc(s.scope)}">${esc(s.scope)}</strong>
            <code title="${esc(s.file)}">${esc(s.file)}</code>
          </div>
          <time datetime="${esc(s.modifiedAt)}" title="${esc(new Date(s.modifiedAt).toLocaleString())}">${esc(formatTime(s.modifiedAt))}</time>
        </div>`).join('')
    : '<div class="sessions-empty compact"><span>—</span><strong>暂无最近会话</strong><small>没有发现可展示的会话文件。</small></div>';

  box.innerHTML = `
    <section class="sessions-summary-grid">
      <div class="card session-health-card ${processRunning ? 'is-online' : 'is-offline'}">
        <div class="session-health-icon"><span></span></div>
        <div><small>会话管家</small><strong>${processRunning ? '正在运行' : '当前未运行'}</strong><p>${processRunning ? '本地进程已连接，可以查看最新摘要。' : '状态面板仍保持只读，不会自动启动进程。'}</p></div>
      </div>
      <div class="card session-metric-card"><small>管理项目</small><strong>${projects.length}</strong><span>个工作范围</span></div>
      <div class="card session-metric-card"><small>登记会话</small><strong>${totalSessions}</strong><span>条项目记录</span></div>
      <div class="card session-metric-card"><small>最近活跃</small><strong>${recentSessions.length}</strong><span>个会话范围</span></div>
    </section>

    <section class="card sessions-section-card">
      <div class="section-heading">
        <span class="section-number">01</span>
        <div><h3>管理中的项目</h3><p>项目名称和登记会话数量，不包含真实路径。</p></div>
      </div>
      <div class="session-project-grid">${projectCards}</div>
    </section>

    <section class="card sessions-section-card">
      <div class="section-heading">
        <span class="section-number">02</span>
        <div><h3>最近会话</h3><p>每个范围只展示最近更新的一条，不读取对话内容。</p></div>
      </div>
      <div class="recent-session-list">${sessionRows}</div>
    </section>`;
}
