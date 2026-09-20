// tests/video-bridge.test.ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVideoBridge, videoRouter } from '../server/bridges/video.js';
import { DEFAULT_TEMPLATE_CONFIG } from '../server/template-config.js';

// 第 7 轮修复（Codex P1）：删除 RUNS_DIR 导入与所有真实路径断言——自动化测试不得读取真实 runs/。
// 「未误用默认路径」改以 mock/spy 验证：把 server/paths.js 的 RUNS_DIR mock 成 mkdtemp 临时目录，
// 任何走默认路径的写入都会落到该临时目录；测试据此断言默认路径未被触碰（而非访问真实 runs）。
const pathsMock = vi.hoisted(() => ({ fakeRunsDir: null }));
vi.mock('../server/paths.js', async (importOriginal) => {
  const actual = await importOriginal();
  const fakeRunsDir = mkdtempSync(join(tmpdir(), 'wb-default-runs-'));
  pathsMock.fakeRunsDir = fakeRunsDir;
  return { ...actual, RUNS_DIR: fakeRunsDir };
});

// 任务书 §5：路由级测试需要断言「非法配置不 spawn」——mock node:child_process 的 spawn。
// 现有 bridge 用例不实际调用 spawn（buildConfirmChain 只构造命令、cancel 无 pid 文件时早退），不受影响。
const childProcessMock = vi.hoisted(() => {
  const makeChild = () => {
    const handlers = {};
    const child = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (name, fn) => { (handlers[name] ??= []).push(fn); return child; },
      emit: (name, ...args) => { (handlers[name] ?? []).forEach((fn) => fn(...args)); },
    };
    return child;
  };
  return {
    spawn: vi.fn(() => makeChild()),
    spawnSync: vi.fn(),
    exec: vi.fn(),
    execFile: vi.fn(),
  };
});
vi.mock('node:child_process', () => childProcessMock);

describe('video bridge', () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'wb-runs-command-'));
  const b = createVideoBridge({
    automotionDir: 'D:/x/project_006',
    runsDir,
  });
  it('submit 命令：cwd=006、AUTOMOTION_RUN_ROOT=008 runs、角度含分镜约束', () => {
    const c = b.buildSubmitCommand('主题A', '给新手', JSON.stringify([{ type: 'hero', title: 'T' }]));
    expect(c.cwd).toBe('D:/x/project_006');
    // buildSubmitCommand 会创建运行目录；测试必须使用临时目录，禁止触碰真实 runs/ 或虚构盘符路径。
    expect(c.env.AUTOMOTION_RUN_ROOT).toBe(join(runsDir, c.runId));
    expect(c.args[3]).toContain('给新手');
    expect(c.args[3]).toContain('分镜约束');
  });

  it('submit 命令：时效模式透传（默认 strict，relaxed/custom 可切换）', () => {
    expect(b.buildSubmitCommand('T').env.PIPELINE_TIMELINESS).toBe('strict');
    expect(b.buildSubmitCommand('T', '', undefined, 'fallback', 'relaxed').env.PIPELINE_TIMELINESS).toBe('relaxed');
    expect(b.buildSubmitCommand('T', '', undefined, 'fallback', '其他值').env.PIPELINE_TIMELINESS).toBe('strict');
    // custom 模式：用户规则文本进 env（Unicode 安全）
    const c = b.buildSubmitCommand('T', '', undefined, 'fallback', 'custom', '只收录 2026-08-01 至 2026-08-07 之间的信息');
    expect(c.env.PIPELINE_TIMELINESS).toBe('custom');
    expect(c.env.PIPELINE_TIMELINESS_RULES).toBe('只收录 2026-08-01 至 2026-08-07 之间的信息');
    // 非 custom 模式不注入规则
    expect(b.buildSubmitCommand('T', '', undefined, 'fallback', 'strict', '规则').env.PIPELINE_TIMELINESS_RULES).toBeUndefined();
  });

  it('submit 落盘 scene-draft.json（多模态第二阶段：media 确定性注入源）；无场景草稿不落盘', () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'wb-runs-'));
    const b2 = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir });
    const c = b2.buildSubmitCommand('主题', '角度', JSON.stringify([{ title: 'A', media: [{ kind: 'video', src: 'radial-menu' }] }]));
    const draftFile = join(runsDir, c.runId, 'scene-draft.json');
    expect(existsSync(draftFile)).toBe(true);
    const draft = JSON.parse(readFileSync(draftFile, 'utf8'));
    expect(draft[0].media[0]).toEqual({ kind: 'video', src: 'radial-menu' });
    const c2 = b2.buildSubmitCommand('主题2');
    expect(existsSync(join(runsDir, c2.runId, 'scene-draft.json'))).toBe(false);
  });

  it('listRuns 返回历史运行（主题/创建时间/阶段）', () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'wb-runs-'));
    const runDir = join(runsDir, 'run-123');
    mkdirSync(join(runDir, 'run-456'), { recursive: true });
    writeFileSync(
      join(runDir, 'task.json'),
      JSON.stringify({ runId: 'run-456', topic: '测试主题', createdAt: '2026-08-06T08:00:00.000Z', angle: '' }),
      'utf8',
    );
    const b = createVideoBridge({ automotionDir: 'D:/x/006', runsDir });
    const runs = b.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId: 'run-123', topic: '测试主题', stage: 'running' });
    expect(runs[0].finalMp4).toBe(false);
  });

  it('confirm 渲染链按顺序构造', () => {
    const chain = b.buildConfirmChain('run-1', 'D:/x/project_006/runs/run-1');
    expect(chain.length).toBe(5);
    // 程序在 cmd、脚本路径在 args（spawn 可执行形式；brief 原断言 cmd 含脚本名无法通过）
    expect(chain[0].cmd).toBe('powershell');
    expect(chain[0].args.some((a) => a.includes('tts-synthesize-mimo.ps1'))).toBe(true);
    expect(chain[3].cmd).toBe('node');
    expect(chain[3].args.some((a) => a.includes('remotion'))).toBe(true);
    expect(chain[3].args).toContain('rag-video');
    // 2026-08-07 视觉质检步骤（render 之后）
    expect(chain[4].cmd).toBe('powershell');
    expect(chain[4].args.some((a) => a.includes('run-visual-review.ps1'))).toBe(true);
  });
});

