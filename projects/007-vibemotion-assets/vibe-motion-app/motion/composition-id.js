// 纯 JS 常量：默认 composition id。
// 单独成文件是因为 remotion-render.mjs 用 Node 原生 ESM 直接 import，
// 而 project.js -> plugin.js -> Scene.jsx 的链路上有 .jsx，Node 无法加载。
export const DEFAULT_COMPOSITION_ID = "Motion30fps";
