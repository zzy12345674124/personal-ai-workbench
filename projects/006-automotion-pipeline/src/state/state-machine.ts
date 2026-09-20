import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteFileSync } from '../fs/atomic.js';

/** 单条视频流水线阶段（规格 §6 数据流） */
export const PIPELINE_STAGES = [
  'init', // 创建运行目录与 task.json
  'research', // 联网研究，产出来源包
  'codex_draft', // Codex 草稿
  'flash_challenge', // Flash 结构化挑战
  'codex_verdict', // Codex 读取复核意见后裁决
  'user_confirmation', // 人工闸门：文案与分镜
  'production', // TTS 与字幕、场景编译、预览/渲染
  'visual_review', // 自动检查与视觉复核
  'done', // 正式产物
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** 仅允许按顺序前进的迁移表 */
const FORWARD_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  init: ['research'],
  research: ['codex_draft'],
  codex_draft: ['flash_challenge'],
  flash_challenge: ['codex_verdict'],
  codex_verdict: ['user_confirmation'],
  user_confirmation: ['production'],
  production: ['visual_review'],
  visual_review: ['done'],
  done: [],
};

export function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

/**
 * 阶段状态机：前进必须按迁移表；允许回退到任意更早阶段（断点续跑/失败重跑）。
 * 状态以原子写持久化到 statePath。
 */
export class StateMachine {
  constructor(private readonly statePath: string) {}

  readStage(): PipelineStage {
    if (!existsSync(this.statePath)) return 'init';
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8')) as { stage?: unknown };
      if (typeof raw.stage === 'string' && isPipelineStage(raw.stage)) return raw.stage;
      return 'init';
    } catch {
      return 'init';
    }
  }

  /** 尝试迁移；非法前进返回 false，回退与合法前进返回 true 并原子写状态 */
  transition(next: PipelineStage): boolean {
    const current = this.readStage();
    if (!canTransition(current, next)) return false;
    atomicWriteFileSync(this.statePath, JSON.stringify({ stage: next, updatedAt: new Date().toISOString() }, null, 2));
    return true;
  }
}

export function canTransition(current: PipelineStage, next: PipelineStage): boolean {
  if (FORWARD_TRANSITIONS[current]?.includes(next)) return true;
  // 回退：允许回到任意更早阶段（断点续跑/失败重跑），但终态 done 不可回退
  if (current === 'done') return false;
  return PIPELINE_STAGES.indexOf(next) < PIPELINE_STAGES.indexOf(current);
}
