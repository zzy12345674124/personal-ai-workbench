// web/panels/changelog.js —— 更新日志产品面板
import { esc } from '../editor/editor-ui.js';

const formatDate = (value) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || '日期未知';
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export async function render(stage) {
  stage.innerHTML = `
    <section class="panel-hero changelog-hero">
      <div>
        <span class="panel-eyebrow">RELEASE NOTES</span>
        <h2>每次进步，都有迹可循。</h2>
        <p>按版本回看工作台的重要新增与修复。默认只呈现摘要，需要时再展开完整变更。</p>
      </div>
      <div class="release-hero-badge"><span>●</span><strong>本地版本记录</strong></div>
    </section>
    <div id="clContent" class="changelog-content">
      <div class="sessions-loading"><span></span>正在读取版本记录…</div>
    </div>`;

  const content = stage.querySelector('#clContent');
  let versions = [];

  try {
    const response = await fetch('/changelog.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    versions = (await response.json()).versions ?? [];
  } catch (error) {
    content.innerHTML = `
      <div class="card sessions-error">
        <span>!</span>
        <div><strong>更新日志加载失败</strong><p>${esc(error.message)}</p></div>
      </div>`;
    return;
  }

  if (!versions.length) {
    content.innerHTML = `
      <div class="card sessions-empty changelog-empty">
        <span>◇</span><strong>还没有版本记录</strong><small>首条发布记录出现后，会显示在这里。</small>
      </div>`;
    return;
  }

  const totalChanges = versions.reduce((sum, version) => sum + (version.changes?.length ?? 0), 0);
  const latest = versions[0];
  const releaseCards = versions.map((version, index) => {
    const changes = version.changes ?? [];
    const versionId = `release-${index}`;
    return `
      <article class="release-card ${index === 0 ? 'is-latest' : ''}">
        <div class="release-marker"><span></span></div>
        <div class="release-card-body">
          <header class="release-header">
            <div class="release-title-row">
              <span class="release-version">v${esc(version.version)}</span>
              ${index === 0 ? '<span class="release-latest">当前版本</span>' : ''}
            </div>
            <time datetime="${esc(version.date)}">${esc(formatDate(version.date))}</time>
          </header>
          <p class="release-summary">${esc(version.summary)}</p>
          <div class="release-meta"><span>${changes.length} 项变更</span><span>${index === 0 ? '最新发布' : '历史版本'}</span></div>
          <button class="release-toggle" type="button" aria-expanded="false" aria-controls="${versionId}" data-i="${index}">
            <span>查看完整变更</span><b>＋</b>
          </button>
          <div class="release-detail" id="${versionId}" data-i="${index}" hidden>
            ${changes.length
              ? `<ul>${changes.map((change) => `<li><span>✓</span><p>${esc(change)}</p></li>`).join('')}</ul>`
              : '<p class="muted">这个版本没有登记详细条目。</p>'}
          </div>
        </div>
      </article>`;
  }).join('');

  content.innerHTML = `
    <section class="release-summary-grid">
      <div class="card release-current-card">
        <small>当前版本</small><strong>v${esc(latest.version)}</strong><span>${esc(formatDate(latest.date))}</span>
      </div>
      <div class="card release-stat-card"><small>正式版本</small><strong>${versions.length}</strong><span>次阶段发布</span></div>
      <div class="card release-stat-card"><small>累计变更</small><strong>${totalChanges}</strong><span>项新增与修复</span></div>
    </section>
    <section class="card release-timeline-card">
      <div class="section-heading release-section-heading">
        <span class="section-number">01</span>
        <div><h3>版本时间线</h3><p>从最新版本向下排列，点击一项即可查看完整内容。</p></div>
      </div>
      <div class="release-timeline">${releaseCards}</div>
    </section>`;

  content.querySelectorAll('.release-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const detail = content.querySelector(`.release-detail[data-i="${button.dataset.i}"]`);
      const willOpen = detail.hidden;
      detail.hidden = !willOpen;
      button.setAttribute('aria-expanded', String(willOpen));
      button.querySelector('span').textContent = willOpen ? '收起完整变更' : '查看完整变更';
      button.querySelector('b').textContent = willOpen ? '−' : '＋';
    });
  });
}
