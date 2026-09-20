// web/panels/video.js —— 视频生成工具（拖拽组合 → 006 流水线 → 人工闸门）
// 2026-08-08 Task 7 版本集成：media 记录 version（场景对象持久化/提交透传），场景槽显示版本名
// 审查修复（Important #2）：面板级卸载标记——重新 render 时复位；轮询每轮检查
// disposed 与 progress.isConnected，防止面板切换后继续轮询已脱离 DOM 的节点
import { esc } from '../editor/editor-ui.js';
import { LEGACY_TEMPLATE_CONFIG_STORAGE_KEY, OLDEST_TEMPLATE_CONFIG_STORAGE_KEY, TEMPLATE_CONFIG_STORAGE_KEY, parseStoredTemplateConfig, serializeTemplateConfig } from '../template-config.js';

function readSelectedTemplateConfig() {
  const current = parseStoredTemplateConfig(localStorage.getItem(TEMPLATE_CONFIG_STORAGE_KEY));
  if (current.config) return current;
  if (current.invalid) localStorage.removeItem(TEMPLATE_CONFIG_STORAGE_KEY);
  for (const key of [LEGACY_TEMPLATE_CONFIG_STORAGE_KEY, OLDEST_TEMPLATE_CONFIG_STORAGE_KEY]) {
    const legacy = parseStoredTemplateConfig(localStorage.getItem(key));
    if (legacy.config) {
      localStorage.setItem(TEMPLATE_CONFIG_STORAGE_KEY, serializeTemplateConfig(legacy.config));
      localStorage.removeItem(LEGACY_TEMPLATE_CONFIG_STORAGE_KEY);
      localStorage.removeItem(OLDEST_TEMPLATE_CONFIG_STORAGE_KEY);
      return legacy;
    }
    if (legacy.invalid) localStorage.removeItem(key);
  }
  return { config: null, invalid: false };
}

// 第 4 轮 P1 修复（Codex P1）：未选配置时不得向请求体追加 templateConfig:null——
// JSON.stringify 会保留该字段，服务端按合同将「字段存在但无效」判 400 BAD_TEMPLATE_CONFIG，
// 首次使用/损坏回退都拿不到默认快照。仅当已选配置非空时追加字段；否则省略，由服务端写默认快照（任务书 §5）。
export function buildVideoSubmitBody({ topic, angle, sceneDraft, mode, timeliness, timelinessRules, templateConfig }) {
  const body = { topic, angle, sceneDraft, mode, timeliness, timelinessRules };
  if (templateConfig) body.templateConfig = templateConfig;
  return body;
}

let disposed = false;
// 最终审查修复（M-1，spec §6）：running/rendering 超过 15 分钟无终态 → 停止自动轮询
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const formatNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '0';
};
const formatUsd = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : '0.0000';
};

