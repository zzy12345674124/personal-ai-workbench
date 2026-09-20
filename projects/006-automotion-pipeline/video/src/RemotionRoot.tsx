import React from 'react';
import { Composition } from 'remotion';
import { MyVideo, TOTAL_FRAMES } from './MyVideo';
import { DEMO_IDE_SPEC, IdeScene } from './components/ide';
import { TEMPLATE_PREVIEW_DEFAULTS, TemplatePreview, templatePreviewSchema } from './TemplatePreview';
// 2026-08-11 video-shotcraft 精选卡（横屏 1920×1080，设计坐标 480×270 等比放大；25 卡）
import {
  AuroraBloomBgFlip, AURORA_BLOOM_BG_FLIP_DURATION,
  Basic3DScene, BASIC_3D_SCENE_DURATION,
  BeforeAfterSliderScrub,
  BrandFrameSnap,
  CardStack, CARD_STACK_DURATION,
  Carousel3D, CAROUSEL_3D_DURATION,
  CursorFlyover, CURSOR_FLYOVER_DURATION,
  DrawSvgTrace,
  Fracture, FRACTURE_DURATION,
  GradientTransition, GRADIENT_TRANSITION_DURATION,
  GradientWordSweep,
  LetterspaceMaterialize,
  MarkerUnderlineTitle,
  MorphFromPrimitive,
  NeonTripleMarquee,
  OdometerDigitRoll,
  RadialWave, RADIAL_WAVE_DURATION,
  ScanBracketSweep, SCAN_BRACKET_SWEEP_DURATION,
  SlowPushIn,
  SplitFlapFlip,
  SteepTiltGlide,
  StrokeSegmentBuild,
  SvgShapeMorph, SVG_SHAPE_MORPH_DURATION,
  TimelineTravel,
  TypewriterErrorRetype,
} from './shotcraft';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="rag-video"
        component={MyVideo}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1080}
        height={1920}
      />
      {/* 原型验证用：VS Code 风格界面组件 */}
      <Composition
        id="ide-preview"
        component={() => <IdeScene spec={DEMO_IDE_SPEC} />}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
      />
      {/* 008 模板实时预览最小验证：独立 Composition，不接正式生产链。
          旧测试值（对下时间/#cc0067/88）不自动迁移——88 对正式顶部标题无效（任务书 §3）；改回默认内联对象。 */}
      {/* 2026-08-11 video-shotcraft 精选 25 卡（1920×1080 横屏；480×270 设计坐标等比放大；无 DURATION 常量的卡统一 150 帧） */}
      <Composition id="shotcraft-aurora-bloom-bg-flip" component={AuroraBloomBgFlip} durationInFrames={AURORA_BLOOM_BG_FLIP_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-basic-3d-scene" component={Basic3DScene} durationInFrames={BASIC_3D_SCENE_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-before-after-slider-scrub" component={BeforeAfterSliderScrub} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-brand-frame-snap" component={BrandFrameSnap} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-card-stack" component={CardStack} durationInFrames={CARD_STACK_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-carousel-3d" component={Carousel3D} durationInFrames={CAROUSEL_3D_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-cursor-flyover" component={CursorFlyover} durationInFrames={CURSOR_FLYOVER_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-draw-svg-trace" component={DrawSvgTrace} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-fracture" component={Fracture} durationInFrames={FRACTURE_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-gradient-transition" component={GradientTransition} durationInFrames={GRADIENT_TRANSITION_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-gradient-word-sweep" component={GradientWordSweep} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-letterspace-materialize" component={LetterspaceMaterialize} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-marker-underline-title" component={MarkerUnderlineTitle} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-morph-from-primitive" component={MorphFromPrimitive} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-neon-triple-marquee" component={NeonTripleMarquee} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-odometer-digit-roll" component={OdometerDigitRoll} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-radial-wave" component={RadialWave} durationInFrames={RADIAL_WAVE_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-scan-bracket-sweep" component={ScanBracketSweep} durationInFrames={SCAN_BRACKET_SWEEP_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-slow-push-in" component={SlowPushIn} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-split-flap-flip" component={SplitFlapFlip} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-steep-tilt-glide" component={SteepTiltGlide} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-stroke-segment-build" component={StrokeSegmentBuild} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-svg-shape-morph" component={SvgShapeMorph} durationInFrames={SVG_SHAPE_MORPH_DURATION} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-timeline-travel" component={TimelineTravel} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition id="shotcraft-typewriter-error-retype" component={TypewriterErrorRetype} durationInFrames={150} fps={30} width={1920} height={1080} />
      <Composition
        id="template-realtime-preview"
        component={TemplatePreview}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={TEMPLATE_PREVIEW_DEFAULTS}
        schema={templatePreviewSchema}
      />
    </>
  );
};
