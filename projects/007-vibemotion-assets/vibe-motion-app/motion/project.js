import { motionPlugin } from "./plugin.js";
import { scramblePlugin } from "./scramble-plugin.js";
import { browserComparePlugin } from "./browser-compare-plugin.js";

export const ACTIVE_COMPOSITIONS = Object.freeze([
  Object.freeze({
    id: "Motion30fps",
    fps: 30,
    plugin: motionPlugin,
  }),
  Object.freeze({
    id: "ScrambleText30fps",
    fps: 30,
    plugin: scramblePlugin,
  }),
  Object.freeze({
    id: "BrowserCompare30fps",
    fps: 30,
    plugin: browserComparePlugin,
  }),
]);

// 默认 composition 保留为第一个，渲染脚本（remotion-render.mjs）沿用此约定
export const ACTIVE_COMPOSITION = ACTIVE_COMPOSITIONS[0];

export const ACTIVE_COMPOSITION_ID = ACTIVE_COMPOSITION.id;
