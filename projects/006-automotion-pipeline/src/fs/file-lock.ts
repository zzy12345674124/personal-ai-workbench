import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';

export interface LockInfo {
  pid: number;
  host: string;
  timestamp: string;
  runId: string;
}

/**
 * 原子文件锁：以 'wx' 独占创建锁文件，记录进程号、主机、时间戳和运行 ID。
 * 仅当持有进程已不存在时才回收过期锁（规格 §9）。
 */
export class FileLock {
  constructor(private readonly lockPath: string) {}

  /** 尝试获取锁；成功返回 true，已被存活进程持有返回 false */
  acquire(runId: string): boolean {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    if (existsSync(this.lockPath)) {
      if (!this.isStale()) return false;
      this.release();
    }
    const info: LockInfo = {
      pid: process.pid,
      host: hostname(),
      timestamp: new Date().toISOString(),
      runId,
    };
    try {
      writeFileSync(this.lockPath, JSON.stringify(info, null, 2), { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }

  readInfo(): LockInfo | null {
    try {
      return JSON.parse(readFileSync(this.lockPath, 'utf8')) as LockInfo;
    } catch {
      return null;
    }
  }

  /** 持有进程存活则不算过期 */
  private isStale(): boolean {
    const info = this.readInfo();
    if (!info) return true;
    return !isProcessAlive(info.pid);
  }

  release(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      // 锁文件已不存在，视为已释放
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
