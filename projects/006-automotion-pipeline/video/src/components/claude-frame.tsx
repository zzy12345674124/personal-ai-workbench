import React from 'react';

type ClaudeFrameProps = {
  children: React.ReactNode;
  title?: string;
  modelName?: string;
  avatarText?: string;
  accentColor?: string;
};

const Icon: React.FC<{ children: React.ReactNode; active?: boolean; accentColor: string }> = ({ children, active, accentColor }) => (
  <div
    style={{
      width: 66,
      height: 66,
      borderRadius: 18,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? '#FFFFFF' : 'transparent',
      color: active ? accentColor : '#7B746D',
      fontSize: 30,
      fontWeight: 750,
      boxShadow: active ? '0 6px 20px rgba(69, 58, 48, 0.08)' : 'none',
    }}
  >
    {children}
  </div>
);

/** 暖白对话型外壳：完全代码绘制，不依赖截图或在线资源。 */
export const ClaudeFrame: React.FC<ClaudeFrameProps> = ({
  children,
  title = '新对话',
  modelName = 'Claude',
  avatarText = 'C',
  accentColor = '#D97757',
}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      overflow: 'hidden',
      background: '#F7F5F0',
      color: '#292622',
      fontFamily: 'Inter, system-ui, "Microsoft YaHei", sans-serif',
    }}
  >
    <aside
      style={{
        width: 168,
        flex: '0 0 168px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '42px 0 46px',
        gap: 24,
        background: '#ECE9E2',
        borderRight: '1px solid #DED9CF',
      }}
    >
      <div style={{ width: 70, height: 70, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', background: accentColor, fontSize: 34, fontWeight: 850, boxShadow: `0 10px 26px ${accentColor}3D` }}>
        {avatarText}
      </div>
      <div style={{ height: 12 }} />
      <Icon active accentColor={accentColor}>＋</Icon>
      <Icon accentColor={accentColor}>⌕</Icon>
      <Icon accentColor={accentColor}>◫</Icon>
      <Icon accentColor={accentColor}>✦</Icon>
      <div style={{ flex: 1 }} />
      <Icon accentColor={accentColor}>?</Icon>
      <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#DCD6CC', color: '#625A52', fontSize: 26, fontWeight: 800 }}>我</div>
    </aside>

    <main style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <header
        style={{
          height: 128,
          flex: '0 0 128px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 54px',
          borderBottom: '1px solid #E3DFD7',
          background: 'rgba(250, 249, 246, 0.92)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 31, lineHeight: 1.25, fontWeight: 760, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div style={{ marginTop: 6, color: '#8C847B', fontSize: 20 }}>私人对话</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '12px 22px', border: '1px solid #D6D0C7', borderRadius: 999, background: '#FFFFFF', color: '#5B544D', fontSize: 22, fontWeight: 700 }}>{modelName}</div>
        <div style={{ marginLeft: 26, color: '#847B72', fontSize: 34, letterSpacing: 7 }}>•••</div>
      </header>

      <section style={{ flex: 1, minHeight: 0, padding: '46px 50px 164px', overflow: 'hidden' }}>
        <div style={{ maxWidth: 1280, height: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 30 }}>
          <div style={{ alignSelf: 'flex-end', maxWidth: 820, padding: '24px 30px', borderRadius: '28px 28px 8px 28px', background: '#E8E4DC', color: '#3C3833', fontSize: 25, lineHeight: 1.5 }}>
            把这段内容整理成清晰、可执行的视觉说明。
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr)', gap: 18 }}>
            <div style={{ width: 54, height: 54, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: accentColor, color: '#FFFFFF', fontSize: 25, fontWeight: 850 }}>{avatarText}</div>
            <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ marginBottom: 17, fontSize: 24, fontWeight: 780 }}>{modelName}</div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 30, border: '1px solid #D8D2C8', background: '#0B0C15', boxShadow: '0 22px 55px rgba(57, 47, 38, 0.16)' }}>
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>{children}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div style={{ position: 'absolute', left: 50, right: 50, bottom: 38, height: 98, borderRadius: 30, border: '1px solid #D6D0C7', background: '#FFFFFF', display: 'flex', alignItems: 'center', padding: '0 22px 0 30px', boxShadow: '0 14px 40px rgba(71, 59, 47, 0.12)' }}>
        <div style={{ color: '#9A9289', fontSize: 24 }}>继续回复…</div>
        <div style={{ flex: 1 }} />
        <div style={{ color: '#847B72', fontSize: 31 }}>＋</div>
        <div style={{ marginLeft: 20, width: 58, height: 58, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', background: accentColor, fontSize: 27, fontWeight: 900 }}>↑</div>
      </div>
    </main>
  </div>
);
