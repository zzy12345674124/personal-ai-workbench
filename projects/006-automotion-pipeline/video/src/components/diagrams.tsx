import React from 'react';
import type { VisualTheme } from '../data/scenes';
import { HighlightNumber, SceneBackground, SceneBadge, SceneBody, SceneTitle, StaggerIn, THEMES } from './shared';

const cardBase = (theme: VisualTheme, accent: string): React.CSSProperties => {
  const t = THEMES[theme];
  return {
    background: t.cardBg,
    border: `2px solid ${accent}`,
    borderRadius: 28,
    boxShadow: `0 14px 44px rgba(0,0,0,0.3)`,
  };
};

export const DecisionTree: React.FC<{ theme: VisualTheme; title?: string; branches: { label: string; desc: string }[] }> = ({ theme, title, branches }) => {
  const t = THEMES[theme];
  const icons = ['🔍', '📁'];
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        {title ? <SceneTitle theme={theme}>{title}</SceneTitle> : null}
        <StaggerIn>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, width: '100%' }}>
            <div style={{ ...cardBase(theme, t.accent), fontSize: 52, fontWeight: 800, padding: '22px 56px', borderRadius: 999, textAlign: 'center' }}>
              资料怎么处理？
            </div>
            <div style={{ width: 4, height: 48, background: t.accent }} />
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: t.accent, boxShadow: `0 0 24px ${t.glow}` }} />
            <div style={{ display: 'flex', gap: 30, width: '100%' }}>
              {branches.map((b, i) => (
                <StaggerIn key={i} delay={10 + i * 7}>
                  <div style={{ ...cardBase(theme, i === 0 ? t.accent : t.accent2), flex: 1, padding: '40px 26px', textAlign: 'center' }}>
                    <div style={{ fontSize: 66, marginBottom: 18 }}>{icons[i]}</div>
                    <div style={{ fontSize: 42, fontWeight: 800 }}>{b.label}</div>
                    <div style={{ fontSize: 30, marginTop: 14, color: t.muted, lineHeight: 1.5 }}>{b.desc}</div>
                  </div>
                </StaggerIn>
              ))}
            </div>
            <div style={{ fontSize: 30, color: t.muted }}>⚠ 权限合规是前提</div>
          </div>
        </StaggerIn>
      </SceneBody>
      <SceneBadge theme={theme} label="04 · 决策树" />
    </SceneBackground>
  );
};

export const FlowSteps: React.FC<{ theme: VisualTheme; title?: string; steps: string[] }> = ({ theme, title, steps }) => {
  const t = THEMES[theme];
  const icons = ['🎯', '⚡', '🔖'];
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        {title ? <SceneTitle theme={theme}>{title}</SceneTitle> : null}
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
          {steps.map((s, i) => (
            <React.Fragment key={i}>
              <StaggerIn delay={i * 8}>
                <div style={{ ...cardBase(theme, t.accent), display: 'flex', alignItems: 'center', gap: 28, padding: '32px 34px' }}>
                  <div style={{ width: 82, height: 82, borderRadius: '50%', background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})`, color: t.bg, fontSize: 40, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 32px ${t.glow}` }}>{i + 1}</div>
                  <div style={{ fontSize: 58 }}>{icons[i]}</div>
                  <div style={{ fontSize: 38, fontWeight: 700, flex: 1 }}>{s}</div>
                </div>
              </StaggerIn>
              {i < steps.length - 1 ? <div style={{ width: 4, height: 30, background: `linear-gradient(180deg, ${t.accent}, transparent)`, marginLeft: 92 }} /> : null}
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginTop: 40 }}>
          <HighlightNumber theme={theme} value="-85%" label="Token 成本与延迟（示例式冲击数字）" />
        </div>
      </SceneBody>
      <SceneBadge theme={theme} label="07 · 流程" />
    </SceneBackground>
  );
};

export const LadderCard: React.FC<{ theme: VisualTheme; title?: string; levels: { label: string; desc: string }[] }> = ({ theme, title, levels }) => {
  const t = THEMES[theme];
  return (
    <SceneBackground theme={theme}>
      <SceneBody>
        {title ? <SceneTitle theme={theme}>{title}</SceneTitle> : null}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%' }}>
          {levels.map((l, i) => {
            const isTop = i === levels.length - 1;
            return (
              <StaggerIn key={i} delay={i * 8}>
                <div style={{ width: `${76 - i * 10}%`, background: isTop ? `linear-gradient(135deg, ${t.accent}, ${t.accent2})` : t.cardBg, border: `2px solid ${isTop ? t.accent : t.border}`, borderRadius: 26, padding: '28px 36px', textAlign: 'center', boxShadow: `0 12px 44px ${isTop ? t.glow : 'rgba(0,0,0,0.25)'}`, color: isTop ? t.bg : t.text }}>
                  <div style={{ fontSize: 40, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                    {i === 0 ? '🚀' : i === 1 ? '🔍' : '🏗️'}
                    {l.label}
                  </div>
                  <div style={{ fontSize: 30, marginTop: 10, color: isTop ? 'rgba(11,12,21,0.75)' : t.muted }}>{l.desc}</div>
                </div>
              </StaggerIn>
            );
          })}
          <div style={{ fontSize: 32, color: t.muted, marginTop: 8 }}>庞大 · 常更新 · 权限 · 引用 —— 四项都占，才向上走</div>
        </div>
      </SceneBody>
      <SceneBadge theme={theme} label="11 · 结论" />
    </SceneBackground>
  );
};
