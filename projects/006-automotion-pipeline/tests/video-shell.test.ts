import { describe, expect, it } from 'vitest';
import { VideoShell } from '../video/src/components/video-shell.js';
import { IdeFrame } from '../video/src/components/ide-frame.js';
import { WechatFrame } from '../video/src/components/wechat-frame.js';
import { ClaudeFrame } from '../video/src/components/claude-frame.js';
import { DEFAULT_TEMPLATE_CONFIG } from '../video/src/template-config.js';

describe('VideoShell 外壳路由', () => {
  it('vscode 选择原 IdeFrame', () => {
    expect(VideoShell({ config: DEFAULT_TEMPLATE_CONFIG, children: '场景' }).type).toBe(IdeFrame);
  });

  it('wechat 选择 WechatFrame 且透传参数', () => {
    const config = { ...DEFAULT_TEMPLATE_CONFIG, shellType: 'wechat' as const, wechatContact: '小王', wechatAvatarText: '王', wechatBubbleColor: '#AABBCC' };
    const element = VideoShell({ config, children: '场景' });
    expect(element.type).toBe(WechatFrame);
    expect(element.props).toMatchObject({ contact: '小王', avatarText: '王', bubbleColor: '#AABBCC' });
  });

  it('claude 选择 ClaudeFrame 且透传参数', () => {
    const config = { ...DEFAULT_TEMPLATE_CONFIG, shellType: 'claude' as const, claudeTitle: '项目讨论', claudeModel: 'Claude', claudeAvatarText: '助' };
    const element = VideoShell({ config, children: '场景' });
    expect(element.type).toBe(ClaudeFrame);
    expect(element.props).toMatchObject({ title: '项目讨论', modelName: 'Claude', avatarText: '助' });
  });
});
