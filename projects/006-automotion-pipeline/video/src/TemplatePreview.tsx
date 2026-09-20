import React, { useEffect } from 'react';
import { zColor } from '@remotion/zod-types';
import { AbsoluteFill, getRemotionEnvironment } from 'remotion';
import { z } from 'zod';
import { VideoShell } from './components/video-shell';
import { DEFAULT_TEMPLATE_CONFIG, normalizeTemplateConfig, type TemplateConfigV3 } from './template-config';

export const templatePreviewSchema = z.object({
  shellType: z.enum(['vscode', 'wechat', 'claude']),
  workspaceTitle: z.string(),
  accentColor: zColor(),
  workspaceTitleSize: z.number().min(18).max(40),
  wechatContact: z.string().min(1).max(40),
  wechatAvatarText: z.string().min(1).max(2),
  wechatBubbleColor: zColor(),
  claudeTitle: z.string().min(1).max(60),
  claudeModel: z.string().min(1).max(40),
  claudeAvatarText: z.string().min(1).max(2),
});

export type TemplatePreviewProps = z.infer<typeof templatePreviewSchema>;

export const TEMPLATE_PREVIEW_DEFAULTS: TemplatePreviewProps = {
  shellType: DEFAULT_TEMPLATE_CONFIG.shellType,
  workspaceTitle: DEFAULT_TEMPLATE_CONFIG.workspaceTitle,
  accentColor: DEFAULT_TEMPLATE_CONFIG.accentColor,
  workspaceTitleSize: DEFAULT_TEMPLATE_CONFIG.workspaceTitleSize,
  wechatContact: DEFAULT_TEMPLATE_CONFIG.wechatContact,
  wechatAvatarText: DEFAULT_TEMPLATE_CONFIG.wechatAvatarText,
  wechatBubbleColor: DEFAULT_TEMPLATE_CONFIG.wechatBubbleColor,
  claudeTitle: DEFAULT_TEMPLATE_CONFIG.claudeTitle,
  claudeModel: DEFAULT_TEMPLATE_CONFIG.claudeModel,
  claudeAvatarText: DEFAULT_TEMPLATE_CONFIG.claudeAvatarText,
};

const DRAFT_ENDPOINT = 'http://127.0.0.1:8080/api/template-preview/draft';
const DRAFT_DEBOUNCE_MS = 150;

export const TemplatePreview: React.FC<TemplatePreviewProps> = (props) => {
  const isStudio = getRemotionEnvironment().isStudio;
  let config: TemplateConfigV3 | null = null;
  try {
    config = normalizeTemplateConfig({ schemaVersion: 3, ...props });
  } catch {
    // Studio 编辑文本字段的中间态可能暂时为空；保留上屏能力，但不回传非法配置。
  }
  const previewConfig = config ?? DEFAULT_TEMPLATE_CONFIG;

  useEffect(() => {
    if (!isStudio || !config) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(DRAFT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: controller.signal,
      }).catch(() => { /* 本机回传失败不打断预览 */ });
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isStudio, config?.shellType, config?.workspaceTitle, config?.accentColor, config?.workspaceTitleSize, config?.wechatContact, config?.wechatAvatarText, config?.wechatBubbleColor, config?.claudeTitle, config?.claudeModel, config?.claudeAvatarText]);

  return (
    <AbsoluteFill style={{ background: '#0B0C15' }} from={-4}>
      <VideoShell config={previewConfig}>
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            padding: 72,
            background: `radial-gradient(circle at 50% 42%, ${previewConfig.accentColor}2b, transparent 48%), #0B0C15`,
            color: '#fff',
            fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
          }}
        >
          <div style={{ color: previewConfig.accentColor, fontSize: 26, fontWeight: 700, letterSpacing: 4 }}>TEMPLATE PREVIEW</div>
          <div style={{ maxWidth: 850, marginTop: 28, fontSize: 64, fontWeight: 900, lineHeight: 1.2, textAlign: 'center', textWrap: 'balance' }}>{previewConfig.workspaceTitle}</div>
          <div style={{ marginTop: 30, color: '#94A3B8', fontSize: 30, textAlign: 'center' }}>切换外壳或修改参数，画面会立即变化。</div>
        </AbsoluteFill>
      </VideoShell>
    </AbsoluteFill>
  );
};