describe('video bridge 审查修复', () => {
  it('resolveRunDir：内层含 run-summary.json 时返回内层，否则返回外层，非法 id 为 null', () => {
    const root = mkdtempSync(join(tmpdir(), 'vb-r-'));
    const b = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir: root });
    // 只有外层（无内层）→ 返回外层
    mkdirSync(join(root, 'run-1'), { recursive: true });
    expect(b.resolveRunDir('run-1')).toBe(join(root, 'run-1'));
    // 内层含 run-summary.json → 返回内层（006 RunContext 嵌套场景）
    const inner = join(root, 'run-1', 'run-999');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'run-summary.json'), '{}');
    expect(b.resolveRunDir('run-1')).toBe(inner);
    // 非法 id（目录穿越）→ null
    expect(b.resolveRunDir('../evil')).toBeNull();
  });

  it('cancelRun：非法 id 返回错误；done 阶段不写 error.txt，running 阶段写', () => {
    const root = mkdtempSync(join(tmpdir(), 'vb-c-'));
    const b = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir: root });
    // 非法 id（../ 穿越）→ 错误
    expect(b.cancelRun('../evil').ok).toBe(false);
    // done 阶段 fixture：内层 run-summary.json + final.mp4
    const outer = join(root, 'run-2');
    const inner = join(outer, 'run-888');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'run-summary.json'), '{}');
    writeFileSync(join(inner, 'final.mp4'), 'x');
    expect(b.stageOf('run-2').stage).toBe('done');
    b.cancelRun('run-2');
    expect(existsSync(join(outer, 'error.txt'))).toBe(false); // done 阶段不覆写/不写 error
    // running 阶段 → 写 CANCELLED_BY_USER
    mkdirSync(join(root, 'run-3'), { recursive: true });
    b.cancelRun('run-3');
    expect(readFileSync(join(root, 'run-3', 'error.txt'), 'utf8')).toBe('CANCELLED_BY_USER');
  });

  it('confirmStageGuard：非 draft_ready 阶段返回 BAD_STAGE，draft_ready 放行', () => {
    const root = mkdtempSync(join(tmpdir(), 'vb-g-'));
    const b = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir: root });
    // running 阶段（仅外层空目录）→ 拒绝
    mkdirSync(join(root, 'run-4'), { recursive: true });
    expect(b.confirmStageGuard('run-4').ok).toBe(false);
    expect(b.confirmStageGuard('run-4').error).toContain('BAD_STAGE');
    // missing → 拒绝
    expect(b.confirmStageGuard('run-nope').error).toContain('BAD_STAGE');
    // draft_ready（内层含 run-summary.json）→ 放行
    const inner = join(root, 'run-4', 'run-777');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'run-summary.json'), '{"stage":"user_confirmation"}');
    expect(b.confirmStageGuard('run-4').ok).toBe(true);
  });

  it('deleteRun：终态可删、活动拒绝、非法 id 拒绝、防穿越', () => {
    const root = mkdtempSync(join(tmpdir(), 'vb-d-'));
    const b = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir: root });
    // 非法 id（穿越）→ RUN_NOT_FOUND
    expect(b.deleteRun('../evil').ok).toBe(false);
    // done 终态（内层 run-summary.json + final.mp4）→ 删除成功 + 目录消失
    const outer = join(root, 'run-9');
    const inner = join(outer, 'run-999');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'run-summary.json'), '{}');
    writeFileSync(join(inner, 'final.mp4'), 'x');
    expect(b.deleteRun('run-9').ok).toBe(true);
    expect(existsSync(outer)).toBe(false);
    // 活动运行（仅外层空目录 = running）→ 拒绝
    mkdirSync(join(root, 'run-10'), { recursive: true });
    const r = b.deleteRun('run-10');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('RUN_NOT_TERMINAL');
    expect(existsSync(join(root, 'run-10'))).toBe(true); // 目录保留
  });

  it('stageOf/listRuns：里程碑时间（render-start 内容 / final.mp4 mtime / error.txt mtime）', () => {
    const root = mkdtempSync(join(tmpdir(), 'vb-t-'));
    const b = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir: root });
    // done 阶段：内层 run-summary.json + final.mp4 + render-start.txt
    const outer = join(root, 'run-5');
    const inner = join(outer, 'run-777');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'run-summary.json'), '{}');
    writeFileSync(join(inner, 'final.mp4'), 'x');
    writeFileSync(join(inner, 'render-start.txt'), '2026-08-06T06:00:00.000Z');
    const st = b.stageOf('run-5');
    expect(st.stage).toBe('done');
    expect(st.startedAt).toBe('2026-08-06T06:00:00.000Z');
    expect(st.finishedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(st.finishedAt))).toBe(false);
    // listRuns 透传里程碑时间
    const runs = b.listRuns();
    expect(runs[0]).toMatchObject({ runId: 'run-5', startedAt: '2026-08-06T06:00:00.000Z' });
    expect(runs[0].finishedAt).toBeTruthy();
    // failed 阶段：error.txt mtime → failedAt
    writeFileSync(join(outer, 'error.txt'), 'E');
    const stF = b.stageOf('run-5');
    expect(stF.stage).toBe('failed');
    expect(stF.failedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(stF.failedAt))).toBe(false);
  });
});

