import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_COMPOSITION_ID } from "../motion/composition-id.js";
import { ensureSharedBrowserExecutable, runLocalRemotionCli } from "./remotion-browser-executable.mjs";

const DEFAULT_CODEC = "prores";
const DEFAULT_PRORES_PROFILE = "4444";
const DEFAULT_IMAGE_FORMAT = "png";
const DEFAULT_SCALE = "1";

const compositionId = (
  process.env.REMOTION_COMPOSITION_ID || DEFAULT_COMPOSITION_ID
).trim();
const fps = (process.env.REMOTION_FPS || "").trim();
const outputPath = (
  process.env.REMOTION_OUTPUT || `out/${compositionId}-transparent.mov`
).trim();
const codec = (process.env.REMOTION_CODEC || DEFAULT_CODEC).trim();
const isProRes = codec === "prores";
const proresProfile = (
  process.env.REMOTION_PRORES_PROFILE || DEFAULT_PRORES_PROFILE
).trim();
// prores 默认带透明通道；其他编码（h264 等）默认 yuv420p
const pixelFormat = (
  process.env.REMOTION_PIXEL_FORMAT ||
  (isProRes ? "yuva444p10le" : "yuv420p")
).trim();
const imageFormat = (
  process.env.REMOTION_IMAGE_FORMAT || DEFAULT_IMAGE_FORMAT
).trim();
const scale = (process.env.REMOTION_SCALE || DEFAULT_SCALE).trim();
const propsJson = process.env.REMOTION_PROPS_JSON;
const propsFilePath = process.env.REMOTION_PROPS_FILE;

const resolvePropsJson = () => {
  if (typeof propsJson === "string" && propsJson.trim().length > 0) {
    return propsJson.trim();
  }

  if (typeof propsFilePath !== "string" || propsFilePath.trim().length === 0) {
    return "";
  }

  const absolutePropsFilePath = resolve(process.cwd(), propsFilePath.trim());
  const fileContent = readFileSync(absolutePropsFilePath, "utf8");
  const parsed = JSON.parse(fileContent);
  return JSON.stringify(parsed);
};

const run = async () => {
  const resolvedPropsJson = resolvePropsJson();
  const fpsForLog = fps.length > 0 ? fps : "composition-default";
  const browserExecutable = await ensureSharedBrowserExecutable({
    logPrefix: "[Remotion][Browser]",
  });

  const args = [
    "render",
    compositionId,
    outputPath,
    "--codec",
    codec,
    "--pixel-format",
    pixelFormat,
    "--image-format",
    imageFormat,
    "--scale",
    scale,
  ];

  if (isProRes) {
    args.push("--prores-profile", proresProfile);
  }

  if (fps.length > 0) {
    args.push("--fps", fps);
  }

  if (resolvedPropsJson.length > 0) {
    args.push("--props", resolvedPropsJson);
  }

  if (browserExecutable) {
    args.push("--browser-executable", browserExecutable);
  }

  const env = browserExecutable
    ? { ...process.env, REMOTION_BROWSER_EXECUTABLE: browserExecutable }
    : process.env;

  console.log(
    `[Remotion] render ${compositionId} -> ${outputPath} (fps=${fpsForLog}, codec=${codec})`
  );
  if (browserExecutable) {
    console.log(`[Remotion] browserExecutable=${browserExecutable}`);
  }

  const result = runLocalRemotionCli({
    args,
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[Remotion] failed to run render: ${result.error.message}`);
    process.exit(1);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Remotion] ${message}`);
  process.exit(1);
});
