// web/panels/template-preview.js —— 006 Remotion Studio 隔离式实时预览 + 生产配置选用（任务书 §4）
import { esc } from '../editor/editor-ui.js';
import {
  BUILTIN_TEMPLATE_PRESETS,
  DEFAULT_TEMPLATE_CONFIG,
  LEGACY_TEMPLATE_CONFIG_STORAGE_KEY,
  OLDEST_TEMPLATE_CONFIG_STORAGE_KEY,
  TEMPLATE_CONFIG_STORAGE_KEY,
  TEMPLATE_PRESETS_STORAGE_KEY,
  normalizeTemplateConfig,
  parseStoredTemplateConfig,
  parseStoredTemplatePresets,
  removeTemplatePreset,
  serializeTemplateConfig,
  serializeTemplatePresets,
  upsertTemplatePreset,
} from '../template-config.js';

let renderSequence = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const errorCopy = (code) => ({
  PREVIEW_PORT_IN_USE: '3108 端口已被其他程序占用，请先关闭占用程序。',
  PREVIEW_NOT_CONFIGURED: '006 的 Remotion 入口或本地依赖不完整，暂时无法启动。',
}[code] ?? code ?? '未知错误');

export async function render(stage, wb) {
  const sequence = ++renderSequence;
  stage.innerHTML = `
    <section class="panel-hero template-preview-hero">
      <div>
        <span class="panel-eyebrow">LIVE TEMPLATE STUDIO</span>
        <h2>在定稿之前，先看见变化。</h2>
        <p>直接预览 006 的真实视频组件，切换 VS Code、微信或 Claude 外壳并调整参数。这里只连接模板预览，不读取运行目录，也不触发正式生产。</p>
      </div>
      <div class="template-preview-hero-badge" id="templatePreviewBadge">
        <span></span><div><strong>正在检测</strong><small>Remotion Studio · 3108</small></div>
      </div>
    </section>

    <section class="card template-preview-card">
      <div class="template-preview-toolbar">
        <div class="template-preview-toolbar-copy">
          <span class="template-preview-live-dot" id="templatePreviewDot"></span>
          <div><strong id="templatePreviewTitle">正在连接预览服务</strong><small id="templatePreviewHint">请稍候…</small></div>
        </div>
        <div class="template-preview-actions">
          <button class="btn" type="button" id="templatePreviewStart">启动预览服务</button>
          <button class="btn" type="button" id="templatePreviewStop" hidden>关闭预览服务</button>
          <button class="btn" type="button" id="templatePreviewRefresh">刷新连接</button>
          <a class="btn btn-primary" id="templatePreviewOpen" href="http://127.0.0.1:3108/" target="_blank" rel="noopener">新窗口打开</a>
        </div>
      </div>
      <div class="template-config-card">
        <div class="template-config-head">
          <div class="template-config-copy">
            <span class="template-config-eyebrow">PRODUCTION TEMPLATE</span>
            <strong>视频生成使用的工作区外壳参数</strong>
            <small>Studio 里调好的值，只有点「用于视频生成」才会成为生产配置。</small>
          </div>
          <div class="template-config-prod" id="templateConfigProd">使用正式默认值</div>
        </div>
        <div class="template-preset-bar">
          <label><span>主题参数预设</span><select id="templatePresetSelect"></select></label>
          <button class="btn" type="button" id="templatePresetLoad">载入预设</button>
          <input id="templatePresetName" maxlength="30" placeholder="自定义预设名称" aria-label="自定义预设名称">
          <button class="btn" type="button" id="templatePresetSave">保存当前参数</button>
          <button class="btn btn-danger-subtle" type="button" id="templatePresetDelete" disabled>删除自定义预设</button>
          <small id="templatePresetStatus">载入只修改编辑草稿；点「用于视频生成」后才会成为生产配置。</small>
        </div>
        <div class="template-config-editor">
          <div class="template-config-fields">
            <label>画面外壳<select id="templateShellType"><option value="vscode">VS Code 工作台</option><option value="wechat">微信对话</option><option value="claude">Claude 对话</option></select></label>
            <label class="template-field-wide">工作区标题<input id="templateWorkspaceTitle" maxlength="80"></label>
            <label>强调色<input id="templateAccentColor" type="color"></label>
            <label>标题字号<input id="templateTitleSize" type="number" min="18" max="40"></label>
            <label class="template-field-wide" data-wechat-field>微信联系人<input id="templateWechatContact" maxlength="40"></label>
            <label data-wechat-field>头像字<input id="templateWechatAvatar" maxlength="2"></label>
            <label data-wechat-field>气泡色<input id="templateWechatBubble" type="color"></label>
            <label class="template-field-wide" data-claude-field>对话标题<input id="templateClaudeTitle" maxlength="40"></label>
            <label class="template-field-wide" data-claude-field>模型名<input id="templateClaudeModel" maxlength="40"></label>
            <label data-claude-field>头像字<input id="templateClaudeAvatar" maxlength="2"></label>
          </div>
          <div class="template-shell-mini" id="templateShellMini" aria-label="外壳参数实时预览"></div>
        </div>
        <div class="template-config-body">
          <div class="template-config-live">
            <span class="template-config-label">当前参数</span>
            <div class="template-config-values" id="templateConfigLive"><span class="template-config-empty">等待 Studio 回传…</span></div>
          </div>
          <div class="template-config-actions">
            <button class="btn btn-primary" type="button" id="templateConfigApply">用于视频生成</button>
            <button class="btn" type="button" id="templateConfigReset">恢复正式默认值</button>
          </div>
        </div>
      </div>
      <div class="template-preview-note">
        <span>提示</span><p>进入 Studio 后，在左侧选择 <code>template-realtime-preview</code>；右侧 Props 的修改会即时反映到画面。</p>
      </div>
      <div class="template-preview-host" id="templatePreviewHost" aria-live="polite">
        <div class="template-preview-loading"><span></span><strong>正在载入模板工作室</strong><small>检测本地 Remotion 服务状态</small></div>
      </div>
    </section>`;

  const badge = stage.querySelector('#templatePreviewBadge');
  const dot = stage.querySelector('#templatePreviewDot');
  const title = stage.querySelector('#templatePreviewTitle');
  const hint = stage.querySelector('#templatePreviewHint');
  const host = stage.querySelector('#templatePreviewHost');
  const startButton = stage.querySelector('#templatePreviewStart');
  const stopButton = stage.querySelector('#templatePreviewStop');
  const refreshButton = stage.querySelector('#templatePreviewRefresh');
  const openButton = stage.querySelector('#templatePreviewOpen');
  const configProdEl = stage.querySelector('#templateConfigProd');
  const configLiveEl = stage.querySelector('#templateConfigLive');
  const configApplyBtn = stage.querySelector('#templateConfigApply');
  const configResetBtn = stage.querySelector('#templateConfigReset');
  const presetSelect = stage.querySelector('#templatePresetSelect');
  const presetLoadBtn = stage.querySelector('#templatePresetLoad');
  const presetNameInput = stage.querySelector('#templatePresetName');
  const presetSaveBtn = stage.querySelector('#templatePresetSave');
  const presetDeleteBtn = stage.querySelector('#templatePresetDelete');
  const presetStatus = stage.querySelector('#templatePresetStatus');
  const shellTypeInput = stage.querySelector('#templateShellType');
  const workspaceTitleInput = stage.querySelector('#templateWorkspaceTitle');
  const accentColorInput = stage.querySelector('#templateAccentColor');
  const titleSizeInput = stage.querySelector('#templateTitleSize');
  const wechatContactInput = stage.querySelector('#templateWechatContact');
  const wechatAvatarInput = stage.querySelector('#templateWechatAvatar');
  const wechatBubbleInput = stage.querySelector('#templateWechatBubble');
  const claudeTitleInput = stage.querySelector('#templateClaudeTitle');
  const claudeModelInput = stage.querySelector('#templateClaudeModel');
  const claudeAvatarInput = stage.querySelector('#templateClaudeAvatar');
  const shellMini = stage.querySelector('#templateShellMini');
  let canStart = false;
  // 生产配置卡（任务书 §4）：只在面板连接 DOM 且 Remotion 在线时轮询草稿（750ms）
  let remotionOnline = false;
  let liveConfig = null;
  let liveSignature = '';
  let draftPollTimer = null;
  let customPresets = [];
  let deleteConfirmId = '';
  // 第 8 轮 P2（Codex）：代次令牌——stopDraftPoll/重启轮询时递增，废止在途请求：
  // 旧请求返回后既不能更新状态，也不能在 finally 里再次排期（防止在线刷新复制轮询链）
  let draftPollGen = 0;
  const DRAFT_POLL_MS = 750;

  // 第 4 轮 P2 修复（Codex P2）：存活判断改用本次渲染拥有的根节点 host 而非共享 stage——
  // 切换工具时框架只替换 stage.innerHTML（web/app.js switchTool），stage 始终连接、
  // renderSequence 也不变（本面板不再渲染），旧实现会让旧面板继续每 750ms 请求草稿
  // 并更新已脱离页面的节点；host 被替换即脱离文档 → isConnected=false → 轮询定时器链终止。
  const isCurrent = () => sequence === renderSequence && host.isConnected;

  function setBadge(state, heading, subline) {
    badge.className = `template-preview-hero-badge ${state}`;
    badge.querySelector('strong').textContent = heading;
    badge.querySelector('small').textContent = subline;
    dot.className = `template-preview-live-dot ${state}`;
  }

  function showOffline(data, message = '') {
    const portBusy = Boolean(data?.portBusy);
    const unavailable = data && !data.available;
    canStart = !portBusy && !unavailable;
    // 离线时停止草稿轮询并清空实时值（不残留旧值误导）
    remotionOnline = false;
    stopDraftPoll();
    setBadge('is-offline', '等待连接', `Remotion Studio · ${data?.url ? new URL(data.url).port : '3108'}`);
    title.textContent = portBusy ? '预览端口已被占用' : unavailable ? '预览环境不完整' : '预览服务尚未启动';
    hint.textContent = portBusy
      ? '关闭占用 3108 的其他程序后再试。'
      : unavailable
        ? '请检查 006 的 Remotion 入口与依赖。'
        : '可在这里安全启动 006 的本地 Studio。';
    startButton.hidden = false;
    startButton.disabled = !canStart;
    startButton.textContent = '启动预览服务';
    stopButton.hidden = true; // 2026-08-11：非在线状态不显示「关闭预览服务」
    openButton.href = data?.url ?? 'http://127.0.0.1:3108/';
    host.innerHTML = `
      <div class="template-preview-empty">
        <span>◇</span>
        <strong>${esc(title.textContent)}</strong>
        <small>${esc(message || hint.textContent)}</small>
      </div>`;
  }

  function showOnline(data) {
    canStart = false;
    setBadge('is-online', '实时预览在线', `Remotion Studio · ${new URL(data.url).port}`);
    title.textContent = '已连接 006 模板工作室';
    hint.textContent = '预览与参数面板保持在独立进程中。';
    startButton.hidden = false;
    startButton.disabled = true;
    startButton.textContent = '预览服务已启动';
    stopButton.hidden = false; // 2026-08-11：在线时可关闭
    openButton.href = data.url;
    remotionOnline = true;
    startDraftPoll();

    const frame = document.createElement('iframe');
    frame.className = 'template-preview-frame';
    frame.title = '006 Remotion 模板实时预览';
    frame.src = data.url;
    frame.allow = 'fullscreen; clipboard-write';
    frame.addEventListener('load', () => {
      if (!isCurrent()) return;
      hint.textContent = 'Studio 已载入；请选择 template-realtime-preview。';
    });
    host.replaceChildren(frame);
  }

  async function refreshStatus() {
    refreshButton.disabled = true;
    title.textContent = '正在检测预览服务';
    hint.textContent = '连接本机 3108 端口…';
    try {
      const result = await wb.api('/api/template-preview/status');
      if (!isCurrent()) return null;
      if (!result.ok) throw new Error(result.error);
      if (result.data.online) showOnline(result.data);
      else showOffline(result.data);
      return result.data;
    } catch (error) {
      if (isCurrent()) showOffline(null, `状态请求失败：${errorCopy(error.message)}`);
      return null;
    } finally {
      if (isCurrent()) refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', refreshStatus);
  // 2026-08-11 用户需求：关闭预览服务——停止 3108 上的 Studio 进程树后刷新回离线态
  stopButton.addEventListener('click', async () => {
    stopButton.disabled = true;
    hint.textContent = '正在关闭预览服务…';
    try {
      const result = await wb.api('/api/template-preview/stop', { method: 'POST' });
      if (!result.ok) {
        hint.textContent = `关闭失败：${result.error}`;
        stopButton.disabled = false;
        return;
      }
      hint.textContent = result.data.stopped ? '预览服务已关闭。' : '未发现运行中的预览服务。';
      await refreshStatus();
    } catch (error) {
      hint.textContent = `关闭异常：${error.message}`;
      stopButton.disabled = false;
    }
  });
  startButton.addEventListener('click', async () => {
    canStart = false;
    startButton.disabled = true;
    startButton.textContent = '正在启动…';
    refreshButton.disabled = true;
    setBadge('is-starting', '正在启动', 'Remotion Studio · 3108');
    title.textContent = '正在启动 006 模板工作室';
    hint.textContent = '首次构建通常需要几秒钟。';
    host.innerHTML = '<div class="template-preview-loading"><span></span><strong>正在构建预览</strong><small>无需下载或安装新依赖</small></div>';
    try {
      const result = await wb.api('/api/template-preview/start', { method: 'POST' });
      if (!result.ok) throw new Error(result.error);
      for (let attempt = 0; attempt < 30 && isCurrent(); attempt += 1) {
        await delay(500);
        const status = await wb.api('/api/template-preview/status');
        if (status.ok && status.data.online) {
          showOnline(status.data);
          return;
        }
      }
      throw new Error('预览服务启动超时，请刷新连接重试。');
    } catch (error) {
      if (isCurrent()) showOffline(null, errorCopy(error.message));
    } finally {
      if (isCurrent()) {
        startButton.disabled = !canStart;
        refreshButton.disabled = false;
      }
    }
  });

  // —— 生产配置卡逻辑（任务书 §4）——
  // 「当前生产配置」：localStorage 里已选配置；未选过/损坏时显示默认值（损坏 JSON 直接删键回默认）
  function readProd() {
    const current = parseStoredTemplateConfig(localStorage.getItem(TEMPLATE_CONFIG_STORAGE_KEY));
    if (current.config) return current.config;
    if (current.invalid) localStorage.removeItem(TEMPLATE_CONFIG_STORAGE_KEY);
    for (const key of [LEGACY_TEMPLATE_CONFIG_STORAGE_KEY, OLDEST_TEMPLATE_CONFIG_STORAGE_KEY]) {
      const legacy = parseStoredTemplateConfig(localStorage.getItem(key));
      if (legacy.config) {
        localStorage.setItem(TEMPLATE_CONFIG_STORAGE_KEY, serializeTemplateConfig(legacy.config));
        localStorage.removeItem(LEGACY_TEMPLATE_CONFIG_STORAGE_KEY);
        localStorage.removeItem(OLDEST_TEMPLATE_CONFIG_STORAGE_KEY);
        return legacy.config;
      }
      if (legacy.invalid) localStorage.removeItem(key);
    }
    return null;
  }

  const shellLabel = (shellType) => ({ vscode: 'VS Code', wechat: '微信对话', claude: 'Claude 对话' }[shellType] ?? shellType);

  function renderProd() {
    const config = readProd();
    configProdEl.textContent = config
      ? `${shellLabel(config.shellType)} · ${config.workspaceTitle}`
      : '使用正式默认值';
  }

  function readPresets() {
    const result = parseStoredTemplatePresets(localStorage.getItem(TEMPLATE_PRESETS_STORAGE_KEY));
    if (result.invalid) localStorage.removeItem(TEMPLATE_PRESETS_STORAGE_KEY);
    return result.presets;
  }

  function allPresets() {
    return [...BUILTIN_TEMPLATE_PRESETS, ...customPresets.map((preset) => ({ ...preset, builtin: false }))];
  }

  function selectedPreset() {
    return allPresets().find((preset) => preset.id === presetSelect.value) ?? null;
  }

  function renderPresetSelect(selectedId = presetSelect.value) {
    const options = allPresets();
    presetSelect.innerHTML = options.map((preset) =>
      `<option value="${esc(preset.id)}">${preset.builtin ? '内置 · ' : '自定义 · '}${esc(preset.name)}</option>`,
    ).join('');
    presetSelect.value = options.some((preset) => preset.id === selectedId) ? selectedId : options[0].id;
    const selected = selectedPreset();
    presetNameInput.value = selected && !selected.builtin ? selected.name : '';
    presetDeleteBtn.disabled = !selected || selected.builtin;
    presetSaveBtn.textContent = selected && !selected.builtin ? '更新当前预设' : '保存当前参数';
    deleteConfirmId = '';
    presetDeleteBtn.textContent = '删除自定义预设';
  }

  function persistPresets() {
    localStorage.setItem(TEMPLATE_PRESETS_STORAGE_KEY, serializeTemplatePresets(customPresets));
  }

  function renderMini(config) {
    if (config.shellType === 'wechat') {
      shellMini.innerHTML = `<div class="shell-mini-wechat"><div class="shell-mini-bar">${esc(config.wechatContact)}</div><div class="shell-mini-chat"><i style="--avatar:${esc(config.accentColor)}">${esc(config.wechatAvatarText)}</i><span style="--bubble:${esc(config.wechatBubbleColor)}"><b>${esc(config.workspaceTitle)}</b><small>视频分享卡片</small></span></div></div>`;
      return;
    }
    if (config.shellType === 'claude') {
      shellMini.innerHTML = `<div class="shell-mini-claude"><div class="shell-mini-claude-side"><i style="--avatar:${esc(config.accentColor)}">${esc(config.claudeAvatarText)}</i></div><div class="shell-mini-claude-main"><div><b>${esc(config.claudeTitle)}</b><small>${esc(config.claudeModel)}</small></div><p>${esc(config.workspaceTitle)}</p></div></div>`;
      return;
    }
    shellMini.innerHTML = `<div class="shell-mini-code"><div class="shell-mini-title"><i></i><i></i><i></i><b style="font-size:${esc(Math.max(9, Math.round(config.workspaceTitleSize / 2)))}px">${esc(config.workspaceTitle)}</b></div><div class="shell-mini-codebody"><span></span><strong style="--accent:${esc(config.accentColor)}">TEMPLATE<br>PREVIEW</strong></div></div>`;
  }

  function renderLive(config) {
    configApplyBtn.disabled = !config;
    configApplyBtn.title = config ? '' : '当前参数不合法';
    if (!config) {
      configLiveEl.innerHTML = '<span class="template-config-empty">请检查字段范围</span>';
      return;
    }
    configLiveEl.innerHTML =
      `<span class="template-config-chip">${shellLabel(config.shellType)}</span>` +
      `<span class="template-config-chip">${esc(config.workspaceTitle)}</span>` +
      `<span class="template-config-chip template-config-chip-color" style="--chip-color:${esc(config.accentColor)}">${esc(config.accentColor)}</span>` +
      `<span class="template-config-chip">${esc(config.workspaceTitleSize)}px</span>` +
      (config.shellType === 'claude' ? `<span class="template-config-chip">${esc(config.claudeModel)}</span>` : '');
    renderMini(config);
  }

  function updateFieldVisibility(shellType) {
    stage.querySelectorAll('[data-wechat-field]').forEach((field) => { field.hidden = shellType !== 'wechat'; });
    stage.querySelectorAll('[data-claude-field]').forEach((field) => { field.hidden = shellType !== 'claude'; });
  }

  function collectEditor() {
    try {
      return normalizeTemplateConfig({
        schemaVersion: 3,
        shellType: shellTypeInput.value,
        workspaceTitle: workspaceTitleInput.value,
        accentColor: accentColorInput.value,
        workspaceTitleSize: Number(titleSizeInput.value),
        wechatContact: wechatContactInput.value,
        wechatAvatarText: wechatAvatarInput.value,
        wechatBubbleColor: wechatBubbleInput.value,
        claudeTitle: claudeTitleInput.value,
        claudeModel: claudeModelInput.value,
        claudeAvatarText: claudeAvatarInput.value,
      });
    } catch {
      return null;
    }
  }

  function loadEditor(config) {
    shellTypeInput.value = config.shellType;
    workspaceTitleInput.value = config.workspaceTitle;
    accentColorInput.value = config.accentColor;
    titleSizeInput.value = String(config.workspaceTitleSize);
    wechatContactInput.value = config.wechatContact;
    wechatAvatarInput.value = config.wechatAvatarText;
    wechatBubbleInput.value = config.wechatBubbleColor;
    claudeTitleInput.value = config.claudeTitle;
    claudeModelInput.value = config.claudeModel;
    claudeAvatarInput.value = config.claudeAvatarText;
    updateFieldVisibility(config.shellType);
    liveConfig = config;
    liveSignature = JSON.stringify(config);
    renderLive(config);
  }

  function editorChanged() {
    updateFieldVisibility(shellTypeInput.value);
    liveConfig = collectEditor();
    liveSignature = JSON.stringify(liveConfig);
    renderLive(liveConfig);
  }

  for (const input of [shellTypeInput, workspaceTitleInput, accentColorInput, titleSizeInput, wechatContactInput, wechatAvatarInput, wechatBubbleInput, claudeTitleInput, claudeModelInput, claudeAvatarInput]) {
    input.addEventListener('input', editorChanged);
    input.addEventListener('change', editorChanged);
  }

  function stopDraftPoll() {
    draftPollGen += 1; // 废止在途请求（即使请求已发出，返回后也不得继续）
    if (draftPollTimer) {
      clearTimeout(draftPollTimer);
      draftPollTimer = null;
    }
  }

  // 草稿轮询：仅面板连接 DOM 且 Remotion 在线时运行；每轮校验代次与 isCurrent，离开面板即停
  async function pollDraft() {
    const gen = draftPollGen;
    if (!isCurrent() || !remotionOnline) return;
    try {
      const r = await wb.api('/api/template-preview/draft');
      if (gen !== draftPollGen || !isCurrent()) return; // 旧代次：不更新状态
      if (!r.ok) throw new Error(r.error || '草稿读取失败');
      const config = r.data?.available ? r.data.config : null;
      const signature = JSON.stringify(config ?? null);
      if (signature !== liveSignature) {
        if (config) loadEditor(config);
      }
    } catch {
      // 轮询失败静默重试，不打断预览面板
    } finally {
      // 只有当前代次才允许再次排期——旧请求的 finally 不得复制轮询链
      if (gen === draftPollGen && isCurrent() && remotionOnline) draftPollTimer = setTimeout(pollDraft, DRAFT_POLL_MS);
    }
  }

  function startDraftPoll() {
    stopDraftPoll();
    if (!isCurrent() || !remotionOnline) return;
    draftPollTimer = setTimeout(pollDraft, DRAFT_POLL_MS);
  }

  // 主按钮：只更新 008 自己的本地选择（localStorage），不触发视频、不启动 Remotion
  configApplyBtn.addEventListener('click', () => {
    if (!liveConfig) return;
    localStorage.setItem(TEMPLATE_CONFIG_STORAGE_KEY, serializeTemplateConfig(liveConfig));
    renderProd();
    hint.textContent = '已设为当前生产配置（不触发视频，不启动 Remotion）。';
  });

  // 次按钮：直接把正式默认值设为当前生产配置，不依赖 Studio 在线
  configResetBtn.addEventListener('click', () => {
    localStorage.setItem(TEMPLATE_CONFIG_STORAGE_KEY, serializeTemplateConfig(DEFAULT_TEMPLATE_CONFIG));
    loadEditor(DEFAULT_TEMPLATE_CONFIG);
    renderProd();
    hint.textContent = '已恢复正式默认值。';
  });

  presetSelect.addEventListener('change', () => {
    const selected = selectedPreset();
    presetNameInput.value = selected && !selected.builtin ? selected.name : '';
    presetDeleteBtn.disabled = !selected || selected.builtin;
    presetSaveBtn.textContent = selected && !selected.builtin ? '更新当前预设' : '保存当前参数';
    deleteConfirmId = '';
    presetDeleteBtn.textContent = '删除自定义预设';
    presetStatus.textContent = selected?.builtin ? '这是内置预设，可载入但不会被覆盖或删除。' : '这是自定义预设，可更新或删除。';
  });

  presetLoadBtn.addEventListener('click', () => {
    const selected = selectedPreset();
    if (!selected) return;
    loadEditor(selected.config);
    presetStatus.textContent = `已载入「${selected.name}」到编辑草稿；生产配置尚未改变。`;
  });

  presetSaveBtn.addEventListener('click', () => {
    const config = collectEditor();
    const name = presetNameInput.value.trim();
    if (!config) {
      presetStatus.textContent = '当前参数不合法，无法保存。';
      return;
    }
    if (!name) {
      presetStatus.textContent = '请先填写自定义预设名称。';
      presetNameInput.focus();
      return;
    }
    const selected = selectedPreset();
    const id = selected && !selected.builtin
      ? selected.id
      : `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      customPresets = upsertTemplatePreset(customPresets, { id, name, config });
      persistPresets();
      renderPresetSelect(id);
      presetStatus.textContent = `${selected && !selected.builtin ? '已更新' : '已保存'}「${name}」；生产配置尚未改变。`;
    } catch {
      presetStatus.textContent = '保存失败：最多保留 12 个自定义预设，名称不超过 30 字。';
    }
  });

  presetDeleteBtn.addEventListener('click', () => {
    const selected = selectedPreset();
    if (!selected || selected.builtin) return;
    if (deleteConfirmId !== selected.id) {
      deleteConfirmId = selected.id;
      presetDeleteBtn.textContent = '再次点击确认删除';
      presetStatus.textContent = `将删除自定义预设「${selected.name}」，再次点击按钮确认。`;
      return;
    }
    customPresets = removeTemplatePreset(customPresets, selected.id);
    persistPresets();
    renderPresetSelect();
    presetStatus.textContent = `已删除自定义预设「${selected.name}」。`;
  });

  customPresets = readPresets();
  renderPresetSelect();
  loadEditor(readProd() ?? DEFAULT_TEMPLATE_CONFIG);
  renderProd();
  await refreshStatus();
}
