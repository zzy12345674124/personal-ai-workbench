import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { VisualTheme } from '../data/scenes';

/** 三段主题配色（视觉风格规范 §2，来自示例视频分析） */
export interface ThemeColors {
  bg: string;
  bg2: string;
  accent: string;
  accent2: string;
  highlight: string;
  warn: string;
  text: string;
  muted: string;
  cardBg: string;
  border: string;
  glow: string;
  star: boolean;
}

export const THEMES: Record<VisualTheme, ThemeColors> = {
  tech: {
    bg: '#0B0C15',
    bg2: '#141829',
    accent: '#63EAFF',
    accent2: '#8B5CF6',
    highlight: '#00FF9D',
    warn: '#FFD700',
    text: '#FFFFFF',
    muted: '#94A3B8',
    cardBg: 'rgba(255,255,255,0.07)',
    border: 'rgba(99,234,255,0.4)',
    glow: 'rgba(99,234,255,0.35)',
    star: true,
  },
  paper: {
    bg: '#F7F5F0',
    bg2: '#FFFFFF',
    // 2026-08-07 视觉迭代：accent #FFB347 → #C86400（浅底大字对比度 1.9:1 → 3.3:1，MiMo 复检指出橙字在浅底辨识度低）
    accent: '#C86400',
    accent2: '#1890FF',
    highlight: '#52C41A',
    warn: '#FAAD14',
    text: '#1A1A1A',
    // 浅色背景的次要文字需更深以保证对比度（视觉复核两轮指出）
    muted: '#4A4A4A',
    cardBg: 'rgba(255,255,255,0.92)',
    border: 'rgba(24,144,255,0.35)',
    glow: 'rgba(255,179,71,0.3)',
    star: false,
  },
  data: {
    bg: '#0B0C15',
    bg2: '#1F2338',
    accent: '#4D9FFF',
    accent2: '#00E5FF',
    highlight: '#FFD700',
    warn: '#FF0055',
    text: '#FFFFFF',
    muted: '#A0A8C0',
    cardBg: 'rgba(31,35,56,0.78)',
    border: 'rgba(77,159,255,0.45)',
    glow: 'rgba(77,159,255,0.35)',
    star: true,
  },
};

const Stars: React.FC = () => {
  const stars = Array.from({ length: 26 }, (_, i) => ({
    left: `${(i * 37) % 100}%`,
    top: `${(i * 53) % 100}%`,
    size: 2 + ((i * 7) % 3),
    opacity: 0.25 + ((i * 13) % 50) / 100,
  }));
  return (
    <>
      {stars.map((s, i) => (
        <div key={i} style={{ position: 'absolute', left: s.left, top: s.top, width: s.size, height: s.size, borderRadius: '50%', background: '#fff', opacity: s.opacity }} />
      ))}
    </>
  );
};

/** 主题化背景：渐变 + 星点/纸纹理 + 光晕 + 顶部装饰条 */
export const SceneBackground: React.FC<{ theme: VisualTheme; children: React.ReactNode }> = ({ theme, children }) => {
  const t = THEMES[theme];
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: `linear-gradient(170deg, ${t.bg} 0%, ${t.bg2} 100%)`, overflow: 'hidden', fontFamily: 'system-ui, "Microsoft YaHei", sans-serif', color: t.text }}>
      {t.star ? <Stars /> : (
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(0,0,0,0.05) 1.5px, transparent 1.5px)', backgroundSize: '26px 26px' }} />
      )}
      <div style={{ position: 'absolute', width: 540, height: 540, borderRadius: '50%', top: -170, right: -130, background: `radial-gradient(circle, ${t.glow}, transparent 70%)` }} />
      <div style={{ position: 'absolute', width: 660, height: 660, borderRadius: '50%', bottom: -230, left: -190, background: `radial-gradient(circle, ${t.glow}, transparent 70%)` }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, background: `linear-gradient(90deg, ${t.accent}, ${t.accent2})` }} />
      {children}
    </div>
  );
};

/** 场景徽章（左上角） */
export const SceneBadge: React.FC<{ theme: VisualTheme; label: string }> = ({ theme, label }) => {
  const t = THEMES[theme];
  return (
    <div style={{ position: 'absolute', top: 90, left: 70, fontSize: 30, fontWeight: 700, color: t.accent, background: t.cardBg, border: `1px solid ${t.border}`, borderRadius: 999, padding: '10px 26px', letterSpacing: 2 }}>
      {label}
    </div>
  );
};

/** 底部进度条（随帧增长，贯穿全片动感） */
export const ProgressBar: React.FC<{ theme: VisualTheme; total: number }> = ({ theme, total }) => {
  const frame = useCurrentFrame();
  const t = THEMES[theme];
  const width = interpolate(frame, [0, total], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', bottom: 70, left: 70, right: 70, height: 10, background: 'rgba(148,163,184,0.22)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ width: `${width}%`, height: '100%', background: `linear-gradient(90deg, ${t.accent}, ${t.accent2})`, borderRadius: 999, boxShadow: `0 0 16px ${t.glow}` }} />
    </div>
  );
};

/** 错峰入场：元素延迟滑入 */
export const StaggerIn: React.FC<{ delay?: number; children: React.ReactNode }> = ({ delay = 0, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [delay, delay + 10], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  const translateY = spring({ frame: frame - delay, fps, config: { damping: 14 } }) * 56;
  return <div style={{ opacity, transform: `translateY(${translateY}px)` }}>{children}</div>;
};

/** 内容容器 */
export const SceneBody: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // 2026-08-07 视觉迭代：padding 150/60/120 → 100/50/100——内容层被 0.72 缩放后原 padding 等效更大，
  // 上下留白过多导致编辑区「大面积空白」；收窄后内容更满（MiMo 诊断 ①）
  <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 50px 100px' }}>
    {children}
  </div>
);

export const SceneTitle: React.FC<{ theme: VisualTheme; children: React.ReactNode }> = ({ theme, children }) => {
  const t = THEMES[theme];
  return (
    <div style={{ fontSize: 62, fontWeight: 900, textAlign: 'center', marginBottom: 52, lineHeight: 1.3, letterSpacing: 1, textShadow: `0 4px 40px ${t.glow}` }}>
      {children}
    </div>
  );
};

/** 高亮数字（示例 "198" 式冲击数字） */
export const HighlightNumber: React.FC<{ theme: VisualTheme; value: string; label?: string }> = ({ theme, value, label }) => {
  const t = THEMES[theme];
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 108, fontWeight: 900, background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', textShadow: `0 0 60px ${t.glow}` }}>{value}</div>
      {/* 浅色主题（paper）下说明文字用正文色保证对比度（视觉复核发现的对比度问题） */}
      {label ? <div style={{ fontSize: 32, color: theme === 'paper' ? t.text : t.muted, marginTop: 8, fontWeight: 600 }}>{label}</div> : null}
    </div>
  );
};

/** VS 徽章（对比元素） */
export const VsBadge: React.FC<{ theme: VisualTheme }> = ({ theme }) => {
  const t = THEMES[theme];
  return (
    <div style={{ width: 92, height: 92, borderRadius: '50%', background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 900, color: t.bg, boxShadow: `0 8px 40px ${t.glow}` }}>
      VS
    </div>
  );
};
