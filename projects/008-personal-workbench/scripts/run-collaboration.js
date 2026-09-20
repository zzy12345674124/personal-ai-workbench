import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AUTOMOTION_DIR, PROJECT_ROOT } from '../server/paths.js';
import { resolveClaudeBin, resolveCodexBin } from '../server/collaboration/cli.js';
import { createDefaultOrchestrator } from '../server/collaboration/orchestrator.js';
import { readState } from '../server/collaboration/state.js';

const DEFAULT_TASK = join(PROJECT_ROOT, '008-模板参数生产接线-协同任务.md');
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function notifyUser(message) {
  const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${message.replaceAll("'", "''")}','会话管家｜Codex-Claude 协同')`;
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const taskFile = resolve(valueAfter('--task') ?? DEFAULT_TASK);
const maxRounds = Number(valueAfter('--max-rounds') ?? '6');
if (!existsSync(taskFile)) throw new Error(`任务书不存在：${taskFile}`);
if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) throw new Error('--max-rounds 必须为 1～10 的整数');

const orchestrator = createDefaultOrchestrator({ projectRoot: PROJECT_ROOT, autoMotionDir: AUTOMOTION_DIR, taskFile });
const state = orchestrator.initialize(maxRounds);

if (args.includes('--status')) {
  print({ state, cli: { claude: resolveClaudeBin(), codex: resolveCodexBin() } });
  process.exit(0);
}

if (args.includes('--resume-claude')) {
  print(orchestrator.resumeForClaude());
  process.exit(0);
}

if (args.includes('--extend-rounds')) {
  const extraRounds = Number(valueAfter('--extend-rounds'));
  if (!Number.isInteger(extraRounds) || extraRounds < 1 || extraRounds > 7) {
    throw new Error('--extend-rounds 必须为 1～7 的整数');
  }
  print(orchestrator.extendForClaude(extraRounds));
  process.exit(0);
}

if (args.includes('--init') || args.includes('--dry-run')) {
  print({
    ok: true,
    mode: args.includes('--dry-run') ? 'dry-run' : 'init',
    state,
    cli: { claude: resolveClaudeBin(), codex: resolveCodexBin() },
    note: '未调用任何模型。',
  });
  process.exit(0);
}

if (args.includes('--once')) {
  print(await orchestrator.runOne());
  process.exit(0);
}

if (!args.includes('--watch')) {
  throw new Error('请选择 --init、--status、--resume-claude、--extend-rounds、--dry-run、--once 或 --watch');
}

while (true) {
  const result = await orchestrator.runOne();
  print({ at: new Date().toISOString(), ...result });
  const current = readState(orchestrator.statePath);
  if (current.status === 'APPROVED') {
    notifyUser('Codex-Claude 自动协同已复核通过，请回到对话查看结果并进行手动验收。');
    break;
  }
  if (current.status === 'AWAITING_USER' || current.status === 'FAILED') {
    notifyUser(`自动协同已暂停：${current.lastError ?? current.status}。请回到对话处理。`);
    break;
  }
  await sleep(1000);
}
