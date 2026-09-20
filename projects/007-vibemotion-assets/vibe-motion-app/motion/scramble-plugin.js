import { DEFAULT_SCRAMBLE_PROPS, SCRAMBLE_SCHEMA } from "./scramble-config.js";
import { ScrambleScene } from "./ScrambleScene.jsx";
import {
  buildScrambleSceneProps,
  getScrambleDurationInFrames,
  resolveScrambleSceneContext,
} from "./scramble-timeline.js";

export const scramblePlugin = Object.freeze({
  id: "scramble",
  defaultProps: DEFAULT_SCRAMBLE_PROPS,
  schema: SCRAMBLE_SCHEMA,
  SceneComponent: ScrambleScene,
  resolveSceneContext: (pluginParams) =>
    resolveScrambleSceneContext({
      ...DEFAULT_SCRAMBLE_PROPS,
      ...(pluginParams ?? {}),
    }),
  getDurationInFrames: ({ fps, sceneContext, pluginParams } = {}) => {
    const resolvedContext =
      sceneContext ??
      resolveScrambleSceneContext({
        ...DEFAULT_SCRAMBLE_PROPS,
        ...(pluginParams ?? {}),
      });

    return getScrambleDurationInFrames({
      fps,
      sceneContext: resolvedContext,
    });
  },
  buildSceneProps: ({ frame, fps, loop, sceneContext, pluginParams } = {}) => {
    const resolvedContext =
      sceneContext ??
      resolveScrambleSceneContext({
        ...DEFAULT_SCRAMBLE_PROPS,
        ...(pluginParams ?? {}),
      });

    return buildScrambleSceneProps({
      frame,
      fps,
      loop,
      sceneContext: resolvedContext,
    });
  },
  getLayout: ({ sceneContext, pluginParams } = {}) => {
    const resolvedContext =
      sceneContext ??
      resolveScrambleSceneContext({
        ...DEFAULT_SCRAMBLE_PROPS,
        ...(pluginParams ?? {}),
      });

    return resolvedContext.layout;
  },
});
