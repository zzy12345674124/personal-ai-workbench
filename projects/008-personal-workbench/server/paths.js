// server/paths.js —— 路径常量与桥接目标可用性探测
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PROJECT_ROOT = join(import.meta.dirname, '..');
export const WEB_DIR = join(PROJECT_ROOT, 'web');
export const RUNS_DIR = join(PROJECT_ROOT, 'runs');
export const ASSET_VERSIONS_DIR = join(PROJECT_ROOT, 'asset-versions');
// 运行期临时状态（草稿等）；已加入 .gitignore；文件不存在是正常状态
export const RUNTIME_DIR = join(PROJECT_ROOT, 'runtime');

// 跨项目引用（可被环境变量覆盖，便于测试）
export const VIBE_ASSETS_DIR =
  process.env.VIBE_ASSETS_DIR ?? join(PROJECT_ROOT, '..', 'project_007_VibeMotion联动', '工作台素材');
export const AUTOMOTION_DIR =
  process.env.AUTOMOTION_DIR ?? join(PROJECT_ROOT, '..', 'project_006_个人Harness与AutoMotion');
export const CLAUDE_DIR =
  process.env.CLAUDE_DIR ?? join(homedir(), '.claude');

export function probeAvailability() {
  return {
    assetsDir: existsSync(VIBE_ASSETS_DIR),
    autoMotionDir: existsSync(AUTOMOTION_DIR),
    claudeDir: existsSync(CLAUDE_DIR),
  };
}
