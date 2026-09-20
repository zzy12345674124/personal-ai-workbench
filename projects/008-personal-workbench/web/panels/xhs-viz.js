// 统一评论数据面板：SQLite 数据库实时查询，覆盖抖音、小红书与B站。
import { esc } from '../editor/editor-ui.js';

const PLATFORM_LABEL = { douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B站' };

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN');
}

function dropdown(id, label, options) {
  const selected = options.find((option) => option.selected) || options[0];
  return `<div class="comment-filter" id="${id}" data-value="${esc(selected.value)}">
    <button type="button" class="comment-filter-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span>${esc(label)}</span><strong>${esc(selected.label)}</strong><i aria-hidden="true"></i>
    </button>
    <div class="comment-filter-menu" role="listbox" aria-label="${esc(label)}" hidden>
      ${options.map((option) => `<button type="button" role="option" data-value="${esc(option.value)}" aria-selected="${option.value === selected.value}">${esc(option.label)}</button>`).join('')}
    </div>
  </div>`;
}

export async function render(stage, wb) {
  stage.innerHTML = `
    <div class="comment-data-host" id="commentDataHost">
      <div class="comment-data-heading">
        <div><h2>评论数据分析</h2><p>抖音、小红书与B站统一入库 · 本地 SQLite · 打开面板自动增量同步</p></div>
        <span class="comment-db-badge" id="commentDbBadge">正在同步…</span>
      </div>
      <div class="comment-filterbar" aria-label="评论筛选">
        ${dropdown('commentPlatform', '平台', [
          { value: 'all', label: '全部平台', selected: true }, { value: 'douyin', label: '抖音' }, { value: 'xiaohongshu', label: '小红书' }, { value: 'bilibili', label: 'B站' },
        ])}
        ${dropdown('commentSort', '排序方式', [
          { value: 'newest', label: '最新发布', selected: true }, { value: 'likes', label: '点赞最多' }, { value: 'oldest', label: '最早发布' },
        ])}
        ${dropdown('commentDate', '发布日期', [
          { value: 'all', label: '全部日期', selected: true }, { value: '7d', label: '最近 7 天' },
          { value: '30d', label: '最近 30 天' }, { value: '365d', label: '最近 1 年' },
        ])}
        ${dropdown('commentType', '评论类型', [
          { value: 'all', label: '全部评论', selected: true }, { value: 'root', label: '主评论' }, { value: 'reply', label: '回复' },
        ])}
        <label class="comment-search"><span class="sr-only">搜索</span><input id="commentSearch" maxlength="100" placeholder="搜索评论、作者或关键词"><b aria-hidden="true">⌕</b></label>
      </div>
      <div id="commentDataMessage" class="comment-data-message">读取数据库…</div>
      <div class="comment-stats" id="commentStats"></div>
      <div class="comment-data-grid">
        <section class="card comment-ip-card"><div class="comment-section-head"><h3>IP 属地分布</h3><span id="commentIpNote"></span></div><div id="commentIpBars" class="comment-ip-bars"></div></section>
        <section class="card comment-platform-card"><div class="comment-section-head"><h3>平台分布</h3></div><div id="commentPlatformBars" class="comment-platform-bars"></div></section>
      </div>
      <section class="card comment-table-card">
        <div class="comment-section-head"><h3>评论列表</h3><span id="commentTableNote"></span></div>
        <div class="comment-table-wrap"><table class="comment-table"><thead><tr><th>平台</th><th>作者</th><th>评论内容</th><th>赞</th><th>IP 属地</th><th>发布日期</th><th>类型</th></tr></thead><tbody id="commentTableBody"></tbody></table></div>
      </section>
    </div>`;

  const host = stage.querySelector('#commentDataHost');
  const badge = stage.querySelector('#commentDbBadge');
  const message = stage.querySelector('#commentDataMessage');
  let requestGeneration = 0;
  let searchTimer = null;

  const filters = () => ({
    platform: stage.querySelector('#commentPlatform').dataset.value,
    sort: stage.querySelector('#commentSort').dataset.value,
    date: stage.querySelector('#commentDate').dataset.value,
    type: stage.querySelector('#commentType').dataset.value,
    search: stage.querySelector('#commentSearch').value.trim(),
  });

  const barRows = (rows, labelFor = (value) => value) => {
    const max = Math.max(1, ...rows.map((row) => Number(row.count)));
    return rows.length ? rows.map((row, index) => `
      <div class="comment-bar-row">
        <span title="${esc(labelFor(row.label ?? row.platform))}">${esc(labelFor(row.label ?? row.platform))}</span>
        <i><b style="width:${Math.max(2, Number(row.count) / max * 100)}%" data-rank="${Math.min(index, 3)}"></b></i>
        <strong>${formatNumber(row.count)}</strong>
      </div>`).join('') : '<div class="comment-empty">当前筛选下暂无分布数据</div>';
  };

  const renderData = (data) => {
    const stats = data.stats;
    stage.querySelector('#commentStats').innerHTML = [
      ['评论总数', stats.commentCount], ['内容数量', stats.contentCount],
      ['总点赞', stats.likeCount], ['平台数量', stats.platformCount],
    ].map(([label, value]) => `<div class="card comment-stat"><strong>${formatNumber(value)}</strong><span>${label}</span></div>`).join('');
    stage.querySelector('#commentIpBars').innerHTML = barRows(data.ipDistribution);
    stage.querySelector('#commentPlatformBars').innerHTML = barRows(data.platformCounts, (value) => PLATFORM_LABEL[value] || value);
    stage.querySelector('#commentIpNote').textContent = `${formatNumber(stats.commentCount)} 条评论`;
    stage.querySelector('#commentTableNote').textContent = data.truncated ? '显示前 200 条，可继续缩小筛选范围' : `共 ${formatNumber(stats.commentCount)} 条`;
    stage.querySelector('#commentTableBody').innerHTML = data.items.length ? data.items.map((item) => {
      const platform = PLATFORM_LABEL[item.platform] || item.platform;
      const type = item.parentCommentId ? '回复' : '主评论';
      return `<tr>
        <td><span class="comment-platform-tag is-${esc(item.platform)}">${esc(platform)}</span></td>
        <td class="comment-author">${esc(item.author || '未标注')}</td>
        <td class="comment-text">${esc(item.text)}</td>
        <td class="comment-likes">${formatNumber(item.likeCount)}</td>
        <td>${esc(item.ipLocation || '—')}</td>
        <td>${formatDate(item.publishedAt)}</td>
        <td>${type}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7"><div class="comment-empty">当前筛选条件下没有评论</div></td></tr>';
  };

  const load = async () => {
    const generation = ++requestGeneration;
    message.textContent = '正在查询数据库…';
    const query = new URLSearchParams(filters());
    const result = await wb.api(`/api/comments/data?${query}`);
    if (!host.isConnected || generation !== requestGeneration) return;
    if (!result.ok) {
      badge.textContent = '数据库异常';
      badge.classList.remove('is-ready');
      message.textContent = `读取失败：${result.error}`;
      return;
    }
    renderData(result.data);
    const imported = result.data.sync.imported;
    badge.textContent = '数据库已同步';
    badge.classList.add('is-ready');
    message.textContent = imported.sources
      ? `本次新增或更新 ${formatNumber(imported.comments)} 条评论`
      : '数据已是最新状态';
  };

  const closeMenus = (except = null) => {
    stage.querySelectorAll('.comment-filter').forEach((filter) => {
      if (filter === except) return;
      filter.querySelector('.comment-filter-menu').hidden = true;
      filter.querySelector('.comment-filter-trigger').setAttribute('aria-expanded', 'false');
      filter.classList.remove('is-open');
    });
  };
  stage.querySelectorAll('.comment-filter').forEach((filter) => {
    const trigger = filter.querySelector('.comment-filter-trigger');
    const menu = filter.querySelector('.comment-filter-menu');
    trigger.addEventListener('click', () => {
      const opening = menu.hidden;
      closeMenus(filter);
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
      filter.classList.toggle('is-open', opening);
      if (opening) menu.querySelector('[aria-selected="true"]')?.focus();
    });
    menu.querySelectorAll('[role="option"]').forEach((option) => option.addEventListener('click', () => {
      filter.dataset.value = option.dataset.value;
      trigger.querySelector('strong').textContent = option.textContent;
      menu.querySelectorAll('[role="option"]').forEach((item) => item.setAttribute('aria-selected', String(item === option)));
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      filter.classList.remove('is-open');
      trigger.focus();
      load();
    }));
    filter.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeMenus(); trigger.focus(); }
    });
  });
  const outsideClick = (event) => {
    if (!host.isConnected) { document.removeEventListener('click', outsideClick); return; }
    if (!event.target.closest('.comment-filter')) closeMenus();
  };
  document.addEventListener('click', outsideClick);
  window.addEventListener('workbench:tool-switch', () => {
    document.removeEventListener('click', outsideClick);
    clearTimeout(searchTimer);
  }, { once: true });
  stage.querySelector('#commentSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 280);
  });
  await load();
}