describe('video bridge 模板配置快照（任务书 §5）', () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'wb-tc-'));
  const b = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir });
  const snapshotOf = (runId) => JSON.parse(readFileSync(join(runsDir, runId, 'template-config.json'), 'utf8'));

  it('省略 templateConfig 时写默认快照', () => {
    const c = b.buildSubmitCommand('主题');
    expect(snapshotOf(c.runId)).toEqual(DEFAULT_TEMPLATE_CONFIG);
  });

  it('合法配置写规范化快照（去空白/大写/取整）', () => {
    const c = b.buildSubmitCommand('主题', '', undefined, 'fallback', 'strict', '', {
      schemaVersion: 1,
      workspaceTitle: '  快照标题  ',
      accentColor: '#aa00bb',
      workspaceTitleSize: 28.6,
    });
    expect(snapshotOf(c.runId)).toEqual({ ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '快照标题', accentColor: '#AA00BB', workspaceTitleSize: 29 });
  });

  it('非法配置：不创建运行目录且抛 BAD_TEMPLATE_CONFIG', () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-tc-'));
    const b2 = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir: root });
    expect(() =>
      b2.buildSubmitCommand('主题', '', undefined, 'fallback', 'strict', '', {
        schemaVersion: 2,
        workspaceTitle: 'x',
        accentColor: '#007ACC',
        workspaceTitleSize: 26,
      }),
    ).toThrow('BAD_TEMPLATE_CONFIG');
    expect(readdirSync(root)).toHaveLength(0);
  });

  it('两次运行快照互不影响（每次独立）', () => {
    const a = b.buildSubmitCommand('A', '', undefined, 'fallback', 'strict', '', {
      schemaVersion: 1, workspaceTitle: 'A', accentColor: '#111111', workspaceTitleSize: 18,
    });
    const c2 = b.buildSubmitCommand('B', '', undefined, 'fallback', 'strict', '', {
      schemaVersion: 1, workspaceTitle: 'B', accentColor: '#222222', workspaceTitleSize: 40,
    });
    expect(snapshotOf(a.runId).workspaceTitle).toBe('A');
    expect(snapshotOf(c2.runId).workspaceTitle).toBe('B');
    expect(snapshotOf(a.runId)).not.toEqual(snapshotOf(c2.runId));
  });

  it('旧参数调用仍可用（6 参数形式不受影响）', () => {
    const c = b.buildSubmitCommand('主题', '角度', undefined, 'fallback', 'custom', '只收录本月信息');
    expect(c.env.PIPELINE_TIMELINESS).toBe('custom');
    expect(c.env.PIPELINE_TIMELINESS_RULES).toBe('只收录本月信息');
    expect(snapshotOf(c.runId)).toEqual(DEFAULT_TEMPLATE_CONFIG);
  });
});

