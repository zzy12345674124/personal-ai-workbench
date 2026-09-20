import { z } from "zod";

export const DEFAULT_SCRAMBLE_LAYOUT = Object.freeze({
  videoWidth: 1080,
  videoHeight: 1440,
});

// Remotion Studio Props 可视化表单的数据模式
export const SCRAMBLE_SCHEMA = z.object({
  videoWidth: z.number().min(480).max(1280),
  videoHeight: z.number().min(480).max(1440),
  texts: z.array(z.string()).min(1),
  chars: z.enum([
    "upperAndLowerCase",
    "upperCase",
    "lowerCase",
    "numbers",
    "XO",
    "alphaNumeric",
    "cjk",
  ]),
  segmentSeconds: z.number().min(0.5).max(15),
  revealSeconds: z.number().min(0.1).max(15),
  revealDelay: z.number().min(0).max(1),
  fontSize: z.number().min(16).max(200),
  textColor: z.string(),
  durationSeconds: z.number().min(1).max(30),
});

export const DEFAULT_SCRAMBLE_PARAMS = Object.freeze({
  texts: [
    "乱码文字效果演示：逐字揭示，完全由帧驱动。",
    "字符集可切换：中文字符、数字、大小写字母。",
    "确定性随机渲染：同一帧的结果永远一致。",
  ],
  chars: "cjk",
  segmentSeconds: 2.5,
  revealSeconds: 1.5,
  revealDelay: 0.25,
  fontSize: 72,
  textColor: "#000000",
  durationSeconds: 7.5,
});

export const DEFAULT_SCRAMBLE_PROPS = Object.freeze({
  ...DEFAULT_SCRAMBLE_LAYOUT,
  ...DEFAULT_SCRAMBLE_PARAMS,
});
