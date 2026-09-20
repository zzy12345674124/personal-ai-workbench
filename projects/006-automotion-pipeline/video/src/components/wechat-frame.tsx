import React from 'react';
import { DEFAULT_TEMPLATE_CONFIG } from '../template-config';

export interface WechatFrameProps {
  children: React.ReactNode;
  contact?: string;
  avatarText?: string;
  bubbleColor?: string;
  accentColor?: string;
}

/** 竖屏微信对话外壳：场景内容作为一张可播放的分享卡片嵌入对话流。 */
export const WechatFrame: React.FC<WechatFrameProps> = ({
  children,
  contact = DEFAULT_TEMPLATE_CONFIG.wechatContact,
  avatarText = DEFAULT_TEMPLATE_CONFIG.wechatAvatarText,
  bubbleColor = DEFAULT_TEMPLATE_CONFIG.wechatBubbleColor,
  accentColor = DEFAULT_TEMPLATE_CONFIG.accentColor,
}) => (
  <div style={{ width: '100%', height: '100%', background: '#EDEDED', color: '#171717', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, "Microsoft YaHei", sans-serif' }}>
    <div style={{ height: 74, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 34px 13px', fontSize: 25, fontWeight: 700, background: '#EDEDED' }}>
      <span>09:41</span><span style={{ letterSpacing: 5 }}>●●● ⌯ ▰</span>
    </div>
    <div style={{ height: 108, display: 'grid', gridTemplateColumns: '100px 1fr 100px', alignItems: 'center', padding: '0 18px', borderBottom: '1px solid rgba(0,0,0,.09)', background: 'rgba(245,245,245,.96)' }}>
      <span style={{ fontSize: 52, fontWeight: 300, lineHeight: 1 }}>‹</span>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 650 }}>{contact}</div>
        <div style={{ marginTop: 3, color: '#8C8C8C', fontSize: 20 }}>在线</div>
      </div>
      <span style={{ textAlign: 'center', fontSize: 40, letterSpacing: 4 }}>•••</span>
    </div>

    <div style={{ flex: 1, minHeight: 0, padding: '34px 34px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ alignSelf: 'center', padding: '7px 18px', borderRadius: 12, background: 'rgba(0,0,0,.08)', color: '#8A8A8A', fontSize: 22 }}>今天 09:41</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, minHeight: 0, flex: 1 }}>
        <div style={{ width: 72, height: 72, flexShrink: 0, borderRadius: 13, display: 'grid', placeItems: 'center', background: accentColor, color: '#fff', fontSize: 31, fontWeight: 800, boxShadow: '0 4px 14px rgba(0,0,0,.12)' }}>{avatarText}</div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', padding: 10, borderRadius: 14, background: bubbleColor, boxShadow: '0 3px 10px rgba(0,0,0,.08)' }}>
          <span style={{ position: 'absolute', left: -14, top: 22, width: 0, height: 0, borderTop: '12px solid transparent', borderBottom: '12px solid transparent', borderRight: `16px solid ${bubbleColor}` }} />
          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 10, background: '#0B0C15' }}>
            {children}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 18px', borderRadius: 16, background: '#F7F7F7', border: '1px solid rgba(0,0,0,.08)' }}>
        <span style={{ fontSize: 38 }}>◎</span><div style={{ flex: 1, height: 54, borderRadius: 10, background: '#fff' }} /><span style={{ fontSize: 36 }}>☺</span><span style={{ fontSize: 38 }}>+</span>
      </div>
    </div>
  </div>
);
