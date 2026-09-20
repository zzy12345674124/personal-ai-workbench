import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function whereCommand(name) {
  try {
    const output = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

export function resolveClaudeBin(env = process.env) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  if (env.APPDATA) return join(env.APPDATA, 'npm', 'claude.cmd');
  return firstExisting([
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe') : null,
  ]) ?? whereCommand('claude') ?? 'claude';
}

export function resolveCodexBin(env = process.env) {
  if (env.CODEX_BIN) return env.CODEX_BIN;
  if (env.APPDATA) return join(env.APPDATA, 'npm', 'codex.cmd');
  return firstExisting([
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'codex', 'codex.exe') : null,
  ]) ?? whereCommand('codex') ?? 'codex';
}

export function resolveNpmBin(env = process.env) {
  if (env.NPM_BIN) return env.NPM_BIN;
  if (env.APPDATA && existsSync(join(env.APPDATA, 'npm', 'npm.cmd'))) return join(env.APPDATA, 'npm', 'npm.cmd');
  return firstExisting([
  ]) ?? whereCommand('npm.cmd') ?? 'npm.cmd';
}

export function runCli(filePath, args, options = {}) {
  return new Promise((resolve) => {
    const isBatch = /\.(cmd|bat)$/i.test(filePath);
    const command = isBatch ? (options.env?.ComSpec ?? process.env.ComSpec ?? 'cmd.exe') : filePath;
    const batchPath = filePath.replaceAll('/', '\\');
    const spawnArgs = isBatch ? ['/d', '/s', '/c', batchPath, ...args] : args;
    let settled = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(command, spawnArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: null, stdout, stderr, timedOut: true });
    }, options.timeoutMs ?? 600_000);

    child.on('error', (error) => finish({ exitCode: null, stdout, stderr: `${stderr}${error.message}`, timedOut: false }));
    child.on('close', (exitCode) => finish({ exitCode, stdout, stderr, timedOut: false }));
  });
}

export function buildClaudeArgs(autoMotionDir) {
  return [
    '-p',
    '--permission-mode', 'dontAsk',
    '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash(npm.cmd test*),Bash(npm.cmd run build*),Bash(git status*),Bash(git diff*)',
    '--disallowedTools', 'WebFetch,WebSearch',
    '--output-format', 'json',
    '--no-session-persistence',
    '--add-dir', autoMotionDir,
  ];
}

export function buildCodexArgs({ schemaFile, outputFile, workbenchDir, autoMotionDir }) {
  return [
    'exec',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--output-schema', schemaFile,
    '--output-last-message', outputFile,
    '--skip-git-repo-check',
    '--cd', workbenchDir,
    '--add-dir', autoMotionDir,
    '-',
  ];
}

export function runClaude(prompt, options) {
  return runCli(options.claudeBin ?? resolveClaudeBin(), buildClaudeArgs(options.autoMotionDir), {
    cwd: options.workbenchDir,
    stdin: prompt,
    timeoutMs: options.timeoutMs ?? 1_800_000,
    env: options.env,
  });
}

export function runCodex(prompt, options) {
  return runCli(options.codexBin ?? resolveCodexBin(), buildCodexArgs(options), {
    cwd: options.workbenchDir,
    stdin: prompt,
    timeoutMs: options.timeoutMs ?? 900_000,
    env: options.env,
  });
}

export async function runProjectChecks(workbenchDir, autoMotionDir, options = {}) {
  const npmBin = options.npmBin ?? resolveNpmBin(options.env);
  const commands = [
    { name: '008 npm test', cwd: workbenchDir, args: ['test'] },
    { name: '006 npm run build', cwd: autoMotionDir, args: ['run', 'build'] },
    { name: '006 npm test', cwd: autoMotionDir, args: ['test'] },
  ];
  const results = [];
  for (const command of commands) {
    const result = await runCli(npmBin, command.args, {
      cwd: command.cwd,
      timeoutMs: options.timeoutMs ?? 300_000,
      env: options.env,
    });
    results.push({ name: command.name, ...result });
    if (result.exitCode !== 0 || result.timedOut) break;
  }
  return results;
}
