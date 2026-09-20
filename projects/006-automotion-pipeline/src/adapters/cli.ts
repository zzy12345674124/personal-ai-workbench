import { execFileSync, spawn } from 'node:child_process';

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  timeoutMs?: number;
  /** 写入子进程 stdin 后关闭；不传则直接关闭 stdin */
  stdin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * 解析 claude 可执行入口（2026-08-06 修复）：npm 全局安装是 claude.cmd shim，
 * 裸名 'claude' 直接 spawn 会 EINVAL（CreateProcess 不能执行批处理，3ms 即 error 事件、输出为空）。
 * 优先 CLAUDE_BIN 环境变量；否则用 `where claude` 定位 .cmd 路径，由 runCli 走 cmd /c 包装（踩坑日志 2.6 已验证模式）。
 */
export function resolveClaudeBin(): string {
  const configured = process.env.CLAUDE_BIN;
  if (configured) return configured;
  try {
    const out = execFileSync('cmd.exe', ['/d', '/s', '/c', 'where claude'], { encoding: 'utf8', windowsHide: true });
    const cmd = out.split(/\r?\n/).find((l) => /\.cmd$/i.test(l.trim()));
    if (cmd) return cmd.trim();
  } catch {
    // where 不可用（非 Windows 等）：回退裸名，由 spawn 报错暴露
  }
  return 'claude';
}

/** 子进程调用封装：捕获 stdout/stderr，超时杀进程 */
export function runCli(filePath: string, args: string[], options: RunOptions = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    // Windows CreateProcess 不能直接执行 .cmd/.bat，需经 cmd.exe /c 包装；
    // cmd.exe 不识别正斜杠路径，必须反斜杠化。
    // 不使用 windowsVerbatimArguments：让 Node 默认对参数做引号转义，
    // 否则带空格的参数（如 prompt）会被 cmd 拆散。
    const isBatch = /\.(cmd|bat)$/i.test(filePath);
    const command = isBatch ? (process.env.ComSpec ?? 'cmd.exe') : filePath;
    const cmdPath = filePath.replaceAll('/', '\\');
    const spawnArgs = isBatch ? ['/d', '/s', '/c', cmdPath, ...args] : args;
    const child = spawn(command, spawnArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, options.timeoutMs ?? 120_000);

    child.on('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut: false });
    });
  });
}

export interface SchemaCallOptions extends RunOptions {
  model?: string;
  /** 传给 CLI 的提示词 */
  prompt: string;
  /** 需要模型输出的 JSON Schema */
  schema: object;
  /** codex 专用：--output-last-message 输出文件（无 TTY 下 stdout 不含结果） */
  outputFile?: string;
}

/**
 * codex exec 参数构造（与 preflight.ps1 已验证的模式一致）。
 * prompt 不走命令行参数：经 cmd /c 包装时含换行/引号的长文本会被截断或拆散，
 * 官方支持从 stdin 读取指令（prompt 不传或传 '-' 时读 stdin）。
 */
export function buildCodexArgs(schemaFile: string, outputFile?: string): string[] {
  return [
    'exec',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--output-schema', schemaFile,
    ...(outputFile ? ['--output-last-message', outputFile] : []),
    '--skip-git-repo-check',
  ];
}

/**
 * claude -p 参数构造；默认模型 deepseek-v4-flash（规格 §3.3 固定变量）。
 * 2026-08-06 修复：prompt **不再作为命令行参数**——经 cmd /c 包装时命令行上限 8191 字符，
 * 内嵌草稿 JSON 的长 prompt（challenge/verdict 约 10-20KB）会被截断，模型只能基于项目上下文作答
 * （实测 review 报「未附带草稿」、verdict 跑偏成工作台主题）。prompt 由调用方经 stdin 传入。
 */
export function buildClaudeArgs(prompt: string, schema: object, model = 'deepseek-v4-flash'): string[] {
  return [
    '-p',
    '--model', model,
    '--permission-mode', 'plan',
    '--tools', '',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--no-session-persistence',
  ];
}

/**
 * codex exec 结构化调用：--output-schema 接收 schema 文件路径（OpenAI response_format 校验要求）。
 * 返回 stdout（含 result/structured_output 的 JSON 与 CLI 交互文本）。
 */
export async function runCodexWithSchema(
  codexPath: string,
  schemaFile: string,
  prompt: string,
  options: Omit<SchemaCallOptions, 'prompt' | 'schema'> = {},
): Promise<CliResult> {
  return runCli(codexPath, buildCodexArgs(schemaFile, options.outputFile), {
    stdin: prompt,
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
    env: options.env,
  });
}

/**
 * claude -p 结构化调用：--json-schema 接收 schema JSON 内容。
 * 项目固定显式指定 deepseek-v4-flash，不修改全局模型配置（规格 §3.3）。
 */
export async function runClaudeWithSchema(
  claudePath: string,
  prompt: string,
  schema: object,
  options: Omit<SchemaCallOptions, 'prompt' | 'schema'> = {},
): Promise<CliResult> {
  return runCli(claudePath, buildClaudeArgs(prompt, schema, options.model), {
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
    env: options.env,
    stdin: prompt, // 2026-08-06：prompt 走 stdin，绕开 cmd /c 8191 字符命令行上限
  });
}