describe('video submit router 模板配置（任务书 §5，注入临时 runsDir）', () => {
  const makeUrl = () => new URL('http://127.0.0.1:8080/api/video/submit');
  const makeRes = () => {
    const out = { status: 0, headers: {}, body: null };
    return {
      out,
      writeHead(code, headers = {}) {
        out.status = code;
        out.headers = headers;
      },
      end(payload) {
        if (typeof payload === 'string') {
          try { out.body = JSON.parse(payload); } catch { out.body = payload; }
        } else {
          out.body = payload;
        }
      },
    };
  };
  const makeReq = (body) => {
    const req = { method: 'POST', headers: {} };
    req[Symbol.asyncIterator] = async function* () {
      if (body !== undefined) yield Buffer.from(body, 'utf8');
    };
    return req;
  };

  it('省略 templateConfig：写默认快照并 spawn 一次', async () => {
    childProcessMock.spawn.mockClear();
    const root = mkdtempSync(join(tmpdir(), 'wb-rt-'));
    const res = makeRes();
    await videoRouter(makeReq(JSON.stringify({ topic: '主题' })), res, makeUrl(), { runsDir: root });
    expect(res.out.status).toBe(200);
    const runId = res.out.body.data.runId;
    expect(JSON.parse(readFileSync(join(root, runId, 'template-config.json'), 'utf8'))).toEqual(DEFAULT_TEMPLATE_CONFIG);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
  });

  it('合法 templateConfig 透传并写规范化快照', async () => {
    childProcessMock.spawn.mockClear();
    const root = mkdtempSync(join(tmpdir(), 'wb-rt-'));
    const res = makeRes();
    await videoRouter(
      makeReq(JSON.stringify({ topic: '主题', templateConfig: { schemaVersion: 1, workspaceTitle: '  路由  ', accentColor: '#00aa11', workspaceTitleSize: 31.5 } })),
      res,
      makeUrl(),
      { runsDir: root },
    );
    expect(res.out.status).toBe(200);
    const runId = res.out.body.data.runId;
    expect(JSON.parse(readFileSync(join(root, runId, 'template-config.json'), 'utf8'))).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '路由', accentColor: '#00AA11', workspaceTitleSize: 32,
    });
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
  });

  it('微信 V3 配置完整写入独立运行快照', async () => {
    childProcessMock.spawn.mockClear();
    const root = mkdtempSync(join(tmpdir(), 'wb-rt-'));
    const res = makeRes();
    const wechatConfig = {
      ...DEFAULT_TEMPLATE_CONFIG,
      shellType: 'wechat',
      workspaceTitle: '  虚构主题演示  ',
      accentColor: '#07c160',
      workspaceTitleSize: 28,
      wechatContact: '  文件传输助手  ',
      wechatAvatarText: ' 文 ',
      wechatBubbleColor: '#95ec69',
    };
    await videoRouter(
      makeReq(JSON.stringify({ topic: '虚构主题', templateConfig: wechatConfig })),
      res,
      makeUrl(),
      { runsDir: root },
    );
    expect(res.out.status).toBe(200);
    const runId = res.out.body.data.runId;
    expect(JSON.parse(readFileSync(join(root, runId, 'template-config.json'), 'utf8'))).toEqual({
      ...wechatConfig,
      workspaceTitle: '虚构主题演示',
      accentColor: '#07C160',
      wechatContact: '文件传输助手',
      wechatAvatarText: '文',
      wechatBubbleColor: '#95EC69',
    });
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
  });

  it('Claude V3 配置完整写入独立运行快照', async () => {
    childProcessMock.spawn.mockClear();
    const root = mkdtempSync(join(tmpdir(), 'wb-rt-'));
    const res = makeRes();
    const claudeConfig = {
      ...DEFAULT_TEMPLATE_CONFIG,
      shellType: 'claude',
      workspaceTitle: '  虚构主题演示  ',
      accentColor: '#d97757',
      claudeTitle: '  项目讨论  ',
      claudeModel: ' Claude ',
      claudeAvatarText: ' C ',
    };
    await videoRouter(
      makeReq(JSON.stringify({ topic: '虚构主题', templateConfig: claudeConfig })),
      res,
      makeUrl(),
      { runsDir: root },
    );
    expect(res.out.status).toBe(200);
    const runId = res.out.body.data.runId;
    expect(JSON.parse(readFileSync(join(root, runId, 'template-config.json'), 'utf8'))).toEqual({
      ...claudeConfig,
      workspaceTitle: '虚构主题演示',
      accentColor: '#D97757',
      claudeTitle: '项目讨论',
      claudeModel: 'Claude',
      claudeAvatarText: 'C',
    });
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
  });

  it('非法 templateConfig：400 BAD_TEMPLATE_CONFIG、不建运行目录、不 spawn', async () => {
    childProcessMock.spawn.mockClear();
    const root = mkdtempSync(join(tmpdir(), 'wb-rt-'));
    const res = makeRes();
    await videoRouter(
      makeReq(JSON.stringify({ topic: '主题', templateConfig: { schemaVersion: 2, workspaceTitle: 'x', accentColor: '#007ACC', workspaceTitleSize: 26 } })),
      res,
      makeUrl(),
      { runsDir: root },
    );
    expect(res.out.status).toBe(400);
    expect(res.out.body).toEqual({ ok: false, error: 'BAD_TEMPLATE_CONFIG' });
    expect(readdirSync(root)).toHaveLength(0);
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });
});

