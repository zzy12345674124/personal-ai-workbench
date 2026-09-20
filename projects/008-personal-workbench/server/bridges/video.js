// server/bridges/video.js —— 006 流水线桥接（提交→闸门→渲染→状态轮询）
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_DIR, AUTOMOTION_DIR } from '../paths.js';
import { DEFAULT_TEMPLATE_CONFIG, normalizeTemplateConfig } from '../template-config.js';

// Windows 下 .bin 是 .cmd shim，直接 spawn 会 EINVAL；用真实 JS 入口由 node 直启（006 踩坑经验）
const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';
// 2026-08-06 修复：bin 映射的真实入口是 remotion-cli.js——dist/index.js 是内部库，
// 直接跑会 exit 0 但什么都不干（渲染静默不执行、运行卡 rendering）
const REMOTION_CLI = 'node_modules/@remotion/cli/remotion-cli.js';
const COMPOSITION_ID = 'rag-video';

// 第 7 轮修复（Codex P1）：运行序号提升到模块/进程级。此前 runIdSeq 定义在 createVideoBridge
// 实例内，而 videoRouter 每次请求都新建 bridge（server.js bridgeRoute 按请求动态导入并调用），
// 路由级并发下序号重置为 0——同一毫秒到达的两个提交会得到相同 runId（后写覆盖前写快照、
// 两流水线共享运行根）。模块级计数器跨 bridge 实例共享、进程内单调递增；仍为纯数字
// （runDirOf/listRuns 的 /^run-\d+$/ 校验与既有目录格式兼容）。
let runIdSeq = 0;
function newRunId() {
  return `run-${Date.now()}${String(++runIdSeq).padStart(3, '0')}`;
}

