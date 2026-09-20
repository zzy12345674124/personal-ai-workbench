// 多平台评论采集面板：公共任务 API；抖音、小红书、B站共享同一合同。
const PLATFORM_LABELS = { douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B站' };
const STATE_LABELS = {
  queued: '排队中', starting: '启动中', checking_login: '检查登录',
  waiting_login: '登录已失效', waiting_human_check: '等待人工验证',
  searching: '搜索视频', collecting_comments: '采集评论', paused: '已暂停',
  cooling_down: '限流冷却', completed: '已完成', partial: '部分完成',
  failed: '失败', stopped: '已停止',
};
const TERMINAL = new Set(['completed', 'partial', 'failed', 'stopped']);
const ATTENTION = new Set(['waiting_login', 'waiting_human_check']);
const isFinished = (data) => TERMINAL.has(data.state) || (ATTENTION.has(data.state) && data.running === false);
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
  stage.innerHTML = `
    <div class="collector-host" id="collectorHost">
      <div class="collector-heading">
        <div><h2>多平台评论采集</h2><p class="muted">本地脚本运行；采集过程不调用大模型</p></div>
        <span class="collector-badge" id="collectorCapability">检查环境…</span>
      </div>
      <div class="collector-grid">
        <section class="card collector-form-card">
          <h3>任务设置</h3>
          <label class="collector-field"><span>平台</span><select id="collectorPlatform"><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="bilibili">B站</option></select></label>
          <label class="collector-field"><span>关键词</span><input id="collectorKeyword" maxlength="50" placeholder="例如：人工智能"></label>
          <div class="collector-fields-2">
            <label class="collector-field"><span>视频上限</span><input id="collectorContents" type="number" min="1" max="100" value="5"></label>
            <label class="collector-field"><span>每个视频评论上限</span><input id="collectorComments" type="number" min="1" max="1000" value="50"></label>
            <label class="collector-field"><span>评论页数上限</span><input id="collectorPages" type="number" min="1" max="100" value="3"></label>
            <label class="collector-field"><span>运行时长上限（分钟）</span><input id="collectorMinutes" type="number" min="1" max="480" value="30"></label>
          </div>
          <div class="collector-fields-2">
            <label class="collector-field"><span>最短等待（秒）</span><input id="collectorMinDelay" type="number" min="0.5" max="60" step="0.5" value="1.5"></label>
            <label class="collector-field"><span>最长等待（秒）</span><input id="collectorMaxDelay" type="number" min="0.5" max="120" step="0.5" value="4"></label>
          </div>
          <label class="collector-check"><input type="checkbox" checked disabled><span>显示 CloakBrowser 窗口（首版固定开启）</span></label>
          <p class="collector-note">遇到登录失效、验证码或访问频繁时会停止推进，不会自动绕过。</p>
          <div class="collector-actions">
            <button class="btn btn-primary" id="collectorStart" disabled>启动采集</button>
            <button class="btn" id="collectorPause" disabled>暂停</button>
            <button class="btn" id="collectorResume" disabled>继续</button>
            <button class="btn" id="collectorStop" disabled>停止</button>
            <span class="muted" id="collectorMessage"></span>
          </div>
        </section>
        <section class="card collector-status-card">
          <div class="collector-status-head"><h3>任务状态</h3><span class="collector-state" id="collectorState">未启动</span></div>
          <div class="collector-metrics">
            <div><strong id="collectorContentCount">0</strong><span>视频</span></div>
            <div><strong id="collectorCommentCount">0</strong><span>评论</span></div>
          </div>
          <pre class="collector-log" id="collectorLog">等待任务…</pre>
        </section>
      </div>
    </div>`;

  const host = stage.querySelector('#collectorHost');
  const capabilityEl = stage.querySelector('#collectorCapability');
  const startButton = stage.querySelector('#collectorStart');
  const pauseButton = stage.querySelector('#collectorPause');
  const resumeButton = stage.querySelector('#collectorResume');
  const stopButton = stage.querySelector('#collectorStop');
  const messageEl = stage.querySelector('#collectorMessage');
  const stateEl = stage.querySelector('#collectorState');
  const logEl = stage.querySelector('#collectorLog');
  let jobId = null;
  let pollGeneration = 0;

  const value = (selector) => stage.querySelector(selector).value;
  const integer = (selector) => Number.parseInt(value(selector), 10);
  const delay = (selector) => Math.round(Number.parseFloat(value(selector)) * 1000);
  const setMessage = (text) => { messageEl.textContent = text; };

  const renderStatus = (data) => {
    const state = data.state || 'unknown';
    stateEl.textContent = STATE_LABELS[state] || state;
    stage.querySelector('#collectorContentCount').textContent = String(data.contentCount ?? 0);
    stage.querySelector('#collectorCommentCount').textContent = String(data.commentCount ?? 0);
    const eventLines = Array.isArray(data.events)
      ? data.events.map((line) => {
        try {
          const event = JSON.parse(line);
          return `${formatEventTime(event.at)}  ${STATE_LABELS[event.state] || event.state || ''}${event.code ? `  ${event.code}` : ''}`;
        } catch { return ''; }
      }).filter(Boolean)
      : [];
    logEl.textContent = eventLines.length ? eventLines.join('\n') : `${STATE_LABELS[state] || state}`;
    logEl.scrollTop = logEl.scrollHeight;
    pauseButton.disabled = !['checking_login', 'searching', 'collecting_comments', 'cooling_down'].includes(state);
    resumeButton.disabled = state !== 'paused';
    if (state === 'waiting_login' && data.running !== false) {
      setMessage('登录已失效：请在已打开的 CloakBrowser 输入账号或扫码，登录成功后自动继续');
    } else if (state === 'waiting_human_check' && data.running !== false) {
      setMessage('请在已打开的 CloakBrowser 完成人工验证，通过后自动继续');
    }
    if (isFinished(data)) {
      startButton.disabled = false;
      pauseButton.disabled = true;
      resumeButton.disabled = true;
      stopButton.disabled = true;
      setMessage(state === 'completed' ? '采集完成，结果已按任务隔离保存'
        : ATTENTION.has(state) ? `${STATE_LABELS[state]}；处理后可重新启动任务`
          : `任务结束：${STATE_LABELS[state] || state}`);
    }
  };

  const schedulePoll = (generation) => {
    setTimeout(async () => {
      if (!host.isConnected || generation !== pollGeneration || !jobId) return;
      const result = await wb.api(`/api/collector/status?id=${encodeURIComponent(jobId)}`);
      if (!host.isConnected || generation !== pollGeneration) return;
      if (!result.ok) {
        setMessage(`状态查询失败：${result.error}`);
        schedulePoll(generation);
        return;
      }
      renderStatus(result.data);
      if (!isFinished(result.data)) schedulePoll(generation);
    }, 1500);
  };

  startButton.addEventListener('click', async () => {
    const keyword = value('#collectorKeyword').trim();
    if (!keyword) { setMessage('请输入关键词'); return; }
    const minActionDelayMs = delay('#collectorMinDelay');
    const maxActionDelayMs = delay('#collectorMaxDelay');
    if (!Number.isFinite(minActionDelayMs) || !Number.isFinite(maxActionDelayMs) || maxActionDelayMs < minActionDelayMs) {
      setMessage('等待区间无效：最长等待不能小于最短等待'); return;
    }
    startButton.disabled = true;
    setMessage('正在创建任务…');
    const result = await wb.api('/api/collector/start', {
      method: 'POST',
      body: JSON.stringify({
        platform: value('#collectorPlatform'), keywords: [keyword],
        limits: {
          maxContentsPerKeyword: integer('#collectorContents'),
          maxCommentsPerContent: integer('#collectorComments'),
          maxPagesPerContent: integer('#collectorPages'),
          maxRuntimeMinutes: integer('#collectorMinutes'),
        },
        timing: { minActionDelayMs, maxActionDelayMs, cooldownAfterRateLimitMs: 300000 },
        browser: { visible: true }, contentFilter: '',
      }),
    });
    if (!result.ok) {
      startButton.disabled = false;
      setMessage(`启动失败：${result.error}`);
      return;
    }
    jobId = result.data.jobId;
    pollGeneration += 1;
    stopButton.disabled = false;
    stateEl.textContent = '已创建';
    logEl.textContent = jobId;
    setMessage('任务已启动');
    schedulePoll(pollGeneration);
  });

  stopButton.addEventListener('click', async () => {
    if (!jobId) return;
    stopButton.disabled = true;
    const result = await wb.api('/api/collector/stop', {
      method: 'POST', body: JSON.stringify({ id: jobId }),
    });
    setMessage(result.ok && result.data.stopped ? '已请求停止' : '任务已不在运行');
  });

  pauseButton.addEventListener('click', async () => {
    if (!jobId) return;
    pauseButton.disabled = true;
    const result = await wb.api('/api/collector/pause', {
      method: 'POST', body: JSON.stringify({ id: jobId }),
    });
    setMessage(result.ok && result.data.paused ? '已请求暂停，将在安全控制点停下' : '任务已不在运行');
  });

  resumeButton.addEventListener('click', async () => {
    if (!jobId) return;
    resumeButton.disabled = true;
    const result = await wb.api('/api/collector/resume', {
      method: 'POST', body: JSON.stringify({ id: jobId }),
    });
    setMessage(result.ok && result.data.resumed ? '已请求继续' : '任务已不在运行');
  });

  const capability = await wb.api('/api/collector/capabilities');
  if (!host.isConnected) return;
  const ready = new Set(capability.ok ? capability.data.platforms?.filter((item) => item.ready).map((item) => item.platform) : []);
  const platformInput = stage.querySelector('#collectorPlatform');
  for (const option of platformInput.options) option.disabled = !ready.has(option.value);
  if (!ready.has(platformInput.value)) platformInput.value = [...ready][0] || '';
  const available = Boolean(capability.ok && ready.size && capability.data.pythonConfigured && capability.data.realCollectionEnabled);
  capabilityEl.textContent = available ? `${[...ready].map((item) => PLATFORM_LABELS[item] || item).join('、')}已就绪 · 零模型 Token` : '采集环境未就绪';
  capabilityEl.classList.toggle('is-ready', available);
  startButton.disabled = !available;
  if (!available) setMessage(capability.ok ? '请先修复采集运行环境' : `能力检查失败：${capability.error}`);
}
