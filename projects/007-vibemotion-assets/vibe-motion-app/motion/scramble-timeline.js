import { DEFAULT_SCRAMBLE_PROPS } from "./scramble-config.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
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

const toFrame = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
};

const toTextList = (value, fallback) => {
  if (!Array.isArray(value) || value.length === 0) {
    return fallback;
  }
  const resolved = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return resolved.length > 0 ? resolved : fallback;
};

const toText = (value, fallback) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const resolved = value.trim();
  return resolved.length > 0 ? resolved : fallback;
};

export const resolveScrambleSceneContext = (pluginParams = {}) => {
  const videoWidth = toInt(
    pluginParams.videoWidth,
    DEFAULT_SCRAMBLE_PROPS.videoWidth,
    480,
    1280
  );
  const videoHeight = toInt(
    pluginParams.videoHeight,
    DEFAULT_SCRAMBLE_PROPS.videoHeight,
    480,
    1440
  );
  const texts = toTextList(pluginParams.texts, DEFAULT_SCRAMBLE_PROPS.texts);
  const segmentSeconds = clamp(
    toNumber(pluginParams.segmentSeconds, DEFAULT_SCRAMBLE_PROPS.segmentSeconds),
    0.5,
    15
  );
  const revealSeconds = clamp(
    toNumber(pluginParams.revealSeconds, DEFAULT_SCRAMBLE_PROPS.revealSeconds),
    0.1,
    segmentSeconds
  );
  const revealDelay = clamp(
    toNumber(pluginParams.revealDelay, DEFAULT_SCRAMBLE_PROPS.revealDelay),
    0,
    1
  );
  const defaultDuration = texts.length * segmentSeconds;
  const durationSeconds = clamp(
    toNumber(pluginParams.durationSeconds, defaultDuration),
    1,
    30
  );

  return {
    texts,
    chars: toText(pluginParams.chars, DEFAULT_SCRAMBLE_PROPS.chars),
    segmentSeconds,
    revealSeconds,
    revealDelay,
    fontSize: toInt(pluginParams.fontSize, DEFAULT_SCRAMBLE_PROPS.fontSize, 16, 200),
    textColor: toText(pluginParams.textColor, DEFAULT_SCRAMBLE_PROPS.textColor),
    durationSeconds,
    layout: {
      videoWidth,
      videoHeight,
    },
  };
};

export const getScrambleDurationInFrames = ({ fps, sceneContext, pluginParams } = {}) => {
  const resolvedContext =
    sceneContext ?? resolveScrambleSceneContext(pluginParams ?? {});
  const resolvedFps = toPositiveFrames(fps, 30);
  return toPositiveFrames(resolvedContext.durationSeconds * resolvedFps, resolvedFps);
};

export const buildScrambleSceneProps = ({
  frame = 0,
  fps,
  loop = false,
  sceneContext,
  pluginParams,
} = {}) => {
  const resolvedContext =
    sceneContext ?? resolveScrambleSceneContext(pluginParams ?? {});
  const durationInFrames = getScrambleDurationInFrames({
    fps,
    sceneContext: resolvedContext,
  });

  const rawFrame = toFrame(frame, 0);
  const boundedFrame = loop
    ? rawFrame % durationInFrames
    : Math.min(rawFrame, durationInFrames - 1);
  const segmentFrames = Math.max(
    1,
    Math.round(resolvedContext.segmentSeconds * fps)
  );
  const segmentIndex = Math.min(
    Math.floor(boundedFrame / segmentFrames),
    resolvedContext.texts.length - 1
  );
  const segmentFrame = boundedFrame - segmentIndex * segmentFrames;
  const segmentProgress =
    segmentFrames <= 1 ? 0 : segmentFrame / (segmentFrames - 1);

  return {
    ...resolvedContext,
    durationInFrames,
    frame: boundedFrame,
    segmentIndex,
    segmentFrame,
    segmentProgress,
    fps,
  };
};
