import { DEFAULT_BROWSER_COMPARE_PROPS } from "./browser-compare-config.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const toInt = (value, fallback, min, max) =>
  Math.round(clamp(toNumber(value, fallback), min, max));
const toPositiveFrames = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.round(parsed));
};
const toText = (value, fallback) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

export const resolveBrowserCompareSceneContext = (pluginParams = {}) => {
  const videoWidth = toInt(
    pluginParams.videoWidth,
    DEFAULT_BROWSER_COMPARE_PROPS.videoWidth,
    480,
    1280
  );
  const videoHeight = toInt(
    pluginParams.videoHeight,
    DEFAULT_BROWSER_COMPARE_PROPS.videoHeight,
    480,
    1440
  );

  return {
    actSeconds: clamp(
      toNumber(pluginParams.actSeconds, DEFAULT_BROWSER_COMPARE_PROPS.actSeconds),
      1,
      10
    ),
    folderCount: toInt(
      pluginParams.folderCount,
      DEFAULT_BROWSER_COMPARE_PROPS.folderCount,
      2,
      8
    ),
    act1Title: toText(
      pluginParams.act1Title,
      DEFAULT_BROWSER_COMPARE_PROPS.act1Title
    ),
    act1Caption: toText(
      pluginParams.act1Caption,
      DEFAULT_BROWSER_COMPARE_PROPS.act1Caption
    ),
    act2Title: toText(
      pluginParams.act2Title,
      DEFAULT_BROWSER_COMPARE_PROPS.act2Title
    ),
    act2Caption: toText(
      pluginParams.act2Caption,
      DEFAULT_BROWSER_COMPARE_PROPS.act2Caption
    ),
    transition: toText(pluginParams.transition, "cut").toLowerCase() === "fade" ? "fade" : "cut",
    chromeGlow: pluginParams.chromeGlow !== false,
    layout: {
      videoWidth,
      videoHeight,
    },
  };
};

export const getBrowserCompareDurationInFrames = ({
  fps,
  sceneContext,
  pluginParams,
} = {}) => {
  const resolvedContext =
    sceneContext ?? resolveBrowserCompareSceneContext(pluginParams ?? {});
  const resolvedFps = toPositiveFrames(fps, 30);
  // 总时长 = 两幕之和
  return toPositiveFrames(
    resolvedContext.actSeconds * 2 * resolvedFps,
    resolvedFps
  );
};

export const buildBrowserCompareSceneProps = ({
  frame = 0,
  fps,
  loop = false,
  sceneContext,
  pluginParams,
} = {}) => {
  const resolvedContext =
    sceneContext ?? resolveBrowserCompareSceneContext(pluginParams ?? {});
  const durationInFrames = getBrowserCompareDurationInFrames({
    fps,
    sceneContext: resolvedContext,
  });

  const rawFrame = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
  const boundedFrame = loop
    ? rawFrame % durationInFrames
    : Math.min(rawFrame, durationInFrames - 1);

  const actFrames = Math.max(
    1,
    Math.round(resolvedContext.actSeconds * fps)
  );
  const act = boundedFrame < actFrames ? 1 : 2;
  const actFrame = boundedFrame - (act - 1) * actFrames;

  return {
    ...resolvedContext,
    durationInFrames,
    act,
    actFrame,
    actFrames,
    frame: boundedFrame,
    fps,
  };
};
