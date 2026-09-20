// shotcraft/index.ts —— video-shotcraft 精选卡移植（横屏 480×270 设计坐标 → 1920×1080 等比放大）
// 来源：vendor/video-shotcraft（Apache-2.0，demos/ 配方卡 + _fixtures 工具），2026-08-11 移植
// 每卡 = 确定性 Remotion 组件；useT 归一化进度驱动（与 006 SceneView 同构）。
// 25 卡：opening 3 + ui-entrance 5 + camera 4 + data 3 + typography 4 + effects 3 + transition 2 + outro 1。
export { AuroraBloomBgFlip, AURORA_BLOOM_BG_FLIP_DURATION } from './cards/AuroraBloomBgFlip';
export { Basic3DScene, BASIC_3D_SCENE_DURATION } from './cards/Basic3DScene';
export { BeforeAfterSliderScrub } from './cards/BeforeAfterSliderScrub';
export { BrandFrameSnap } from './cards/BrandFrameSnap';
export { CardStack, CARD_STACK_DURATION } from './cards/CardStack';
export { Carousel3D, CAROUSEL_3D_DURATION } from './cards/Carousel3D';
export { CursorFlyover, CURSOR_FLYOVER_DURATION } from './cards/CursorFlyover';
export { DrawSvgTrace } from './cards/DrawSvgTrace';
export { Fracture, FRACTURE_DURATION } from './cards/Fracture';
export { GradientTransition, GRADIENT_TRANSITION_DURATION } from './cards/GradientTransition';
export { GradientWordSweep } from './cards/GradientWordSweep';
export { LetterspaceMaterialize } from './cards/LetterspaceMaterialize';
export { MarkerUnderlineTitle } from './cards/MarkerUnderlineTitle';
export { MorphFromPrimitive } from './cards/MorphFromPrimitive';
export { NeonTripleMarquee } from './cards/NeonTripleMarquee';
export { OdometerDigitRoll } from './cards/OdometerDigitRoll';
export { RadialWave, RADIAL_WAVE_DURATION } from './cards/RadialWave';
export { ScanBracketSweep, SCAN_BRACKET_SWEEP_DURATION } from './cards/ScanBracketSweep';
export { SlowPushIn } from './cards/SlowPushIn';
export { SplitFlapFlip } from './cards/SplitFlapFlip';
export { SteepTiltGlide } from './cards/SteepTiltGlide';
export { StrokeSegmentBuild } from './cards/StrokeSegmentBuild';
export { SvgShapeMorph, SVG_SHAPE_MORPH_DURATION } from './cards/SvgShapeMorph';
export { TimelineTravel } from './cards/TimelineTravel';
export { TypewriterErrorRetype } from './cards/TypewriterErrorRetype';
