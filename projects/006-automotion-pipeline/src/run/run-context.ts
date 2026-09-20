import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../fs/atomic.js';

export interface TaskFile {
  runId: string;
  topic: string;
  angle?: string;
  createdAt: string;
  /** 运行状态标记：normal / fallback_flash_glm（规格 §3.2） */
  runMode: 'normal' | 'fallback_flash_glm';
  paths: {
    draft: string;
    review: string;
    verdict: string;
    state: string;
  };
}

/**
 * 单条视频的运行上下文：创建独立运行目录（规格 §7 临时运行区），
 * task.json 记录主题、运行模式与各交接文件路径；一切阶段产物原子写。
 */
export class RunContext {
  constructor(
    public readonly runDir: string,
    public readonly task: TaskFile,
  ) {}

  static create(baseDir: string, topic: string, angle?: string): RunContext {
    const runId = `run-${Date.now()}`;
    const runDir = join(baseDir, runId);
    mkdirSync(runDir, { recursive: true });
    const task: TaskFile = {
      runId,
      topic,
      ...(angle ? { angle } : {}),
      createdAt: new Date().toISOString(),
      runMode: 'normal',
      paths: {
        draft: join(runDir, 'codex_draft.json'),
        review: join(runDir, 'flash_review.json'),
        verdict: join(runDir, 'final_script.json'),
        state: join(runDir, 'state.json'),
      },
    };
    const ctx = new RunContext(runDir, task);
    ctx.writeTask();
    return ctx;
  }

  static load(runDir: string): RunContext {
    const task = JSON.parse(readFileSync(join(runDir, 'task.json'), 'utf8')) as TaskFile;
    return new RunContext(runDir, task);
  }

  taskPath(): string {
    return join(this.runDir, 'task.json');
  }

  writeTask(): void {
    atomicWriteFileSync(this.taskPath(), JSON.stringify(this.task, null, 2));
  }

  setRunMode(mode: TaskFile['runMode']): void {
    this.task.runMode = mode;
    this.writeTask();
  }
}
