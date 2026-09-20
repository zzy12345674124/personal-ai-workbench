// web/panels/xhs-crawler.js —— 小红书评论面板 v2（原三栏 UI × 统一采集框架）
// 布局：左=选择任务（一级/二级关键词）｜中=选择单位/网站/播放器/调试/重启｜右=执行日志
// 绑定：小红书/抖音均走 /api/collector/*；仅 AI 扩词保留 /api/xhs/expand。
// 说明：参考图为运行态截图故无「启动」按钮；静态工具必须有启动入口，
//       故底部操作条最左保留「启动采集」主按钮（btn-primary），此偏离为功能完整性有意为之。
import { esc } from '../editor/editor-ui.js';

const SITES = [
  { name: 'YouTube搜索视频采集' }, { name: '快手视频搜索' }, { name: '百度新闻采集' },
  { name: '今日头条采集' }, { name: '搜狗视频搜索' },
  { name: '抖音视频搜索采集', platform: 'douyin' }, { name: '豆包讨论搜索' },
  { name: '新浪微博搜索采集' }, { name: 'B站视频评论', platform: 'bilibili' }, { name: '小红书', platform: 'xiaohongshu' },
];

const PLATFORM_NAMES = { douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B站' };
const STATE_NAMES = {
  queued: '排队中', starting: '启动中', checking_login: '检查登录', waiting_login: '登录已失效',
  waiting_human_check: '等待人工验证', searching: '搜索内容', collecting_comments: '采集评论',
  paused: '已暂停', cooling_down: '限流冷却', completed: '已完成', partial: '部分完成',
  failed: '失败', stopped: '已停止',
};
const TERMINAL = new Set(['completed', 'partial', 'failed', 'stopped']);
const ATTENTION = new Set(['waiting_login', 'waiting_human_check']);
const finished = (data) => TERMINAL.has(data?.state) || (ATTENTION.has(data?.state) && data?.running === false);
const CONTROL_ENDPOINTS = { pause: '/api/collector/pause', resume: '/api/collector/resume' };
const formatEventTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).replaceAll('/', '-');
};

