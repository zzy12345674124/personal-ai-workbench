// server/env.js —— 极简 .env 加载（零依赖）：项目根 .env 的 KEY=VALUE 写入 process.env。
// 已存在的环境变量优先（不覆盖）；# 注释与空行跳过；.env 不存在时静默。
// 用途：TAVILY_API_KEY 等流水线密钥，避免依赖系统环境变量（2026-08-07）。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadDotEnv() {
  try {
    const text = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(trimmed);
      if (!m) continue;
      const [, key, value] = m;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env 不存在：全部走系统环境变量
  }
}