// —— 第 4 轮 Codex 反馈 P3/P4 回归（tests 所有权：tests/video-bridge.test.ts）——
describe('video confirm router 错误隔离与运行编号唯一（第 4 轮 P3/P4）', () => {
  const makeUrl = (path = '/api/video/confirm') => new URL(`http://127.0.0.1:8080${path}`);
  const makeRes = () => {
    const out = { status: 0, headers: {}, body: null };
    return {
      out,
      writeHead(code, headers = {}) {
        out.status = code;
        out.headers = headers;
      },
      end(payload) {
        if (typeof payload === 'string') {
          try { out.body = JSON.parse(payload); } catch { out.body = payload; }
        } else {
          out.body = payload;
        }
      },
    };
  };
  const makeReq = (body) => {
    const req = { method: 'POST', headers: {} };
    req[Symbol.asyncIterator] = async function* () {
      if (body !== undefined) yield Buffer.from(body, 'utf8');
    };
    return req;
  };

  it('P3：confirm 生产步骤失败时 error.txt 只写入注入的临时 runsDir，真实 RUNS_DIR 不被触碰', async () => {
    childProcessMock.spawn.mockClear();
    const root = mkdtempSync(join(tmpdir(), 'wb-cf-'));
    // draft_ready fixture：外层 run-991301 + 内层 run-1（含 run-summary.json → resolveRunDir 返回内层）
    // 第 5 轮修复：fixture id 必须匹配 runDirOf 的 /^run-\d+$/（video.js），原 run-cf1 含字母被
    // resolveRunDir 判非法 → confirm 路由 404 RUN_NOT_FOUND、永远不 spawn，vi.waitFor 超时
    const outer = join(root, 'run-991301');
    const inner = join(outer, 'run-1');
    mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, 'run-summary.json'), '{"stage":"user_confirmation"}');
    const res = makeRes();
    const pending = videoRouter(makeReq(JSON.stringify({ id: 'run-991301' })), res, makeUrl(), { runsDir: root });
    // router 等待生产链第一步 close 事件——先等 spawn 发生，再让模拟子进程失败
    await vi.waitFor(() => expect(childProcessMock.spawn).toHaveBeenCalled());
    childProcessMock.spawn.mock.results[0].value.emit('close', 1);
    await pending;
    expect(res.out.status).toBe(200);
    expect(res.out.body.data.stage).toBe('failed');
    const errFile = join(root, 'run-991301', 'error.txt');
    expect(existsSync(errFile)).toBe(true);
    expect(readFileSync(errFile, 'utf8')).toContain('CONFIRM_STEP_FAILED: tts-synthesize-mimo.ps1 exit=1');
    // 错误只写入注入目录：默认路径（RUNS_DIR 被 mock 为 mkdtemp 临时目录，非真实 runs/）
    // 下不得出现任何运行数据——证明 confirm 失败分支没有误用默认路径
    expect(pathsMock.fakeRunsDir).not.toBeNull();
    expect(existsSync(join(pathsMock.fakeRunsDir, 'run-991301'))).toBe(false);
    expect(readdirSync(pathsMock.fakeRunsDir)).toHaveLength(0);
  });

  it('P4：固定 Date.now 下连续提交的运行编号与快照目录始终不同（快照互不覆盖）', () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-uid-'));
    const b2 = createVideoBridge({ automotionDir: 'D:/x/project_006', runsDir: root });
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      const runIds = new Set();
      const dirs = new Set();
      const titles = new Set();
      for (let i = 0; i < 10; i += 1) {
        const c = b2.buildSubmitCommand('主题' + i, '', undefined, 'fallback', 'strict', '', {
          schemaVersion: 1, workspaceTitle: 'T' + i, accentColor: '#000000', workspaceTitleSize: 26,
        });
        runIds.add(c.runId);
        dirs.add(join(root, c.runId));
        // 每次运行都得到自己的快照目录
        expect(existsSync(join(root, c.runId, 'template-config.json'))).toBe(true);
        titles.add(JSON.parse(readFileSync(join(root, c.runId, 'template-config.json'), 'utf8')).workspaceTitle);
      }
      expect(runIds.size).toBe(10); // 同一毫秒内 10 次提交，运行编号全部不同
      expect(dirs.size).toBe(10);   // 快照目录互不共享（后一次不会覆盖前一次）
      expect(titles.size).toBe(10); // 各快照内容独立
    } finally {
      spy.mockRestore();
    }
  });
});

