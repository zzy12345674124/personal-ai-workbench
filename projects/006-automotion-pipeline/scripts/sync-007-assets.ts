/**
 * 007 → 006 素材同步（起步版：静态素材自动复制）
 * 用法：tsx scripts/sync-007-assets.ts [--dry-run]
 * 读取 project_007_VibeMotion联动/vibe-motion-app/portable-manifest.json：
 *  - type=static：复制进本项目根 public/（Remotion staticFile 目录），内容相同则跳过；
 *  - type=component：只报告待人工移植，不处理。
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function sha256(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

export interface ManifestEntry {
  from: string;
  to: string;
  type: 'static' | 'component';
}

const ENTRY_KEYS = ['from', 'to', 'type'];

function isInside(root: string, target: string): boolean {
  const prefix = resolve(root) + '\\';
  return resolve(target).toLowerCase().startsWith(prefix.toLowerCase());
}

export function normalizeManifestEntry(input: unknown): ManifestEntry {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('MANIFEST_ENTRY_INVALID');
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== ENTRY_KEYS.length || !ENTRY_KEYS.every((key) => Object.hasOwn(record, key))) {
    throw new Error('MANIFEST_ENTRY_INVALID');
  }
  if (record.type !== 'static' && record.type !== 'component') throw new Error('MANIFEST_ENTRY_INVALID');
  if (typeof record.from !== 'string' || !record.from.trim() || typeof record.to !== 'string' || !record.to.trim()) {
    throw new Error('MANIFEST_ENTRY_INVALID');
  }
  return { from: record.from, to: record.to, type: record.type };
}

export function resolveManifestPaths(projectRoot: string, vibeRoot: string, input: unknown): { entry: ManifestEntry; src: string; dst: string } {
  const entry = normalizeManifestEntry(input);
  const src = resolve(vibeRoot, entry.from);
  const dst = resolve(projectRoot, entry.to);
  if (!isInside(vibeRoot, src) || !isInside(projectRoot, dst)) throw new Error('MANIFEST_PATH_OUTSIDE_ROOT');
  const allowedTargetRoot = entry.type === 'static'
    ? resolve(projectRoot, 'public')
    : resolve(projectRoot, 'video', 'src');
  if (!isInside(allowedTargetRoot, dst)) throw new Error('MANIFEST_TARGET_NOT_ALLOWED');
  return { entry, src, dst };
}

export function runSync(options: { projectRoot: string; vibeRoot: string; dryRun?: boolean }): { copied: number; unchanged: number; pending: number } {
  const { projectRoot, vibeRoot, dryRun = false } = options;
  const manifestPath = join(vibeRoot, 'portable-manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`manifest 不存在: ${manifestPath}`);
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { assets?: unknown };
  if (!Array.isArray(parsed.assets)) throw new Error('MANIFEST_INVALID');

  let copied = 0;
  let unchanged = 0;
  let pending = 0;
  for (const rawEntry of parsed.assets) {
    const { entry, src, dst } = resolveManifestPaths(projectRoot, vibeRoot, rawEntry);
    if (!existsSync(src)) throw new Error(`[missing] 源不存在: ${src}`);
    if (entry.type === 'component') {
      console.log(`[pending] ${entry.from} → ${entry.to}（组件，需人工移植）`);
      pending += 1;
      continue;
    }
    if (existsSync(dst) && sha256(src) === sha256(dst)) {
      console.log(`[same]   ${entry.to}`);
      unchanged += 1;
      continue;
    }
    console.log(`[${dryRun ? 'would-copy' : 'copy'}] ${entry.to}`);
    if (!dryRun) {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
      copied += 1;
    }
  }
  console.log(`\n汇总: copied=${copied} unchanged=${unchanged} pendingComponent=${pending}${dryRun ? ' (dry-run)' : ''}`);
  return { copied, unchanged, pending };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(scriptsDir, '..');
  const vibeRoot = resolve(projectRoot, '..', 'project_007_VibeMotion联动', 'vibe-motion-app');
  try {
    runSync({ projectRoot, vibeRoot, dryRun: process.argv.includes('--dry-run') });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