export async function render(stage, wb) {
  disposed = false;
  stage.innerHTML = `
    <section class="panel-hero video-hero">
      <div>
        <span class="panel-eyebrow">AI VIDEO STUDIO</span>
        <h2>从一个主题，生成完整视频。</h2>
        <p>完成文案、分镜、配音、字幕、渲染与视觉质检，并在生产前保留人工确认。</p>
      </div>
      <div class="pipeline-chips" aria-label="视频生产阶段">
        <span>文案</span><span>分镜</span><span>配音</span><span>渲染</span><span>质检</span>
      </div>
    </section>

    <div class="video-workspace">
      <section class="card video-setup-card">
        <div class="section-heading">
          <span class="section-number">01</span>
          <div><h3>创作设置</h3><p>先定义内容，再选择运行方式。</p></div>
        </div>
        <div class="voice-capture" id="vVoiceCapture">
          <div class="voice-capture-head">
            <div><strong>口述成片</strong><small>录音只在本机临时转写；文字经人工闸门后才进入分镜、旁白与字幕。</small></div>
            <span class="voice-status" id="vVoiceStatus">正在检测本地识别器…</span>
          </div>
          <div class="voice-capture-actions">
            <button class="btn" type="button" id="vVoiceStart">● 开始口述</button>
            <button class="btn" type="button" id="vVoiceStop" disabled>停止并转写</button>
            <button class="btn btn-text" type="button" id="vVoiceClear">清空文字</button>
          </div>
          <label>转写文字（可先修改再提交）
            <textarea id="vVoiceTranscript" rows="4" placeholder="点「开始口述」，或直接粘贴一段口述稿。"></textarea>
          </label>
        </div>
        <div class="video-form-grid">
          <label class="field-wide">主题
            <input id="vTopic" placeholder="例如：什么是 RAG？">
          </label>
          <label class="field-wide">角度与受众
            <input id="vAngle" placeholder="例如：给新手 / 面向开发者（可选）">
          </label>
          <label>运行模式
            <select id="vMode">
              <option value="fallback">降级模式 · DeepSeek</option>
              <option value="normal">正常模式 · Codex（需梯子）</option>
            </select>
            <small>决定草稿和裁决阶段使用的模型。</small>
          </label>
          <label>时效模式
            <select id="vTimeliness">
              <option value="strict">严格 · 新闻与热点</option>
              <option value="relaxed">宽松 · 常青与教程</option>
              <option value="custom">自定义时间要求</option>
            </select>
            <small>严格模式会搜索并优先使用当月信息。</small>
          </label>
          <div id="vTimelinessCustomWrap" class="field-wide" hidden>
            <label>自定义时效要求
              <input id="vTimelinessCustom" placeholder="例如：只收录 2026-08-01 至 2026-08-07 之间的信息">
            </label>
          </div>
        </div>
        <div class="video-actions">
          <button class="btn btn-primary" id="vSubmit">提交生成</button>
          <button class="btn" id="vConfirm">确认生产</button>
          <button class="btn btn-quiet-danger" id="vCancel">取消运行</button>
        </div>
        <div class="video-template-summary" id="vTemplateSummary"></div>
      </section>

      <section class="card video-scenes-card" id="vScenes">
        <div class="section-heading">
          <span class="section-number">02</span>
          <div><h3 id="vScenesTitle">场景与素材 · 0 个</h3><p>从素材预览器拖入，顺序即分镜顺序。</p></div>
        </div>
        <div id="vSlot" class="scene-slot"><div class="scene-empty">把素材卡片拖到这里</div></div>
      </section>
    </div>

    <div class="video-feedback">
      <div id="vNotice"></div>
      <div id="vProgress"></div>
    </div>
    <section class="card video-history-card" id="vHistory"><div class="history-loading">正在读取历史运行…</div></section>`;

  const slot = stage.querySelector('#vSlot');
  const voiceCard = stage.querySelector('#vVoiceCapture');
  const voiceStatus = stage.querySelector('#vVoiceStatus');
  const voiceStart = stage.querySelector('#vVoiceStart');
  const voiceStop = stage.querySelector('#vVoiceStop');
  const voiceClear = stage.querySelector('#vVoiceClear');
  const voiceTranscript = stage.querySelector('#vVoiceTranscript');
  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceLimitTimer = null;
  let discardVoice = false;

  const releaseVoice = () => {
    if (voiceLimitTimer) clearTimeout(voiceLimitTimer);
    voiceLimitTimer = null;
    voiceStream?.getTracks?.().forEach((track) => track.stop());
    voiceStream = null;
    voiceRecorder = null;
    voiceChunks = [];
  };
  const onToolSwitch = (event) => {
    if (event.detail?.from !== 'video') return;
    discardVoice = true;
    if (voiceRecorder?.state === 'recording') voiceRecorder.stop();
    releaseVoice();
    window.removeEventListener('workbench:tool-switch', onToolSwitch);
  };
  window.addEventListener('workbench:tool-switch', onToolSwitch);

  async function transcribeVoice(blob) {
    if (!voiceCard.isConnected) return;
    voiceStatus.textContent = '本地转写中…';
    voiceStart.disabled = true;
    voiceStop.disabled = true;
    try {
      const r = await wb.api('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
      if (!r.ok) throw new Error(r.error);
      voiceTranscript.value = r.data.transcript ?? '';
      if (!stage.querySelector('#vTopic').value.trim() && voiceTranscript.value.trim()) {
        stage.querySelector('#vTopic').value = voiceTranscript.value.trim().slice(0, 60);
      }
      voiceStatus.textContent = voiceTranscript.value.trim() ? '转写完成，可编辑后提交' : '未识别到清晰语音，请重试';
    } catch (error) {
      voiceStatus.textContent = `转写失败：${error.message}`;
    } finally {
      if (voiceCard.isConnected) voiceStart.disabled = false;
      releaseVoice();
    }
  }

  voiceStart.addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      voiceStatus.textContent = '当前浏览器不支持录音';
      return;
    }
    voiceStart.disabled = true;
    voiceStatus.textContent = '等待麦克风权限…';
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      discardVoice = false;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported?.(type));
      voiceRecorder = preferred ? new MediaRecorder(voiceStream, { mimeType: preferred }) : new MediaRecorder(voiceStream);
      voiceChunks = [];
      voiceRecorder.addEventListener('dataavailable', (event) => { if (event.data?.size) voiceChunks.push(event.data); });
      voiceRecorder.addEventListener('stop', () => {
        if (discardVoice) return;
        const blob = new Blob(voiceChunks, { type: voiceRecorder?.mimeType || preferred || 'audio/webm' });
        transcribeVoice(blob);
      }, { once: true });
      voiceRecorder.start(500);
      voiceStatus.textContent = '正在录音·最长 5 分钟';
      voiceStop.disabled = false;
      voiceLimitTimer = setTimeout(() => { if (voiceRecorder?.state === 'recording') voiceRecorder.stop(); }, 5 * 60 * 1000);
    } catch (error) {
      voiceStatus.textContent = `无法开始录音：${error.message}`;
      voiceStart.disabled = false;
      releaseVoice();
    }
  });
  voiceStop.addEventListener('click', () => {
    if (voiceRecorder?.state === 'recording') voiceRecorder.stop();
    voiceStop.disabled = true;
  });
  voiceClear.addEventListener('click', () => {
    voiceTranscript.value = '';
    voiceStatus.textContent = '转写文字已清空';
  });
  wb.api('/api/voice/status').then((r) => {
    if (!voiceCard.isConnected) return;
    voiceStatus.textContent = r.ok && r.data.available ? '本地中文识别器就绪' : '本地识别器不可用';
    voiceStart.disabled = !(r.ok && r.data.available);
  }).catch(() => { if (voiceCard.isConnected) voiceStatus.textContent = '识别器状态检测失败'; });
  // 修复 #3 补全（2026-08-06 用户确认）：场景草稿持久化到 localStorage——
  // 此前 scenes 只在内存，切面板重新渲染后素材全部丢失（用户实测确认）
  let scenes = [];
  try { scenes = JSON.parse(localStorage.getItem('wb.videoScenes') ?? '[]') ?? []; } catch { scenes = []; }
  // 2026-08-06（用户指示）：场景草稿支持删除——每项 ✕ 按钮 + 清空全部（防错选素材污染场景）
  // 2026-08-08 多模态扩展：媒体类型标签（html=交互素材 / image / video / prompt）
  const mediaTag = (kind) => ({ html: '🧩', image: '🖼', video: '🎬', prompt: '📝' }[kind] ?? '❔');
  const renderScenes = () => {
    localStorage.setItem('wb.videoScenes', JSON.stringify(scenes));
    stage.querySelector('#vScenesTitle').textContent = `场景与素材 · ${scenes.length} 个`;
    slot.innerHTML = scenes.length
      ? scenes.map((s, i) =>
          `<div class="scene-item">` +
          `<span class="scene-index">${String(i + 1).padStart(2, '0')}</span>` +
          `<span class="scene-media">${mediaTag(s.media?.[0]?.kind ?? 'html')}</span>` +
          `<span class="scene-copy"><strong>${esc(s.title)}</strong>${s.media?.[0]?.version ? `<small>${esc(s.media[0].version)}</small>` : '<small>原版素材</small>'}</span>` +
          // 2026-08-11 用户需求：场景顺序调整（顺序即分镜顺序）——首行无↑、末行无↓
          `<span class="scene-actions">` +
          `${i > 0 ? `<button class="btn scene-move" data-i="${i}" data-dir="up" aria-label="上移场景">↑</button>` : ''}` +
          `${i < scenes.length - 1 ? `<button class="btn scene-move" data-i="${i}" data-dir="down" aria-label="下移场景">↓</button>` : ''}` +
          `<button class="btn scene-del" data-i="${i}" aria-label="删除场景">×</button></span></div>`
        ).join('') +
        `<div class="scene-footer"><button class="btn btn-text" id="vClearScenes">清空全部</button></div>`
      : '<div class="scene-empty"><span>＋</span><strong>拖入素材</strong><small>支持从素材预览器拖放多个场景</small></div>';
    slot.querySelectorAll('.scene-del').forEach((b) =>
      b.addEventListener('click', () => {
        scenes.splice(Number(b.dataset.i), 1);
        renderScenes();
      })
    );
    slot.querySelectorAll('.scene-move').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        const j = b.dataset.dir === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= scenes.length) return;
        [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
        renderScenes();
      })
    );
    slot.querySelector('#vClearScenes')?.addEventListener('click', () => {
      scenes.length = 0;
      renderScenes();
    });
  };
  slot.addEventListener('dragover', (e) => e.preventDefault());
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-scene');
    if (!raw) return;
    let scene;
    try { scene = JSON.parse(raw); } catch { return; }
    // 2026-08-08 多模态扩展：media schema——{kind: html|image|video|prompt, src, version, note}
    // 当前素材库 = 007 HTML 交互素材（目录型）；图片/视频按扩展名推断，后续扩展
    // Task 7：version 随拖拽数据透传（旧拖拽无 version 字段 → undefined 序列化缺省，兼容）
    scenes.push({ ...scene, title: scene.name || '未命名场景', media: [{ kind: 'html', src: scene.name, version: scene.version, note: '' }] });
    renderScenes();
  });

  wb.setFabActions([
    { label: '提交', cb: () => submit() },
    { label: '确认生产', cb: () => confirmRun() },
    { label: '取消', cb: () => cancelRun() },
  ]);

  // 2026-08-06（用户反馈）：从素材预览器拖素材到侧栏「视频生成」→ 切面板后素材落入场景槽
  // Task 7：version（版本「添加」）→ media 记录 version；无 version（原版/旧拖拽）时缺省
  // 2026-08-08 队列化：pendingScenes 数组一次消费全部（单槽 pendingScene 连续添加会被覆盖——用户实测 bug）
  for (const ps of wb.pendingScenes ?? []) {
    scenes.push({ ...ps, title: ps.name || '未命名场景', media: [{ kind: 'html', src: ps.name, version: ps.version, note: '' }] });
  }
  wb.pendingScenes = [];
  renderScenes();

  // 审查修复（Minor #5）：vSubmit 按钮此前无点击监听（死按钮）
  // 配置来源是模板面板的本地选择；旧 V1/V2 键会自动迁移到 V3。
  const renderTemplateSummary = () => {
    const el = stage.querySelector('#vTemplateSummary');
    const parsed = readSelectedTemplateConfig();
    el.innerHTML = parsed.config
      ? `本次模板：<strong>${({ vscode: 'VS Code', wechat: '微信对话', claude: 'Claude 对话' })[parsed.config.shellType] ?? parsed.config.shellType}</strong> · ${esc(parsed.config.workspaceTitle)} · <span class="video-template-color" style="--template-color:${esc(parsed.config.accentColor)}">${esc(parsed.config.accentColor)}</span>`
      : '本次模板：使用正式默认值';
  };
  renderTemplateSummary();

  const submitButton = stage.querySelector('#vSubmit');
  const confirmButton = stage.querySelector('#vConfirm');
  const cancelButton = stage.querySelector('#vCancel');
  submitButton.addEventListener('click', () => submit());
  // 2026-08-06（用户指示）：确认生产/取消按钮放入面板（FAB 保留，待后续替换）
  confirmButton.addEventListener('click', () => confirmRun());
  cancelButton.addEventListener('click', () => cancelRun());

  // 修复 #3（2026-08-06）：活动 runId 持久化——切面板/刷新后恢复上次运行（localStorage）
  let runId = localStorage.getItem('wb.videoRunId') || null;
  // 操作按钮跟随状态显示可用性，避免无运行时误点“确认/取消”。底层阶段守卫保持不变。
  const syncActions = (currentStage) => {
    const active = ['running', 'draft_ready', 'rendering'].includes(currentStage);
    submitButton.disabled = currentStage === 'submitting';
    confirmButton.disabled = currentStage !== 'draft_ready';
    cancelButton.disabled = !active;
  };
  syncActions(runId ? 'running' : 'idle');
  const progress = stage.querySelector('#vProgress');
  // 2026-08-06 修复：瞬时提示（已开始生产/已取消/确认失败）写入独立 #vNotice，
  // 不与轮询的状态卡（#vProgress，每次整块覆盖）互相吞噬——此前提示一闪而过
  const notice = stage.querySelector('#vNotice');
  // 最终审查修复（M-1）：轮询超时计时起点（面板 render 时记录，poll 内闭包引用）
  // 补修（N1）：submit()/confirmRun() 调 poll() 前重置——人工闸门停留超 15 分钟是设计预期，
  // 不重置会让确认生产后的第一轮轮询即假超时，UI 永不显示 done/下载链接
  let pollStart = Date.now();

  const submit = async () => {
    const transcript = voiceTranscript.value.trim();
    const topic = stage.querySelector('#vTopic').value.trim() || transcript.slice(0, 60);
    if (!topic) { progress.innerHTML = '<div class="error-card">请填写主题</div>'; return; }
    syncActions('submitting');
    // 任务书 §5：提交前从本地读取并校验已选配置；损坏 JSON 删键回默认；读取不到时省略字段（服务端写默认快照）
    const stored = readSelectedTemplateConfig();
    let r;
    try {
      r = await wb.api('/api/video/submit', {
        method: 'POST', body: JSON.stringify(buildVideoSubmitBody({ topic, angle: [stage.querySelector('#vAngle').value.trim(), transcript ? `口述转写（保持核心观点，整理为可制作的讲解文案与分镜）：${transcript}` : ''].filter(Boolean).join('；'), sceneDraft: scenes.length ? JSON.stringify(scenes) : undefined, mode: stage.querySelector('#vMode').value, timeliness: stage.querySelector('#vTimeliness').value, timelinessRules: stage.querySelector('#vTimeliness').value === 'custom' ? stage.querySelector('#vTimelinessCustom').value.trim() : undefined, templateConfig: stored.config })),
      });
    } catch (error) {
      progress.innerHTML = `<div class="error-card">提交请求失败：${esc(error.message)}</div>`;
      syncActions('idle');
      return;
    }
    if (!r.ok) { progress.innerHTML = `<div class="error-card">提交失败：${esc(r.error)}</div>`; syncActions('idle'); return; }
    runId = r.data.runId;
    // 修复 #3：持久化活动 runId 与表单内容（主题/角度/模式），切面板回来可恢复
    localStorage.setItem('wb.videoRunId', runId);
    localStorage.setItem('wb.videoTopic', topic);
    localStorage.setItem('wb.videoAngle', stage.querySelector('#vAngle').value);
    localStorage.setItem('wb.videoMode', stage.querySelector('#vMode').value);
    localStorage.setItem('wb.videoTimeliness', stage.querySelector('#vTimeliness').value);
    pollStart = Date.now(); // 补修（N1）：新提交从本轮起重新计时
    poll();
  };

  const poll = async () => {
    if (!runId) return;
    // 审查修复（Important #2）：面板卸载（重新 render 或 stage 内容被替换）后停止轮询，
    // 不写已脱离 DOM 的节点
    if (disposed || !progress.isConnected) return;
    try {
      const r = await wb.api(`/api/video/status?id=${encodeURIComponent(runId)}`);
      if (!r.ok) throw new Error(r.error || '状态接口返回失败');
      const d = r.data ?? {};
      const stageMap = { running: '⏳ 文本链路执行中…', draft_ready: '📋 文案/分镜已就绪——请确认后继续生产', rendering: '🎬 渲染中…', done: '✅ 完成', failed: '❌ 失败' };
      // 改动 2（2026-08-06）：细粒度阶段映射——006 内层 state.json 的 stage → 中文标签；
      // 未收录的新阶段原样显示，null/undefined 时整段省略
      // 阶段名固定（状态机不变），但降级模式下 codex_draft/codex_verdict 实际由 DeepSeek 执行——
      // 按提交时保存的模式显示正确标签
      const isFallback = localStorage.getItem('wb.videoMode') !== 'normal';
      const detailMap = {
        research: isFallback ? '准备中' : '联网研究/准备中',
        flash_draft: 'DeepSeek 草稿生成中',
        codex_draft: isFallback ? 'DeepSeek 草稿生成中' : 'Codex 草稿生成中',
        flash_challenge: '挑战复核中',
        codex_verdict: isFallback ? 'DeepSeek 裁决定稿中' : 'Codex 裁决定稿中',
        flash_verdict: 'DeepSeek 裁决定稿中',
        user_confirmation: '等待确认',
      };
      // 顶部状态行：粗粒度阶段 + runId + 创建时间（createdAt 存在时展示）+ 细粒度阶段
      // 2026-08-06 修正：rendering/done 时细粒度仍停在 user_confirmation（生产链不更新状态机），
      // 按粗粒度覆盖显示「生产中/已完成」
      const detailLabel =
        d.stage === 'rendering' ? '生产中（配音→字幕→渲染）'
        : d.stage === 'done' ? '已完成'
        : d.stage === 'draft_ready' ? '等待确认（闸门）'
        : d.detailStage ? (detailMap[d.detailStage] ?? d.detailStage)
        : '';
      syncActions(d.stage);
      // 2026-08-06 里程碑时间：创建（task.json）/生产开始（render-start.txt）/完成（final.mp4 mtime）/失败（error.txt mtime）
      const statusTone = ({ running: 'is-running', rendering: 'is-running', draft_ready: 'is-ready', done: 'is-done', failed: 'is-failed', missing: 'is-failed' })[d.stage] ?? '';
      const milestones = [
        d.createdAt ? `<span><small>创建</small>${new Date(d.createdAt).toLocaleString()}</span>` : '',
        d.startedAt ? `<span><small>生产</small>${new Date(d.startedAt).toLocaleString()}</span>` : '',
        d.finishedAt ? `<span><small>完成</small>${new Date(d.finishedAt).toLocaleString()}</span>` : '',
        d.failedAt ? `<span><small>失败</small>${new Date(d.failedAt).toLocaleString()}</span>` : '',
      ].filter(Boolean).join('');
      // 模型费用明细：006 CostTracker 按模型聚合（{ inputTokens, outputTokens, costUsd }），存在即展示
      const costHtml = (d.cost && Object.keys(d.cost).length)
        ? `<p class="cost-section-title"><b>模型费用明细</b></p><div class="cost-table">` +
          Object.entries(d.cost).map(([model, c]) =>
            `<div><span>${esc(model)}</span>：输入 ${formatNumber(c.inputTokens)} tokens / 输出 ${formatNumber(c.outputTokens)} tokens / 费用 $${formatUsd(c.costUsd)}</div>`
          ).join('') + `</div>`
        : '';
      // 2026-08-07 生产链记账（TTS 配音 + 视觉质检，run-summary.produce 聚合）
      const produceHtml = (d.produce && (d.produce.tts || d.produce.visualReview))
        ? `<p class="cost-section-title"><b>生产链用量</b></p><div class="cost-table">` +
          (d.produce.tts ? `<div><span>配音（${esc(d.produce.tts.voice)}）</span>：${formatNumber(d.produce.tts.sentences)} 句 / ${formatNumber(d.produce.tts.chars)} 字符 / ${formatNumber(d.produce.tts.calls)} 次调用</div>` : '') +
          (d.produce.visualReview ? `<div><span>视觉质检（${esc(d.produce.visualReview.provider)}）</span>：${formatNumber(d.produce.visualReview.frames)} 帧 / 输入 ${formatNumber(d.produce.visualReview.inputTokens)} tokens / 输出 ${formatNumber(d.produce.visualReview.outputTokens)} tokens</div>` : '') +
          `</div>`
        : '';
      progress.innerHTML = `<section class="card run-status-card">` +
        `<div class="run-status-heading"><div><span class="status-badge ${statusTone}">${esc(stageMap[d.stage] ?? d.stage)}</span><code>${esc(runId)}</code></div>${detailLabel ? `<strong>${esc(detailLabel)}</strong>` : ''}</div>` +
        (milestones ? `<div class="run-milestones">${milestones}</div>` : '') +
        (d.error ? `<pre class="error-card run-error">${esc(d.error)}</pre>` : '') +
        costHtml +
        produceHtml +
        (d.finalMp4 ? `<div class="run-download"><a class="btn btn-primary" href="/api/video/download?id=${encodeURIComponent(runId)}">下载成片</a></div>` : '') +
        (d.summary ? `<details class="run-raw"><summary>查看完整运行数据</summary><pre>${esc(JSON.stringify(d.summary, null, 2))}</pre></details>` : '') +
        `</section>`;
      // 修复 #3：终态清理——运行不存在或失败后不再保留活动 runId（下次 render 不恢复死运行）
      if (d.stage === 'missing' || d.stage === 'failed') localStorage.removeItem('wb.videoRunId');
      if (['running', 'rendering'].includes(d.stage)) {
        // 最终审查修复（M-1，spec §6）：超过 15 分钟仍无终态 → 停止自动轮询，
        // 提示用户手动处理（可取消/重试），避免无限空转
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          progress.innerHTML += '<div class="error-card">已超过 15 分钟无进展，未自动重试（可取消）</div>';
          return;
        }
        setTimeout(poll, 3000);
      }
    } catch (e) {
      // 审查修复（Important #2）：fetch/解析异常 → 显示错误卡并停止轮询（不再排下一轮），
      // 避免未捕获 rejection 与轮询链静默死亡
      progress.innerHTML += `<div class="error-card">状态查询失败，已停止轮询：${esc(e.message)}</div>`;
    }
  };

  const confirmRun = () => {
    if (!runId) return;
    // 改动 1（2026-08-06）：/api/video/confirm 服务端要跑完整条生产链（分钟级）才返回，
    // 此前前端 await 同步阻塞 → 界面无反馈；改为 fire-and-forget：先立即显示已开始生产
    // 并马上进入轮询，confirm 请求不阻塞（.then 处理业务失败，.catch 处理请求异常）
    notice.innerHTML = '<div class="card">已开始生产（配音→字幕→素材→渲染）…</div>';
    pollStart = Date.now(); // 补修（N1）：人工闸门停留后确认生产，重置超时计时
    poll();
    wb.api('/api/video/confirm', { method: 'POST', body: JSON.stringify({ id: runId }) })
      .then((r) => {
        if (!r.ok) {
          // 2026-08-08：BAD_STAGE 翻译成用户能懂的提示（重复确认/阶段不匹配不再是裸错误码）
          const friendly = r.error === 'BAD_STAGE: rendering'
            ? '该运行已在生产中，无需重复确认（等待完成即可）'
            : r.error === 'BAD_STAGE' ? '当前状态不允许确认生产' : r.error;
          notice.innerHTML = `<div class="error-card">确认失败：${esc(friendly)}</div>`;
        }
      })
      .catch((e) => {
        notice.innerHTML = `<div class="error-card">确认请求异常：${esc(e.message)}</div>`;
      });
  };

  const cancelRun = async () => {
    if (!runId) return;
    let r;
    try { r = await wb.api('/api/video/cancel', { method: 'POST', body: JSON.stringify({ id: runId }) }); }
    catch (error) { notice.innerHTML = `<div class="error-card">取消请求失败：${esc(error.message)}</div>`; return; }
    if (!r.ok) { notice.innerHTML = `<div class="error-card">取消失败：${esc(r.error)}</div>`; return; }
    localStorage.removeItem('wb.videoRunId');
    syncActions('idle');
    notice.innerHTML = '<div class="card">已取消</div>';
  };

  // 修复 #3：恢复上次运行——表单回填 + 若有活动 runId 立即恢复轮询（poll 定义在下方，须放最后）
  stage.querySelector('#vTopic').value = localStorage.getItem('wb.videoTopic') ?? '';
  stage.querySelector('#vAngle').value = localStorage.getItem('wb.videoAngle') ?? '';
  const savedTimeliness = localStorage.getItem('wb.videoTimeliness');
  if (savedTimeliness) stage.querySelector('#vTimeliness').value = savedTimeliness;
  // 2026-08-07 自定义时效：切换时显示/隐藏文本框 + 持久化
  const tSelect = stage.querySelector('#vTimeliness');
  const tWrap = stage.querySelector('#vTimelinessCustomWrap');
  const tInput = stage.querySelector('#vTimelinessCustom');
  const syncTimeliness = () => {
    const isCustom = tSelect.value === 'custom';
    tWrap.hidden = !isCustom;
    if (isCustom) tInput.value = localStorage.getItem('wb.videoTimelinessRules') ?? '';
    else localStorage.removeItem('wb.videoTimelinessRules');
  };
  tSelect.addEventListener('change', syncTimeliness);
  tInput.addEventListener('input', () => localStorage.setItem('wb.videoTimelinessRules', tInput.value));
  syncTimeliness();
  if (runId) {
    progress.innerHTML = '<div class="card">正在恢复上次运行…</div>';
    pollStart = Date.now();
    poll();
  }

  // 历史运行列表（2026-08-06 用户反馈）：/api/video/list → 查看（恢复为活动运行）/下载产物
  const loadHistory = async () => {
    const box = stage.querySelector('#vHistory');
    let r;
    try { r = await wb.api('/api/video/list'); }
    catch (error) { box.innerHTML = `<div class="error-card">历史列表请求失败：${esc(error.message)}</div>`; return; }
    if (!r.ok) { box.innerHTML = `<div class="error-card">历史列表加载失败：${esc(r.error)}</div>`; return; }
    const runs = r.data?.runs ?? [];
    const stageLabel = { running: '执行中', draft_ready: '待确认', rendering: '生产中', done: '已完成', failed: '失败', missing: '缺失' };
    // 2026-08-06 里程碑时间链：提交 → 生产 → 完成/失败（创建带日期，后续里程碑同日只显时刻）
    const shortDate = (t) => { const d = new Date(t); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const shortTime = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    box.innerHTML = `<div class="section-heading history-heading"><span class="section-number">03</span><div><h3>历史运行</h3><p>最近 ${runs.length} 条记录，按创建时间倒序排列。</p></div></div>` +
      (runs.length ? runs.map((x) => {
        const ts = [
          x.createdAt ? `${shortDate(x.createdAt)} ${shortTime(x.createdAt)}` : null,
          x.startedAt ? `生产 ${shortTime(x.startedAt)}` : null,
          x.finishedAt ? `完成 ${shortTime(x.finishedAt)}` : null,
          x.failedAt ? `失败 ${shortTime(x.failedAt)}` : null,
        ].filter(Boolean).join(' → ');
        const tone = ({ running: 'is-running', rendering: 'is-running', draft_ready: 'is-ready', done: 'is-done', failed: 'is-failed', missing: 'is-failed' })[x.stage] ?? '';
        return `
        <div class="history-row">
          <div class="history-copy">
            <strong>${esc(x.topic ?? '（无主题）')}</strong>
            <span>${esc(ts || '暂无时间记录')}</span>
          </div>
          <span class="status-badge ${tone}">${esc(stageLabel[x.stage] ?? x.stage)}</span>
          <div class="history-actions">
            ${x.finalMp4 ? `<a class="btn" href="/api/video/download?id=${encodeURIComponent(x.runId)}">下载</a>` : ''}
            <button class="btn" data-opendir="${esc(x.runId)}">目录</button>
            <button class="btn" data-view="${esc(x.runId)}">查看</button>
            <button class="btn btn-quiet-danger" data-del="${esc(x.runId)}">删除</button>
          </div>
        </div>`;
      }).join('')
      : '<div class="history-empty">暂无历史运行。提交第一个主题后，它会出现在这里。</div>');
    box.querySelectorAll('[data-view]').forEach((b) =>
      b.addEventListener('click', () => {
        localStorage.setItem('wb.videoRunId', b.dataset.view);
        wb.switchTool('video', true); // force 重渲染 → 恢复该运行的状态轮询
      })
    );
    // 2026-08-07：打开 run 目录（资源管理器），省下载空间/时间
    box.querySelectorAll('[data-opendir]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const r = await wb.api(`/api/video/open-dir?id=${encodeURIComponent(b.dataset.opendir)}`);
          if (!r.ok) notice.innerHTML = `<div class="error-card">打开目录失败：${esc(r.error)}</div>`;
        } catch (error) {
          notice.innerHTML = `<div class="error-card">打开目录请求失败：${esc(error.message)}</div>`;
        }
      })
    );
    // 2026-08-07：删除历史运行（inline 两步确认，禁原生 confirm）——删后刷新列表；
    // 若删的是当前活动 runId 则清理 localStorage
    box.querySelectorAll('[data-del]').forEach((b) => {
      let armed = false;
      let timer = null;
      let cancelBtn = null;
      // 2026-08-08：统一复位（文字/样式/取消按钮/超时）——确认态下提供「取消」按钮，不想删可立即取消
      const reset = () => {
        armed = false;
        if (timer) { clearTimeout(timer); timer = null; }
        if (cancelBtn) { cancelBtn.remove(); cancelBtn = null; }
        b.textContent = '删除';
        b.classList.remove('is-armed', 'is-failed-action');
        b.title = '';
      };
      b.addEventListener('click', async () => {
        if (!armed) {
          // 2026-08-07 修复：首次点击只「武装」——若 3 秒内没点第二次会复位，永远到不了删除。
          // 改为明确引导「再点确认删除」+ 8 秒超时；2026-08-08 补「取消」按钮
          armed = true;
          b.textContent = '再点确认删除';
          b.classList.add('is-armed');
          const cancel = document.createElement('button');
          cancel.className = 'btn compact-btn';
          cancel.textContent = '取消';
          cancel.addEventListener('click', (e) => { e.stopPropagation(); reset(); });
          b.insertAdjacentElement('afterend', cancel);
          cancelBtn = cancel;
          timer = setTimeout(reset, 8000);
          return;
        }
        reset(); // 清除确认态（含取消按钮）再执行删除
        const id = b.dataset.del;
        let r;
        try { r = await wb.api('/api/video/delete', { method: 'POST', body: JSON.stringify({ id }) }); }
        catch (error) {
          b.textContent = '✕ 删除失败';
          b.classList.add('is-failed-action');
          b.title = error.message;
          setTimeout(reset, 5000);
          notice.innerHTML = `<div class="error-card">删除请求失败：${esc(error.message)}</div>`;
          return;
        }
        if (!r.ok) {
          // 2026-08-07 可见性加强：错误在按钮原地显示 + notice 同步（用户反馈看不到提示）
          b.textContent = '✕ 删除失败';
          b.classList.add('is-failed-action');
          b.title = r.error;
          setTimeout(reset, 5000);
          notice.innerHTML = `<div class="error-card">删除失败：${esc(r.error)}</div>`;
          notice.classList.remove('flash-notice');
          void notice.offsetWidth; // 重触发动画（闪烁提醒）
          notice.classList.add('flash-notice');
          return;
        }
        if (localStorage.getItem('wb.videoRunId') === id) localStorage.removeItem('wb.videoRunId');
        loadHistory();
      });
    });
  };
  loadHistory();
}
