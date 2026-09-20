// shotcraft/ShotcraftView.tsx —— 镜头卡场景渲染器（2026-08-11）
// storyboard type='shotcraft' + card 字段 → 映射到对应卡组件；未命中退回全黑占位。
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { AuroraBloomBgFlip } from './cards/AuroraBloomBgFlip';
import { Basic3DScene } from './cards/Basic3DScene';
import { BeforeAfterSliderScrub } from './cards/BeforeAfterSliderScrub';
import { BrandFrameSnap } from './cards/BrandFrameSnap';
import { CardStack } from './cards/CardStack';
import { Carousel3D } from './cards/Carousel3D';
import { CursorFlyover } from './cards/CursorFlyover';
import { DrawSvgTrace } from './cards/DrawSvgTrace';
import { Fracture } from './cards/Fracture';
import { GradientTransition } from './cards/GradientTransition';
import { GradientWordSweep } from './cards/GradientWordSweep';
import { LetterspaceMaterialize } from './cards/LetterspaceMaterialize';
import { MarkerUnderlineTitle } from './cards/MarkerUnderlineTitle';
import { MorphFromPrimitive } from './cards/MorphFromPrimitive';
import { NeonTripleMarquee } from './cards/NeonTripleMarquee';
import { OdometerDigitRoll } from './cards/OdometerDigitRoll';
import { RadialWave } from './cards/RadialWave';
import { ScanBracketSweep } from './cards/ScanBracketSweep';
import { SlowPushIn } from './cards/SlowPushIn';
import { SplitFlapFlip } from './cards/SplitFlapFlip';
import { SteepTiltGlide } from './cards/SteepTiltGlide';
import { StrokeSegmentBuild } from './cards/StrokeSegmentBuild';
import { SvgShapeMorph } from './cards/SvgShapeMorph';
import { TimelineTravel } from './cards/TimelineTravel';
import { TypewriterErrorRetype } from './cards/TypewriterErrorRetype';

const CARD_MAP: Record<string, React.FC> = {
  Fracture, LetterspaceMaterialize, StrokeSegmentBuild,
  Carousel3D, MorphFromPrimitive, SvgShapeMorph, RadialWave, CardStack, DrawSvgTrace,
  CursorFlyover, SteepTiltGlide, SlowPushIn, Basic3DScene,
  OdometerDigitRoll, TimelineTravel, BeforeAfterSliderScrub,
  SplitFlapFlip, GradientWordSweep, TypewriterErrorRetype, MarkerUnderlineTitle,
  AuroraBloomBgFlip, ScanBracketSweep, BrandFrameSnap,
  GradientTransition, NeonTripleMarquee,
};

export const ShotcraftView: React.FC<{ card?: string }> = ({ card }) => {
  const Comp = card ? CARD_MAP[card] : undefined;
  if (!Comp) {
    return <AbsoluteFill style={{ background: '#0b0c15' }} />; // 未命中：黑场（不崩链）
  }
  return (
    <AbsoluteFill style={{ background: '#0b0c15' }}>
      <Comp />
    </AbsoluteFill>
  );
};
