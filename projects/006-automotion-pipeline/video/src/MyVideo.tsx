import React from 'react';
import { Audio, interpolate, Sequence, staticFile, useCurrentFrame, Video } from 'remotion';
import { audio, scenes, subtitles, templateConfig, totalFrames } from './generated/data';
import { CardsRow, ContrastCard, TitleCard } from './components/cards';
import { DecisionTree, FlowSteps, LadderCard } from './components/diagrams';
import { ChecklistCard, MetricsCard, WarningCard } from './components/indicators';
import { ProgressBar } from './components/shared';
import { VideoShell } from './components/video-shell';
import { ShotcraftView } from './shotcraft/ShotcraftView';
import type { CompiledScene } from './data/scenes';
import { normalizeTemplateConfig } from './template-config';

export const TOTAL_FRAMES = totalFrames;

const FADE_IN = 5; // 快切：0.17s 淡入（视觉风格规范 §4：接近硬切）
const FADE_OUT = 5; // 0.17s 淡出

/** 素材视频场景（2026-08-08 多模态第二阶段）：场景带 kind=video 的 media → 编辑区播放素材演示视频
 *  （prepare-video-assets 已把素材库 demo.mp4 复制到 staticFile materials/，等比 contain 居中，循环） */
const VideoMedia: React.FC<{ scene: CompiledScene }> = ({ scene }) => {
  const v = scene.media?.find((m) => m.kind === 'video' && m.src);
  if (!v) return null;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B0C15' }}>
      <Video src={staticFile(`materials/${v.src}.mp4`)} loop style={{ maxWidth: '100%', maxHeight: '100%' }} />
    </div>
  );
};

const SceneView: React.FC<{ scene: CompiledScene }> = ({ scene }) => {
  const theme = scene.theme;
  // 素材视频优先于文本组件渲染（media 由 008 场景草稿确定性注入，覆盖型）
  if (scene.media?.some((m) => m.kind === 'video')) return <VideoMedia scene={scene} />;
  switch (scene.type) {
    case 'title':
      return <TitleCard theme={theme} title={scene.title ?? ''} subtitle={scene.subtitle} />;
    case 'contrast':
      return (
        <ContrastCard
          theme={theme}
          leftTitle={scene.leftTitle ?? ''}
          leftDesc={scene.leftDesc ?? ''}
          rightTitle={scene.rightTitle ?? ''}
          rightDesc={scene.rightDesc ?? ''}
        />
      );
    case 'cards':
      return <CardsRow theme={theme} title={scene.title} cards={scene.cards ?? []} />;
    case 'decision':
      return <DecisionTree theme={theme} title={scene.title} branches={scene.branches ?? []} />;
    case 'flow':
      return <FlowSteps theme={theme} title={scene.title} steps={scene.steps ?? []} />;
    case 'warning':
      return <WarningCard theme={theme} title={scene.title ?? ''} warnings={scene.warnings ?? []} />;
    case 'metrics':
      return <MetricsCard theme={theme} title={scene.title} metrics={scene.metrics ?? []} />;
    case 'checklist':
      return <ChecklistCard theme={theme} title={scene.title} checklist={scene.checklist ?? []} />;
    case 'ladder':
      return <LadderCard theme={theme} title={scene.title} levels={scene.levels ?? []} />;
    // 2026-08-11：shotcraft 镜头卡场景——card 字段选卡（未命中退回黑场）
    case 'shotcraft':
      return <ShotcraftView card={scene.card} />;
  }
};

/** 场景级快切（短淡入淡出，接近硬切的翻篇感） */
const SceneFade: React.FC<{ duration: number; children: React.ReactNode }> = ({ duration, children }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, FADE_IN], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [duration - FADE_OUT, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <div style={{ opacity: Math.min(fadeIn, fadeOut) }}>{children}</div>;
};

const Subtitles: React.FC<{ shellType: 'vscode' | 'wechat' | 'claude' }> = ({ shellType }) => {
  const frame = useCurrentFrame();
  const line = subtitles.find(
    (l) => frame >= Math.round(l.startSeconds * 30) && frame < Math.round(l.endSeconds * 30),
  );
  if (!line) return null;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: shellType === 'vscode' ? 200 : 150,
        left: shellType === 'vscode' ? 380 : shellType === 'claude' ? 220 : 130,
        right: 90,
        textAlign: 'center',
        fontSize: 38,
        lineHeight: 1.4,
        background: 'rgba(2,6,23,0.8)',
        border: '1px solid rgba(148,163,184,0.4)',
        borderRadius: 20,
        padding: '18px 26px',
        color: '#f8fafc',
        fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
      }}
    >
      {line.text}
    </div>
  );
};

/** 底部进度条：主题随当前场景切换（段落换肤时进度条同步变色） */
const ThemedProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const current = [...scenes].reverse().find((s) => frame >= s.fromFrame);
  const theme = current?.theme ?? 'tech';
  return <ProgressBar theme={theme} total={totalFrames} />;
};

export const MyVideo: React.FC = () => {
  const resolvedTemplateConfig = normalizeTemplateConfig(templateConfig);
  return (
    <div style={{ width: '100%', height: '100%', background: '#0B0C15' }}>
      <VideoShell config={resolvedTemplateConfig}>
        {scenes.map((s, i) => {
          const sceneAudio = audio[i];
          return (
            <Sequence key={s.index} from={s.fromFrame} durationInFrames={s.toFrame - s.fromFrame}>
              <SceneFade duration={s.toFrame - s.fromFrame}>
                <SceneView scene={s} />
              </SceneFade>
              {sceneAudio ? <Audio src={staticFile(`audio/${sceneAudio.src}`)} /> : null}
            </Sequence>
          );
        })}
      </VideoShell>
      <Subtitles shellType={resolvedTemplateConfig.shellType} />
      <ThemedProgressBar />
    </div>
  );
};