export async function render(stage, wb) {
  const siteRows = SITES.map(({ name, platform }) => {
    const wired = Boolean(platform);
    return `
      <div class="xhs2-site-row"${platform ? ` data-platform="${platform}"` : ''}>
        <input type="checkbox" class="xhs2-site-main" ${platform === 'xiaohongshu' ? 'checked' : ''} ${wired ? '' : 'disabled'}>
        <span class="xhs2-site-name">${esc(name)}${wired ? '' : '<span class="xhs2-not-wired">未接入</span>'}</span>
        <span class="xhs2-site-tail">
          <span class="xhs2-site-hover">
            <button type="button" class="btn" title="暂不生效">显示窗口</button>
            <button type="button" class="btn" title="暂不生效">最小化</button>
          </span>
          <label class="xhs2-kb" title="暂不生效（知识搜索）"><input type="checkbox" checked disabled class="xhs2-inert"><span>知识搜索</span></label>
        </span>
      </div>`;
  }).join('');

  stage.innerHTML = `
    <h2>多平台评论采集</h2>
    <div class="xhs2-grid">
      <!-- 左栏：选择任务 / 选择单位 / 选择关键词 -->
      <div class="card xhs2-card-l">
        <div class="xhs2-sec-title">【1. 选择任务】</div>
        <div class="xhs2-check-row">
          <label><input type="checkbox" id="xhsNetIntranet" disabled class="xhs2-inert">内网IP</label>
          <label><input type="checkbox" id="xhsNetExtranet" checked disabled class="xhs2-inert">外网IP</label>
          <span class="xhs2-param-note">【暂不生效】</span>
        </div>
        <div class="xhs2-note">（备注：5000-5024服务器任务选内网IP）</div>
        <input id="xhsRootKeyword" list="xhsRootKeywords" placeholder="输入或选择一级关键词（如：教材）" style="width:100%;background:var(--bg);border:1px solid var(--surface2);border-radius:10px;padding:7px 10px;font-size:.8rem;color:var(--text)">
        <datalist id="xhsRootKeywords"><option value="教材"></option></datalist>
        <div class="xhs2-sec-title">【2. 选择单位】</div>
        <div class="xhs2-unit" id="xhsUnitReadonly">自动=教材</div>
        <div class="xhs2-sec-title">【3. 选择关键词】<button type="button" class="btn btn-text xhs2-expand" id="xhsExpand">AI 扩展</button></div>
        <div class="xhs2-check-row">
          <label><input type="checkbox" checked>是否实时更新关键词并全选</label>
          <span class="xhs2-check-divider"></span>
          <label><input type="radio" name="xhsScope" disabled class="xhs2-inert">前</label>
          <label><input type="radio" name="xhsScope" disabled class="xhs2-inert">后</label>
          <label><input type="radio" name="xhsScope" checked>全选</label>
        </div>
        <div class="xhs2-keyword-list" id="xhsWordsList">
          <div class="xhs2-words-empty">二级词列表为空 —— 点击「AI 扩展」生成</div>
        </div>
      </div>

      <!-- 中栏：选择网站 / 播放器 / 调试 / 重启 -->
      <div class="card xhs2-card-m">
        <div class="xhs2-check-row">
          <label><input type="checkbox" checked disabled class="xhs2-inert">境内</label>
          <label><input type="checkbox" disabled class="xhs2-inert">境外</label>
          <label><input type="checkbox" disabled class="xhs2-inert">全选</label>
          <span class="xhs2-param-note">【暂不生效】</span>
          <span class="xhs2-spacer"></span>
          <label class="xhs2-kb" title="暂不生效"><input type="checkbox" disabled class="xhs2-inert">窗口置顶</label>
        </div>
        <div class="xhs2-sec-title">【4. 选择网站】</div>
        ${siteRows}
        <div class="xhs2-sec-title">【调试】</div>
        <div class="xhs2-debug-grid">
          <div class="xhs2-param"><label>窗口间隔（秒）</label><input type="number" value="15" min="0" step="1" disabled class="xhs2-inert"><div class="xhs2-param-note">【暂不生效】</div></div>
          <div class="xhs2-param"><label>操作间隔（秒）</label><input type="number" id="xhsPause" value="3" min="1" max="60" step="1"><div class="xhs2-param-note">已接入平台真实生效（随机增加 0～2 秒）</div></div>
          <div class="xhs2-param"><label>增量采集页数</label><input type="number" id="xhsMaxPages" value="10" min="1" step="1"><div class="xhs2-param-note">真实生效（maxPages）</div></div>
          <div class="xhs2-param"><label>休息时间（分钟）</label><input type="number" value="30" min="0" step="1" disabled class="xhs2-inert"><div class="xhs2-param-note">【暂不生效】</div></div>
        </div>
        <div class="xhs2-check-row">
          <label><input type="checkbox" checked disabled class="xhs2-inert">启动NLP模块</label>
          <span class="xhs2-param-note">【暂不生效】</span>
        </div>
        <div class="xhs2-check-row">
          <label><input type="checkbox" checked disabled class="xhs2-inert">每日重启NLP</label>
          <span class="xhs2-param-note">【暂不生效】</span>
          <span class="xhs2-spacer"></span>
          <button type="button" class="btn btn-text xhs2-link-btn" disabled title="暂不生效">显示窗口</button>
        </div>
        <div class="xhs2-sec-title">【重启】<span class="xhs2-sec-note">（暂不生效）</span></div>
        <div class="xhs2-check-row">
          <label><input type="checkbox" checked disabled class="xhs2-inert">是否定时重启</label>
        </div>
        <div class="xhs2-param-row">
          <label>重启时间（分钟）</label>
          <input type="time" step="1" value="20:03:52" disabled class="xhs2-inert">
        </div>
        <div class="xhs2-check-row">
          <label>重启日期：</label>
          <label><input type="radio" name="xhsRebootDay" checked disabled class="xhs2-inert">单</label>
          <label><input type="radio" name="xhsRebootDay" disabled class="xhs2-inert">双</label>
        </div>
        <div class="xhs2-check-row xhs2-week-row">
          <label><input type="checkbox" checked disabled class="xhs2-inert">周一</label>
          <label><input type="checkbox" checked disabled class="xhs2-inert">周二</label>
          <label><input type="checkbox" checked disabled class="xhs2-inert">周三</label>
          <label><input type="checkbox" checked disabled class="xhs2-inert">周四</label>
          <label><input type="checkbox" checked disabled class="xhs2-inert">周五</label>
          <label><input type="checkbox" disabled class="xhs2-inert">周六</label>
        </div>
      </div>

      <!-- 右栏：执行日志 -->
      <div class="card xhs2-log-card">
        <h3>【4. 执行日志】</h3>
        <pre id="xhsLog" class="xhs2-log">2026-08-23 初始化服务器
******** 服务端 ********
07-23 20:03:52 | 初始化任务列表</pre>
      </div>
    </div>

    <!-- 底部操作条（启动入口说明见文件头注释） -->
    <div class="xhs2-actions">
      <button class="btn btn-primary" id="xhsStart">启动采集</button>
      <button type="button" class="btn xhs2-btn-hide-all" title="暂不生效">隐藏所有窗口</button>
      <button type="button" class="btn xhs2-btn-hide-main" title="暂不生效">隐藏主窗口</button>
      <button type="button" class="btn xhs2-btn-pause" id="xhsPauseToggle" disabled>暂停</button>
      <button class="btn xhs2-btn-stop" id="xhsStop">停止</button>
      <span id="xhsMsg" class="muted xhs2-msg"></span>
    </div>`;

  const logEl = stage.querySelector('#xhsLog');
  const setMsg = (t) => { stage.querySelector('#xhsMsg').textContent = t; };
  const rootSel = stage.querySelector('#xhsRootKeyword');
  const jobs = new Map();
  let pollGeneration = 0;

  const appendLog = (text) => {
    logEl.textContent = text || '暂无任务';
    logEl.scrollTop = logEl.scrollHeight;
  };

  const renderJobs = () => {
    const lines = [];
    let contents = 0;
    let comments = 0;
    for (const [platform, job] of jobs) {
      const data = job.status || { state: 'queued' };
      const name = PLATFORM_NAMES[platform] || platform;
      contents += data.contentCount || 0;
      comments += data.commentCount || 0;
      lines.push(`【${name}】${STATE_NAMES[data.state] || data.state || '未知'}｜内容 ${data.contentCount || 0}｜评论 ${data.commentCount || 0}`);
      for (const raw of Array.isArray(data.events) ? data.events : []) {
        try {
          const event = JSON.parse(raw);
          lines.push(`${formatEventTime(event.at)}  [${name}] ${STATE_NAMES[event.state] || event.state || ''}${event.code ? `  ${event.code}` : ''}`);
        } catch { /* 忽略不完整事件行 */ }
      }
    }
    appendLog(lines.join('\n'));
    return { contents, comments };
  };

  const updateControls = () => {
    const active = Array.from(jobs.values()).filter((job) => !finished(job.status));
    const allPaused = active.length > 0 && active.every((job) => job.status?.state === 'paused');
    const pauseButton = stage.querySelector('#xhsPauseToggle');
    pauseButton.disabled = active.length === 0;
    pauseButton.textContent = allPaused ? '继续' : '暂停';
    stage.querySelector('#xhsStop').disabled = active.length === 0;
    stage.querySelector('#xhsStart').disabled = active.length > 0;
  };

  const poll = async (generation) => {
    if (!stage.isConnected || generation !== pollGeneration || !jobs.size) return;
    await Promise.all(Array.from(jobs.entries()).map(async ([platform, job]) => {
      if (finished(job.status)) return;
      const result = await wb.api(`/api/collector/status?id=${encodeURIComponent(job.jobId)}`);
      job.status = result.ok ? result.data : { state: 'failed', running: false, code: result.error };
      jobs.set(platform, job);
    }));
    if (!stage.isConnected || generation !== pollGeneration) return;
    const totals = renderJobs();
    updateControls();
    const activeAttention = Array.from(jobs.values())
      .find((job) => ATTENTION.has(job.status?.state) && job.status?.running !== false);
    if (activeAttention) {
      const name = PLATFORM_NAMES[activeAttention.platform] || activeAttention.platform;
      setMsg(activeAttention.status.state === 'waiting_login'
        ? `${name}登录已失效：请在已打开的 CloakBrowser 输入账号或扫码，成功后自动继续`
        : `${name}需要人工验证：请在 CloakBrowser 完成后等待自动继续`);
    }
    if (Array.from(jobs.values()).every((job) => finished(job.status))) {
      const attention = Array.from(jobs.values()).find((job) => ATTENTION.has(job.status?.state));
      setMsg(attention
        ? `${PLATFORM_NAMES[attention.platform]}需要登录或人工验证；处理后重新启动`
        : `任务结束：共采集 ${totals.contents} 条内容、${totals.comments} 条评论，已同步评论数据库`);
      return;
    }
    setTimeout(() => poll(generation), 1500);
  };

  // 未接入站点保持禁用；接入站点可组合选择。
  stage.querySelectorAll('.xhs2-site-row:not([data-platform])').forEach((row) => {
    const cb = row.querySelector('.xhs2-site-main');
    const note = row.querySelector('.xhs2-not-wired');
    if (note) cb.addEventListener('change', () => { note.style.display = cb.checked ? 'inline' : 'none'; });
  });

  // 【2. 选择单位】只读值 = 自动=当前一级关键词
  const unitEl = stage.querySelector('#xhsUnitReadonly');
  const syncUnit = () => {
    const v = rootSel.value.trim();
    unitEl.textContent = v ? `自动=${v}` : '自动=（未选择一级关键词）';
  };
  rootSel.addEventListener('change', syncUnit);

  // 【3. 选择关键词】AI 扩展 → 填充二级词列表（默认全选，点击列表项切换勾选）
  stage.querySelector('#xhsExpand').addEventListener('click', async () => {
    const keyword = rootSel.value.trim();
    if (!keyword) { setMsg('请先选择一级关键词'); return; }
    const r = await wb.api('/api/xhs/expand', { method: 'POST', body: JSON.stringify({ keyword }) });
    if (!r.ok) { setMsg(`AI 扩展失败：${r.error}`); return; }
    const words = (r.data && Array.isArray(r.data.words)) ? r.data.words : [];
    stage.querySelector('#xhsWordsList').innerHTML = words.length
      ? words.map((w) => `<label class="xhs2-word-item"><input type="checkbox" checked data-word="${esc(w)}"><span>${esc(w)}</span></label>`).join('')
      : '<div class="xhs2-words-empty">未扩展出二级词</div>';
    setMsg(`已生成 ${words.length} 个二级词（默认全选）`);
  });

  // 启动：每个平台各建一个隔离任务，但共同使用同一合同、控制接口和结果数据库。
  stage.querySelector('#xhsStart').addEventListener('click', async () => {
    const keyword = rootSel.value.trim();
    if (!keyword) { setMsg('请先输入一级关键词'); return; }
    const platforms = Array.from(stage.querySelectorAll('.xhs2-site-row[data-platform] .xhs2-site-main:checked'))
      .map((cb) => cb.closest('.xhs2-site-row').dataset.platform);
    if (!platforms.length) { setMsg('请至少选择一个已接入平台'); return; }
    const words = Array.from(stage.querySelectorAll('#xhsWordsList input[type="checkbox"]:checked'))
      .map((cb) => cb.dataset.word || '');
    const keywords = Array.from(new Set([keyword, ...words].filter(Boolean))).slice(0, 20);
    const delayMs = Math.round(Math.max(1, Math.min(60, parseFloat(stage.querySelector('#xhsPause').value || '3'))) * 1000);
    const maxPages = Math.max(1, Math.min(100, parseInt(stage.querySelector('#xhsMaxPages').value || '10', 10)));
    stage.querySelector('#xhsStart').disabled = true;
    jobs.clear();
    setMsg('正在创建统一采集任务…');
    for (const platform of platforms) {
      const result = await wb.api('/api/collector/start', {
        method: 'POST',
        body: JSON.stringify({
          platform, keywords,
          limits: { maxContentsPerKeyword: 3, maxCommentsPerContent: 100, maxPagesPerContent: maxPages, maxRuntimeMinutes: 60 },
          timing: { minActionDelayMs: delayMs, maxActionDelayMs: delayMs + 2000, cooldownAfterRateLimitMs: 300000 },
          browser: { visible: true }, contentFilter: '',
        }),
      });
      if (!result.ok) {
        await Promise.all(Array.from(jobs.values()).map((job) => wb.api('/api/collector/stop', {
          method: 'POST', body: JSON.stringify({ id: job.jobId }),
        })));
        jobs.clear();
        setMsg(`${PLATFORM_NAMES[platform]}启动失败：${result.error}`);
        updateControls();
        return;
      }
      jobs.set(platform, { platform, jobId: result.data.jobId, status: { state: 'queued', running: true } });
    }
    pollGeneration += 1;
    setMsg(`已启动：${platforms.map((item) => PLATFORM_NAMES[item]).join('、')}`);
    appendLog('任务启动中…');
    updateControls();
    poll(pollGeneration);
  });

  stage.querySelector('#xhsStop').addEventListener('click', async () => {
    const active = Array.from(jobs.values()).filter((job) => !finished(job.status));
    await Promise.all(active.map((job) => wb.api('/api/collector/stop', {
      method: 'POST', body: JSON.stringify({ id: job.jobId }),
    })));
    setMsg('已请求停止');
  });

  stage.querySelector('#xhsPauseToggle').addEventListener('click', async () => {
    const active = Array.from(jobs.values()).filter((job) => !finished(job.status));
    if (!active.length) return;
    const resume = active.every((job) => job.status?.state === 'paused');
    const action = resume ? 'resume' : 'pause';
    await Promise.all(active.map((job) => wb.api(CONTROL_ENDPOINTS[action], {
      method: 'POST', body: JSON.stringify({ id: job.jobId }),
    })));
    setMsg(resume ? '已请求继续' : '已请求暂停，将在安全控制点停下');
  });

  const capability = await wb.api('/api/collector/capabilities');
  const ready = new Set(capability.ok
    ? capability.data.platforms.filter((item) => item.ready).map((item) => item.platform)
    : []);
  stage.querySelectorAll('.xhs2-site-row[data-platform]').forEach((row) => {
    const checkbox = row.querySelector('.xhs2-site-main');
    checkbox.disabled = !ready.has(row.dataset.platform);
    if (checkbox.disabled) checkbox.checked = false;
  });
  stage.querySelector('#xhsStart').disabled = ready.size === 0;
  stage.querySelector('#xhsStop').disabled = true;
  if (wb.publicMode) {
    stage.querySelector('#xhsStart').disabled = true;
    setMsg('公开页面展示真实工作台界面；采集操作仅在本地版本开放');
  } else if (!capability.ok || ready.size === 0) setMsg(capability.ok ? '统一采集环境未就绪' : `能力检查失败：${capability.error}`);
}
