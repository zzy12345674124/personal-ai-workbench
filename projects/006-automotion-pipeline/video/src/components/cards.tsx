import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { VisualTheme } from '../data/scenes';
import { HighlightNumber, SceneBackground, SceneBadge, SceneBody, SceneTitle, StaggerIn, THEMES, VsBadge } from './shared';

const cardBase = (theme: VisualTheme, accent: string): React.CSSProperties => {
  const t = THEMES[theme];
  return {
    background: t.cardBg,
    border: `2px solid ${accent}`,
    borderRadius: 28,
    boxShadow: `0 14px 44px rgba(0,0,0,0.35)`,
  };
};

export const TitleCard: React.FC<{ theme: VisualTheme; title: string; subtitle?: string }> = ({ theme, title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = THEMES[theme];
  const opacity = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: 'clamp' });
  const scale = spring({ frame, fps, config: { damping: 12 } });
  const icons = ['🌐', '📄', '🔍'];
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        <div style={{ opacity, transform: `scale(${0.88 + scale * 0.12})`, textAlign: 'center' }}>
          <div style={{ fontSize: 116, fontWeight: 900, lineHeight: 1.2, textShadow: `0 6px 50px ${t.glow}` }}>{title}</div>
          <div style={{ display: 'flex', gap: 36, justifyContent: 'center', marginTop: 64 }}>
            {icons.map((ic, i) => (
              <StaggerIn key={i} delay={8 + i * 7}>
                <div style={{ ...cardBase(theme, i === 0 ? t.accent2 : t.accent), width: 128, height: 128, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 62 }}>
                  {ic}
                </div>
              </StaggerIn>
            ))}
          </div>
          {subtitle ? (
            <div style={{ fontSize: 50, fontWeight: 700, marginTop: 64, color: t.accent, textShadow: `0 0 40px ${t.glow}` }}>{subtitle}</div>
          ) : null}
        </div>
      </SceneBody>
      <SceneBadge theme={theme} label="01 · 开场" />
    </SceneBackground>
  );
};

export const ContrastCard: React.FC<{
  theme: VisualTheme;
  leftTitle: string;
  leftDesc: string;
  rightTitle: string;
  rightDesc: string;
}> = ({ theme, leftTitle, leftDesc, rightTitle, rightDesc }) => {
  const t = THEMES[theme];
  const side = (icon: string, title: string, desc: string, accent: string) => (
    <div style={{ flex: 1, background: t.cardBg, border: `2px solid ${accent}`, borderRadius: 30, padding: '44px 34px', textAlign: 'center', boxShadow: '0 14px 44px rgba(0,0,0,0.3)' }}>
      <div style={{ fontSize: 84, marginBottom: 18 }}>{icon}</div>
      <div style={{ fontSize: 60, fontWeight: 900, color: accent, textShadow: `0 4px 30px ${t.glow}` }}>{title}</div>
      {/* 2026-08-07 视觉迭代：textWrap pretty 消除段落孤行；fontWeight 500 让灰字在浅底上不显单薄（MiMo 复检） */}
      <div style={{ fontSize: 36, lineHeight: 1.5, marginTop: 24, color: t.muted, textWrap: 'pretty', fontWeight: 500 }}>{desc}</div>
    </div>
  );
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        <StaggerIn>
          <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
            {/* 2026-08-07 视觉迭代：paper 白底卡片上 #8a8a8a 对比度仅 2.9:1，改正文色 #1A1A1A（MiMo 诊断 ③） */}
            {side('📝', leftTitle, leftDesc, theme === 'paper' ? t.text : '#94A3B8')}
            <VsBadge theme={theme} />
            {side('📚', rightTitle, rightDesc, t.accent)}
          </div>
        </StaggerIn>
      </SceneBody>
      <SceneBadge theme={theme} label={theme === 'paper' ? '05 · 内置 vs 自建' : '02 · 开卷考试'} />
    </SceneBackground>
  );
};

export const CardsRow: React.FC<{ theme: VisualTheme; title?: string; cards: { label: string; desc: string }[] }> = ({ theme, title, cards }) => {
  const t = THEMES[theme];
  const icons = ['🧠', '🌐', '🗂️'];
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        {title ? <SceneTitle theme={theme}>{title}</SceneTitle> : null}
        <div style={{ display: 'flex', gap: 26, width: '100%' }}>
          {cards.map((c, i) => (
            <StaggerIn key={i} delay={i * 7}>
              <div style={{ ...cardBase(theme, i === 0 ? t.accent2 : t.accent), flex: 1, padding: '46px 22px', textAlign: 'center' }}>
                <div style={{ fontSize: 70, marginBottom: 20 }}>{icons[i] ?? '✨'}</div>
                <div style={{ fontSize: 42, fontWeight: 800 }}>{c.label}</div>
                <div style={{ fontSize: 30, marginTop: 14, color: t.muted, lineHeight: 1.45, fontWeight: 500 }}>{c.desc}</div>
              </div>
            </StaggerIn>
          ))}
        </div>
        <div style={{ marginTop: 52, display: 'flex', alignItems: 'center', gap: 16 }}>
          <HighlightNumber theme={theme} value="3" label="能力卡片" />
          <div style={{ fontSize: 34, color: t.muted }}>→ 自建 RAG 缩小了，但没消失</div>
        </div>
      </SceneBody>
      <SceneBadge theme={theme} label="03 · 能力对比" />
    </SceneBackground>
  );
};
