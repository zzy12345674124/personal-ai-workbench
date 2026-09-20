import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { VisualTheme } from '../data/scenes';
import { HighlightNumber, SceneBackground, SceneBadge, SceneBody, SceneTitle, StaggerIn, THEMES } from './shared';

export const WarningCard: React.FC<{ theme: VisualTheme; title: string; warnings: string[] }> = ({ theme, title, warnings }) => {
  const t = THEMES[theme];
  const warnColor = theme === 'data' ? t.warn : '#FAAD14';
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        <StaggerIn>
          <div style={{ width: 148, height: 148, borderRadius: '50%', background: t.cardBg, border: `3px solid ${warnColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 78, marginBottom: 30, boxShadow: `0 10px 50px ${t.glow}` }}>⚠️</div>
        </StaggerIn>
        <SceneTitle theme={theme}>{title}</SceneTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
          {warnings.map((w, i) => (
            <StaggerIn key={i} delay={10 + i * 7}>
              <div style={{ background: t.cardBg, border: `1.5px solid ${warnColor}55`, borderLeft: `6px solid ${warnColor}`, borderRadius: 22, padding: '28px 40px', fontSize: 38, fontWeight: 700, textAlign: 'left', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
                {w}
              </div>
            </StaggerIn>
          ))}
        </div>
      </SceneBody>
      <SceneBadge theme={theme} label="警示" />
    </SceneBackground>
  );
};

export const MetricsCard: React.FC<{ theme: VisualTheme; title?: string; metrics: { label: string; value: string }[] }> = ({ theme, title, metrics }) => {
  const frame = useCurrentFrame();
  const t = THEMES[theme];
  const icons = ['🎯', '📖', '📈'];
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        {title ? <SceneTitle theme={theme}>{title}</SceneTitle> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28, width: '90%' }}>
          {metrics.map((m, i) => {
            const target = (i + 1) * 32;
            const width = interpolate(frame, [16 + i * 8, 36 + i * 8], [0, target], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
            return (
              <StaggerIn key={i} delay={i * 7}>
                <div style={{ background: t.cardBg, border: `1.5px solid ${t.border}`, borderRadius: 24, padding: '28px 34px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 40, fontWeight: 800 }}>{icons[i]} {m.label}</div>
                    <div style={{ fontSize: 32, color: t.accent, fontWeight: 800 }}>{m.value}</div>
                  </div>
                  <div style={{ height: 20, background: 'rgba(148,163,184,0.2)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${width}%`, height: '100%', background: `linear-gradient(90deg, ${t.accent}, ${t.accent2})`, borderRadius: 999, boxShadow: `0 0 14px ${t.glow}` }} />
                  </div>
                </div>
              </StaggerIn>
            );
          })}
        </div>
        <div style={{ marginTop: 44, display: 'flex', gap: 40, alignItems: 'center' }}>
          <HighlightNumber theme={theme} value="3" label="评测维度" />
          <div style={{ fontSize: 32, color: t.muted }}>语言流畅 → 次要位置</div>
        </div>
      </SceneBody>
      <SceneBadge theme={theme} label="10 · 评测" />
    </SceneBackground>
  );
};

export const ChecklistCard: React.FC<{ theme: VisualTheme; title?: string; checklist: string[] }> = ({ theme, title, checklist }) => {
  const t = THEMES[theme];
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        {title ? <SceneTitle theme={theme}>{title}</SceneTitle> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, width: '100%' }}>
          {checklist.map((c, i) => (
            <StaggerIn key={i} delay={i * 6}>
              <div style={{ background: t.cardBg, border: `2px solid ${i % 2 === 0 ? t.accent : t.accent2}`, borderRadius: 24, padding: '34px 28px', fontSize: 36, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 10px 36px rgba(0,0,0,0.25)' }}>
                <span style={{ color: t.highlight, fontSize: 44 }}>✓</span>
                {c}
              </div>
            </StaggerIn>
          ))}
        </div>
        <div style={{ marginTop: 40, display: 'flex', gap: 36, alignItems: 'center' }}>
          <HighlightNumber theme={theme} value="4" label="触发场景" />
          <div style={{ fontSize: 30, color: t.muted }}>命中任一，都值得自建</div>
        </div>
      </SceneBody>
      <SceneBadge theme={theme} label="06 · 场景判断" />
    </SceneBackground>
  );
};