// —— 第 7 轮 Codex 反馈 P1 回归：路由级并发运行编号唯一（tests 所有权：tests/video-bridge.test.ts）——
// 触发面：videoRouter 每次请求内部都新建 bridge（server.js bridgeRoute 按请求动态导入调用），
// 实例级序号在路由级并发下重置为 0 → 同一毫秒两个提交碰撞。模块级序号修复后两个独立
// router 调用必须得到互不相同的 runId、运行目录与快照。
describe('video submit router 路由级运行编号唯一（第 7 轮 P1）', () => {
  const makeUrl = () => new URL('http://127.0.0.1:8080/api/video/submit');
  const makeRes = () => {
    const out = { status: 0, headers: {}, body: null };
    return {
      out,
      writeHead(code, headers = {}) {
        out.status = code;
        out.headers = headers;
      },
      end(payload) {
        if (typeof payload === 'string') {
          try { out.body = JSON.parse(payload); } catch { out.body = payload; }
        } else {
          out.body = payload;
        }
      },
    };
  };
  const makeReq = (body) => {
    const req = { method: 'POST', headers: {} };
    req[Symbol.asyncIterator] = async function* () {
      if (body !== undefined) yield Buffer.from(body, 'utf8');
    };
    return req;
  };

  it('固定 Date.now 下两个独立 videoRouter 调用的 runId/目录/快照均不同', async () => {
    childProcessMock.spawn.mockClear();
    const root = mkdtempSync(join(tmpdir(), 'wb-route-'));
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      const submit = async (workspaceTitle) => {
        const res = makeRes();
        await videoRouter(
          makeReq(JSON.stringify({
            topic: '主题',
            templateConfig: { schemaVersion: 1, workspaceTitle, accentColor: '#000001', workspaceTitleSize: 26 },
          })),
          res,
          makeUrl(),
          { runsDir: root },
        );
        return res;
      };
      const r1 = await submit('路由A');
      const r2 = await submit('路由B');
      expect(r1.out.status).toBe(200);
      expect(r2.out.status).toBe(200);
      const id1 = r1.out.body.data.runId;
      const id2 = r2.out.body.data.runId;
      expect(id1).not.toBe(id2);
      expect(join(root, id1)).not.toBe(join(root, id2));
      const s1 = JSON.parse(readFileSync(join(root, id1, 'template-config.json'), 'utf8'));
      const s2 = JSON.parse(readFileSync(join(root, id2, 'template-config.json'), 'utf8'));
      expect(s1.workspaceTitle).toBe('路由A');
      expect(s2.workspaceTitle).toBe('路由B');
      expect(s1).not.toEqual(s2);
      expect(childProcessMock.spawn).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});
