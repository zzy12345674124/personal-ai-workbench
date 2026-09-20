import {
  BROWSER_COMPARE_SCHEMA,
  DEFAULT_BROWSER_COMPARE_PROPS,
} from "./browser-compare-config.js";
import { BrowserCompareScene } from "./BrowserCompareScene.jsx";
import {
  buildBrowserCompareSceneProps,
  getBrowserCompareDurationInFrames,
  resolveBrowserCompareSceneContext,
} from "./browser-compare-timeline.js";

export const browserComparePlugin = Object.freeze({
  id: "browser-compare",
  defaultProps: DEFAULT_BROWSER_COMPARE_PROPS,
  schema: BROWSER_COMPARE_SCHEMA,
  SceneComponent: BrowserCompareScene,
  resolveSceneContext: (pluginParams) =>
    resolveBrowserCompareSceneContext({
      ...DEFAULT_BROWSER_COMPARE_PROPS,
      ...(pluginParams ?? {}),
    }),
  getDurationInFrames: ({ fps, sceneContext, pluginParams } = {}) => {
    const resolvedContext =
      sceneContext ??
      resolveBrowserCompareSceneContext({
        ...DEFAULT_BROWSER_COMPARE_PROPS,
        ...(pluginParams ?? {}),
      });

    return getBrowserCompareDurationInFrames({
      fps,
      sceneContext: resolvedContext,
    });
  },
  buildSceneProps: ({ frame, fps, loop, sceneContext, pluginParams } = {}) => {
    const resolvedContext =
      sceneContext ??
      resolveBrowserCompareSceneContext({
        ...DEFAULT_BROWSER_COMPARE_PROPS,
        ...(pluginParams ?? {}),
      });

    return buildBrowserCompareSceneProps({
      frame,
      fps,
      loop,
      sceneContext: resolvedContext,
    });
  },
  getLayout: ({ sceneContext, pluginParams } = {}) => {
    const resolvedContext =
      sceneContext ??
      resolveBrowserCompareSceneContext({
        ...DEFAULT_BROWSER_COMPARE_PROPS,
        ...(pluginParams ?? {}),
      });

    return resolvedContext.layout;
  },
});
