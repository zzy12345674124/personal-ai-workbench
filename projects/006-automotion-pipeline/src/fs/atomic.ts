import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 原子写入：先写同目录临时文件再 rename，避免读者看到半写状态 */
export function atomicWriteFileSync(target: string, data: string): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, target);
}