export function createVideoBridge({ automotionDir, runsDir }) {
  // 提交命令：cwd=006 根，AUTOMOTION_RUN_ROOT 指向 008/runs/<runId>；角度参数内嵌分镜约束；
  // mode：normal=Codex（需梯子）/ fallback=DeepSeek 接任草稿与裁决（006 PIPELINE_MODE，2026-08-06）
  // 任务书 §5：templateConfig 追加在参数末尾（不打断旧参数顺序）；先校验后建目录——
  // 非法配置不创建运行目录；每次运行原子写入独立 template-config.json 快照
  function buildSubmitCommand(topic, angle, sceneDraft, mode = 'fallback', timeliness = 'strict', timelinessRules = '', templateConfig = DEFAULT_TEMPLATE_CONFIG) {
    let config;
    try {
      config = normalizeTemplateConfig(templateConfig);
    } catch {
      throw new Error('BAD_TEMPLATE_CONFIG');
    }
    const runId = newRunId();
    const runRoot = join(runsDir, runId);
    mkdirSync(runRoot, { recursive: true });
    // 原子写快照（先同目录临时文件再重命名）；失败向上抛，router 返回 500 且不启动子进程
    const configFile = join(runRoot, 'template-config.json');
    const tmpConfigFile = `${configFile}.${process.pid}.tmp`;
    try {
      writeFileSync(tmpConfigFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      renameSync(tmpConfigFile, configFile);
    } catch (e) {
      throw new Error(`TEMPLATE_CONFIG_WRITE_FAILED: ${e.message}`);
    }
    const angleArg = [angle ?? '', sceneDraft ? `分镜约束：${sceneDraft}` : ''].filter(Boolean).join('；');
    // 2026-08-08 多模态第二阶段：场景草稿 JSON 原样落盘 runDir——006 prepare-video-assets 按分镜 index
    // 确定性注入 media（素材视频进渲染），不依赖 LLM 在 storyboard 里自觉复述 media 字段
    if (sceneDraft) {
      try {
        writeFileSync(join(runRoot, 'scene-draft.json'), typeof sceneDraft === 'string' ? sceneDraft : JSON.stringify(sceneDraft), 'utf8');
      } catch { /* 落盘失败不阻断提交（仅影响素材进视频） */ }
    }
    const env = {
      ...process.env,
      AUTOMOTION_RUN_ROOT: runRoot,
      PIPELINE_MODE: mode,
      // 2026-08-07 时效模式：strict=新闻/热点（时效纪律+搜索注入）；relaxed=常青/教程（跳过）；custom=用户自定义要求
      PIPELINE_TIMELINESS: timeliness === 'relaxed' ? 'relaxed' : timeliness === 'custom' ? 'custom' : 'strict',
    };
    // 自定义时效文本（仅 custom 模式；Node spawn env 是 Unicode 安全，中文无编码问题）
    if (timeliness === 'custom' && timelinessRules) env.PIPELINE_TIMELINESS_RULES = timelinessRules;
    return {
      runId,
      cwd: automotionDir,
      env,
      args: [join(automotionDir, TSX_CLI), 'scripts/run-text-pipeline.ts', topic, angleArg],
    };
  }

  // 渲染链：配音 → 字幕 → 素材准备 → remotion 渲染 → MiMo 视觉质检（抽帧+评分，2026-08-07 接入）；
  // runDir 应为规范目录
  function buildConfirmChain(runId, runDir) {
    const ps = 'powershell -ExecutionPolicy Bypass -File'.split(' ');
    return [
      // 2026-08-07 TTS 切换：SAPI → MiMo-V2.5-TTS（音色苏打）；适配器接口兼容，可再换回
      { cmd: ps[0], args: [...ps.slice(1), join(automotionDir, 'scripts/tts-synthesize-mimo.ps1'), '-RunDir', runDir] },
      { cmd: 'node', args: [join(automotionDir, TSX_CLI), 'scripts/run-subtitles.ts', runDir] },
      { cmd: 'node', args: [join(automotionDir, TSX_CLI), 'scripts/prepare-video-assets.ts', runDir] },
      { cmd: 'node', args: [join(automotionDir, REMOTION_CLI), 'render', COMPOSITION_ID, join(runDir, 'final.mp4')], cwd: join(automotionDir, 'video') },
      // 2026-08-07 视觉质检接入（用户实验设计：本轮起自动质检）：抽 3 关键帧 → MiMo 评分 → visual-review.json
      { cmd: ps[0], args: [...ps.slice(1), join(automotionDir, 'scripts/run-visual-review.ps1'), '-RunDir', runDir] },
    ];
  }

  function runDirOf(runId) {
    const dir = join(runsDir, runId);
    if (!runId || !/^run-\d+$/.test(runId) || !existsSync(dir)) return null;
    return dir;
  }

  // 规范目录解析（审查 Critical #1）：006 的 RunContext 会在 AUTOMOTION_RUN_ROOT（=外层）
  // 下再嵌套一层 run-<006id>，产物实际落在内层。外层存在含 run-summary.json 的子目录时
  // 返回该内层作为规范目录，否则返回外层。findSummary 逻辑并入此处。
  function resolveRunDir(runId) {
    const outer = runDirOf(runId);
    if (!outer) return null;
    for (const f of readdirSync(outer, { withFileTypes: true })) {
      if (f.isDirectory()) {
        const inner = join(outer, f.name);
        if (existsSync(join(inner, 'run-summary.json'))) return inner;
      }
    }
    return outer;
  }

  // 阶段推断：draft_ready（run-summary.json 存在，stage=user_confirmation）→ rendering（confirm 日志存在）→ done（final.mp4）→ failed（error 标记）
  // final.mp4 / confirm.log / 摘要一律以规范目录为准；error.txt 外层优先（bridge 侧取消/失败标记），内层兜底（006 侧）
  // 2026-08-06 增强：新增 createdAt / detailStage / cost——task.json（createdAt）与 state.json（stage）由 006
  // 写在内层运行目录；内层尚无 run-summary.json 时 resolveRunDir 回退外层，故读取需兼顾内外层。
  // 防御性读取：文件缺失、解析失败或字段类型不符一律 null，不回退不抛错
  function stageOf(runId) {
    const outer = runDirOf(runId);
    if (!outer) return { stage: 'missing', createdAt: null, detailStage: null, cost: null, produce: null, startedAt: null, finishedAt: null, failedAt: null };
    const dir = resolveRunDir(runId);
    const summaryFile = existsSync(join(dir, 'run-summary.json')) ? join(dir, 'run-summary.json') : null;
    const finalMp4 = existsSync(join(dir, 'final.mp4'));
    const confirmLog = join(dir, 'confirm.log');
    const errOuter = join(outer, 'error.txt');
    const errInner = join(dir, 'error.txt');
    const errorFile = existsSync(errOuter) ? errOuter : existsSync(errInner) ? errInner : null;
    // 最终审查修复（M-3）：run-summary.json 解析失败（半写/损坏）不再抛 500——
    // 解析统一返回 null（readFileSync 的 IO 异常同路径兜底）；draft_ready 分支解析失败
    // 按 running 继续等待（补修 N3 后 done 分支直接带 summary:null 返回 done）
    const parseSummary = () => {
      try { return JSON.parse(readFileSync(summaryFile, 'utf8')); } catch { return null; }
    };
    // 细粒度读取（2026-08-06）：优先规范目录，缺文件再扫其子目录兜底（006 嵌套层场景）
    const readDetail = (name) => {
      const tryRead = (base) => {
        try {
          const v = JSON.parse(readFileSync(join(base, name), 'utf8'));
          return v && typeof v === 'object' ? v : null;
        } catch { return null; }
      };
      const v = tryRead(dir);
      if (v !== null) return v;
      try {
        for (const f of readdirSync(dir, { withFileTypes: true })) {
          if (!f.isDirectory()) continue;
          const w = tryRead(join(dir, f.name));
          if (w !== null) return w;
        }
      } catch {}
      return null;
    };
    const taskJson = readDetail('task.json');
    const stateJson = readDetail('state.json');
    const createdAt = typeof taskJson?.createdAt === 'string' ? taskJson.createdAt : null;
    const detailStage = typeof stateJson?.stage === 'string' ? stateJson.stage : null;
    // cost 直接透传 run-summary.json 的 costByModel（结构保持原样）；summary 不存在/解析失败 → null
    const summary = summaryFile ? parseSummary() : null;
    const cost = summary?.costByModel ?? null;
    // 2026-08-07 生产链记账透传（TTS/质检聚合在 run-summary.produce）
    const produce = summary?.produce ?? null;
    // 里程碑时间（2026-08-06）：提交=task.json createdAt；生产开始=render-start.txt（confirm 时写入，
    // confirm.log 的 mtime 会被整条生产链持续追加，不能当开始时间）；完成/失败=final.mp4 / error.txt 的 mtime
    const readText = (p) => { try { return readFileSync(p, 'utf8').trim() || null; } catch { return null; } };
    const mtimeOf = (p) => { try { return new Date(statSync(p).mtime).toISOString(); } catch { return null; } };
    const startedAt = readText(join(dir, 'render-start.txt'));
    const finishedAt = finalMp4 ? mtimeOf(join(dir, 'final.mp4')) : null;
    const failedAt = errorFile ? mtimeOf(errorFile) : null;
    if (errorFile) return { stage: 'failed', error: readFileSync(errorFile, 'utf8').slice(0, 500), createdAt, detailStage, cost, produce, startedAt, finishedAt, failedAt };
    if (finalMp4) {
      // 补修（N3）：done 分支 summary 解析失败不再回落 running——产物已存在，前端已处理
      // summary 为空的情况；回落 running 会让下载入口在超时提示后仍不出现
      return { stage: 'done', finalMp4: true, summary, createdAt, detailStage, cost, produce, startedAt, finishedAt, failedAt };
    }
    if (existsSync(confirmLog)) return { stage: 'rendering', logTail: readFileSync(confirmLog, 'utf8').slice(-2000), createdAt, detailStage, cost, produce, startedAt, finishedAt, failedAt };
    if (summaryFile) {
      if (summary === null) return { stage: 'running', createdAt, detailStage, cost, produce, startedAt, finishedAt, failedAt };
      return { stage: 'draft_ready', summary, createdAt, detailStage, cost, produce, startedAt, finishedAt, failedAt };
    }
    return { stage: 'running', createdAt, detailStage, cost, produce, startedAt, finishedAt, failedAt };
  }

  // 阶段守卫（审查 Important #3）：仅 draft_ready 允许 confirm，其余返回 BAD_STAGE
  function confirmStageGuard(runId) {
    const st = stageOf(runId);
    if (st.stage !== 'draft_ready') return { ok: false, error: 'BAD_STAGE: ' + st.stage };
    return { ok: true };
  }

  // 取消（审查 Important #2）：runId 校验（复用 runDirOf，防 ../ 穿越）→ 阶段守卫
  // （done/failed 不覆写 error.txt）→ 读 submit.pid 杀进程树，失败静默
  function cancelRun(runId) {
    const outer = runDirOf(runId);
    if (!outer) return { ok: false, error: 'RUN_NOT_FOUND' };
    const st = stageOf(runId);
    if (st.stage !== 'done' && st.stage !== 'failed') writeError(runsDir, runId, 'CANCELLED_BY_USER');
    killProcessTree(join(outer, 'submit.pid'));
    return { ok: true };
  }

  // 删除运行目录（2026-08-07 用户需求：历史运行占空间）：仅终态（done/failed）可删，
  // 活动/待确认中拒绝（防删运行中目录）；runId 校验防穿越；删除整个外层目录（含内层产物）
  function deleteRun(runId) {
    const outer = runDirOf(runId);
    if (!outer) return { ok: false, error: 'RUN_NOT_FOUND' };
    const st = stageOf(runId);
    if (!['done', 'failed'].includes(st.stage)) {
      return { ok: false, error: `RUN_NOT_TERMINAL: ${st.stage}（仅已完成/失败的运行可删除）` };
    }
    try {
      rmSync(outer, { recursive: true, force: true });
    } catch (e) {
      // 2026-08-07 实测：explorer 窗口停在目录里会占用目录 → EPERM/EBUSY，删除失败
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /EPERM|EBUSY|busy/i.test(msg)
        ? '（目录可能被资源管理器窗口占用——请先关闭「📂 目录」打开的窗口再删除）'
        : '';
      return { ok: false, error: `删除失败：${msg}${hint}` };
    }
    return { ok: true };
  }

  // 历史运行列表（2026-08-06 用户反馈）：扫 runs/ 目录，返回 runId/主题/创建时间/阶段/是否有产物
  function listRuns(limit = 20) {
    const out = [];
    let dirs = [];
    try { dirs = readdirSync(runsDir, { withFileTypes: true }); } catch { return out; }
    for (const d of dirs) {
      if (!d.isDirectory() || !/^run-\d+$/.test(d.name)) continue;
      try {
        const st = stageOf(d.name);
        // 读取内层（或外层）task.json 的主题与创建时间
        let topic = null, createdAt = null;
        const candidates = [join(runsDir, d.name)];
        for (const f of readdirSync(candidates[0], { withFileTypes: true })) {
          if (f.isDirectory()) candidates.push(join(candidates[0], f.name));
        }
        for (const base of candidates) {
          try {
            const t = JSON.parse(readFileSync(join(base, 'task.json'), 'utf8'));
            if (typeof t.topic === 'string') { topic = t.topic; createdAt = t.createdAt ?? null; break; }
          } catch { /* 继续尝试下一个候选目录 */ }
        }
        out.push({ runId: d.name, topic, createdAt, stage: st.stage, finalMp4: Boolean(st.finalMp4), startedAt: st.startedAt, finishedAt: st.finishedAt, failedAt: st.failedAt });
      } catch { /* 单个运行读取失败跳过 */ }
    }
    out.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    return out.slice(-limit).reverse();
  }

  return { newRunId, buildSubmitCommand, buildConfirmChain, runDirOf, resolveRunDir, stageOf, confirmStageGuard, cancelRun, deleteRun, listRuns };
}

export async function videoRouter(req, res, url, options = {}) {
  const { createVideoBridge } = await import('./video.js');
  const { AUTOMOTION_DIR } = await import('../paths.js');
  // 测试注入临时 runsDir（任务书 §5：测试必须用 mkdtempSync 临时目录，禁止触碰真实 runs/）
  const runsDir = options.runsDir ?? RUNS_DIR;
  const bridge = createVideoBridge({ automotionDir: AUTOMOTION_DIR, runsDir });
  const json = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
  const readBody = async () => { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); };

  if (url.pathname === '/api/video/list' && req.method === 'GET') {
    try { json(200, { ok: true, data: { runs: bridge.listRuns() } }); }
    catch (e) { json(500, { ok: false, error: 'VIDEO_LIST: ' + e.message }); }
    return;
  }

  if (url.pathname === '/api/video/submit' && req.method === 'POST') {
    const { topic, angle, sceneDraft, mode, timeliness, timelinessRules, templateConfig } = await readBody();
    if (!topic || typeof topic !== 'string' || topic.length > 500) return json(400, { ok: false, error: 'BAD_TOPIC' });
    // 运行模式（2026-08-06）：normal=Codex（需梯子）；fallback=DeepSeek 接任草稿/裁决（默认——当前无梯子场景）
    // 时效模式（2026-08-07）：strict=新闻/热点；relaxed=常青/教程；custom=用户自定义要求
    // 任务书 §5：字段缺失 → 默认快照；字段存在但无效 → 400 且不建目录不 spawn；写入失败 → 500 不启动进程
    let c;
    try {
      c = bridge.buildSubmitCommand(topic, angle, sceneDraft, mode === 'normal' ? 'normal' : 'fallback', timeliness, timelinessRules, templateConfig);
    } catch (e) {
      if (e.message === 'BAD_TEMPLATE_CONFIG') return json(400, { ok: false, error: 'BAD_TEMPLATE_CONFIG' });
      return json(500, { ok: false, error: `TEMPLATE_CONFIG: ${e.message}` });
    }
    const child = spawn('node', c.args, { cwd: c.cwd, env: c.env, windowsHide: true });
    const log = join(runsDir, c.runId, 'submit.log');
    // 记录 pid 供 cancel 杀进程树（Important #2）
    try { writeFileSync(join(runsDir, c.runId, 'submit.pid'), String(child.pid ?? ''), 'utf8'); } catch {}
    child.stdout.on('data', (d) => appendLog(log, d));
    child.stderr.on('data', (d) => appendLog(log, d));
    child.on('error', (e) => writeError(runsDir, c.runId, 'SPAWN: ' + e.message));
    // 子进程退出且规范目录内未产出 run-summary.json → 判失败（含退出码）；已有 error.txt 不覆写（Important #4）
    child.on('close', (code) => {
      const dir = bridge.resolveRunDir(c.runId);
      if (dir && !existsSync(join(dir, 'run-summary.json')) && !existsSync(join(runsDir, c.runId, 'error.txt'))) {
        writeError(runsDir, c.runId, `SUBMIT_FAILED: exit=${code}`);
      }
    });
    return json(200, { ok: true, data: { runId: c.runId } });
  }

  if (url.pathname === '/api/video/status') {
    const runId = url.searchParams.get('id') ?? '';
    return json(200, { ok: true, data: { runId, ...bridge.stageOf(runId) } });
  }

  if (url.pathname === '/api/video/confirm' && req.method === 'POST') {
    const { id } = await readBody();
    const runDir = bridge.resolveRunDir(id);
    if (!runDir) return json(404, { ok: false, error: 'RUN_NOT_FOUND' });
    const guard = bridge.confirmStageGuard(id);
    if (!guard.ok) return json(409, { ok: false, error: guard.error });
    const chain = bridge.buildConfirmChain(id, runDir);
    const log = join(runDir, 'confirm.log');
    // 生产开始时刻标记（2026-08-06）：确认时刻写入 render-start.txt，供 stageOf/历史列表显示；
    // 不能读 confirm.log 的 mtime——整条生产链持续追加它会漂移到链结束时刻
    const startFile = join(runDir, 'render-start.txt');
    if (!existsSync(startFile)) writeFileSync(startFile, new Date().toISOString(), 'utf8');
    for (const step of chain) {
      // 按链顺序执行；中间步骤失败即停（close code 非 0 则 break），并写 error.txt 让 stageOf 落到 failed
      const code = await new Promise((resolveStep) => {
        const ch = spawn(step.cmd, step.args, { cwd: step.cwd ?? AUTOMOTION_DIR, windowsHide: true });
        ch.stdout.on('data', (d) => appendLog(log, d));
        ch.stderr.on('data', (d) => appendLog(log, d));
        ch.on('close', (c) => resolveStep(c ?? 1));
      });
      if (code !== 0) {
        // 第 4 轮 P3 修复（Codex P3）：必须写入注入的 runsDir（测试注入 mkdtemp 临时目录），
        // 此前误用真实 RUNS_DIR，静态测试一旦覆盖确认路由会向真实运行根写错误文件，破坏测试隔离。
        writeError(runsDir, id, `CONFIRM_STEP_FAILED: ${stepLabel(step)} exit=${code}`);
        break;
      }
    }
    return json(200, { ok: true, data: { stage: bridge.stageOf(id).stage } });
  }

  if (url.pathname === '/api/video/download' && req.method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    const runDir = bridge.resolveRunDir(id);
    if (!runDir) return json(404, { ok: false, error: 'RUN_NOT_FOUND' });
    const file = join(runDir, 'final.mp4');
    if (!existsSync(file)) return json(404, { ok: false, error: 'FINAL_MP4_NOT_READY' });
    const { createReadStream } = await import('node:fs');
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="${id}-final.mp4"` });
    createReadStream(file).pipe(res);
    return;
  }

  if (url.pathname === '/api/video/open-dir' && req.method === 'GET') {
    // 2026-08-07：资源管理器打开 run 目录（省下载空间/时间）；runId 校验防目录穿越
    const id = url.searchParams.get('id') ?? '';
    const runDir = bridge.resolveRunDir(id);
    if (!runDir) return json(404, { ok: false, error: 'RUN_NOT_FOUND' });
    const { spawn } = await import('node:child_process');
    spawn('explorer', [runDir], { detached: true, stdio: 'ignore' }).unref();
    return json(200, { ok: true, data: { dir: runDir } });
  }

  if (url.pathname === '/api/video/cancel' && req.method === 'POST') {
    const { id } = await readBody();
    const r = bridge.cancelRun(id);
    if (!r.ok) return json(404, { ok: false, error: r.error });
    return json(200, { ok: true, data: { cancelled: true } });
  }

  if (url.pathname === '/api/video/delete' && req.method === 'POST') {
    // 2026-08-07：删除历史运行目录（仅终态）；未找到 404，活动运行 409
    const { id } = await readBody();
    const r = bridge.deleteRun(id);
    if (!r.ok) {
      const status = r.error.startsWith('RUN_NOT_FOUND') ? 404 : 409;
      return json(status, { ok: false, error: r.error });
    }
    return json(200, { ok: true, data: { deleted: id } });
  }

  json(404, { ok: false, error: 'VIDEO_ROUTE_NOT_FOUND' });
}

// 失败步骤标识：优先取脚本文件名（tts-synthesize.ps1 / run-subtitles.ts / prepare-video-assets.ts），remotion 步给固定名
function stepLabel(step) {
  if (step.cmd === 'node' && step.args[0]?.includes('remotion')) return 'remotion-render';
  const script = step.args.find((a) => /\.(ps1|ts)$/.test(a));
  return script ? script.split(/[\\/]/).pop() : step.cmd;
}

// 杀进程树：taskkill /PID <pid> /T /F（Windows 系统命令，spawn 直启），失败静默
function killProcessTree(pidFile) {
  try {
    if (!existsSync(pidFile)) return;
    const pid = readFileSync(pidFile, 'utf8').trim();
    if (/^\d+$/.test(pid)) spawn('taskkill', ['/PID', pid, '/T', '/F'], { windowsHide: true });
  } catch {}
}

function appendLog(file, chunk) {
  try { appendFileSync(file, chunk.toString('utf8')); } catch {}
}
function writeError(runsDir, runId, msg) {
  try { writeFileSync(join(runsDir, runId, 'error.txt'), msg, 'utf8'); } catch {}
}
