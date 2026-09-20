import React from 'react';
import type { TemplateConfigV3 } from '../template-config';
import { ClaudeFrame } from './claude-frame';
import { IdeFrame } from './ide-frame';
import { WechatFrame } from './wechat-frame';

export const VideoShell: React.FC<{ config: TemplateConfigV3; children: React.ReactNode }> = ({ config, children }) => {
  if (config.shellType === 'wechat') {
    return (
      <WechatFrame
        contact={config.wechatContact}
        avatarText={config.wechatAvatarText}
        bubbleColor={config.wechatBubbleColor}
        accentColor={config.accentColor}
      >
        {children}
      </WechatFrame>
    );
  }
  if (config.shellType === 'claude') {
    return (
      <ClaudeFrame
        title={config.claudeTitle}
        modelName={config.claudeModel}
        avatarText={config.claudeAvatarText}
        accentColor={config.accentColor}
      >
        {children}
      </ClaudeFrame>
    );
  }
  return (
    <IdeFrame
      workspaceTitle={config.workspaceTitle}
      accentColor={config.accentColor}
      workspaceTitleSize={config.workspaceTitleSize}
    >
      {children}
    </IdeFrame>
  );
};
