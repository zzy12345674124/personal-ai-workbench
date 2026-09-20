import { z } from "zod";

export const DEFAULT_BROWSER_COMPARE_LAYOUT = Object.freeze({
  videoWidth: 1080,
  videoHeight: 1440,
});

// Remotion Studio Props 可视化表单的数据模式
export const BROWSER_COMPARE_SCHEMA = z.object({
  videoWidth: z.number().min(480).max(1280),
  videoHeight: z.number().min(480).max(1440),
  actSeconds: z.number().min(1).max(10),
  folderCount: z.number().int().min(2).max(8),
  act1Title: z.string(),
  act1Caption: z.string(),
  act2Title: z.string(),
  act2Caption: z.string(),
  transition: z.enum(["cut", "fade"]),
  chromeGlow: z.boolean(),
});

export const DEFAULT_BROWSER_COMPARE_PARAMS = Object.freeze({
  // 每幕时长（秒）；总时长 = 两幕之和
  actSeconds: 4,
  folderCount: 4,
  act1Title: "REMOTION",
  act1Caption: "每个项目各自下载一个无头浏览器",
  act2Title: "VIBE MOTION",
  act2Caption: "全局共享同一个无头浏览器",
  // 两幕之间的转场："cut" = 硬切；"fade" = 渐入渐出（整幅画面淡出再淡入）
  transition: "cut",
  chromeGlow: true,
});

export const DEFAULT_BROWSER_COMPARE_PROPS = Object.freeze({
  ...DEFAULT_BROWSER_COMPARE_LAYOUT,
  ...DEFAULT_BROWSER_COMPARE_PARAMS,
});
