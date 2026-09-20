import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_CONFIG, normalizeTemplateConfig } from '../server/template-config.js';

const v1 = () => ({ schemaVersion: 1, workspaceTitle: 'AutoMotion — vibe + git', accentColor: '#007ACC', workspaceTitleSize: 26 });
const v3 = () => ({ ...DEFAULT_TEMPLATE_CONFIG });
const v2 = () => {
  const { claudeTitle: _title, claudeModel: _model, claudeAvatarText: _avatar, ...legacy } = DEFAULT_TEMPLATE_CONFIG;
  return { ...legacy, schemaVersion: 2 };
};

describe('008 TemplateConfigV3 合同', () => {
  it('默认为 VS Code 外壳且对象冻结', () => {
    expect(DEFAULT_TEMPLATE_CONFIG).toEqual({
      schemaVersion: 3, shellType: 'vscode', workspaceTitle: 'AutoMotion — vibe + git', accentColor: '#007ACC', workspaceTitleSize: 26,
      wechatContact: '文件传输助手', wechatAvatarText: '文', wechatBubbleColor: '#95EC69',
      claudeTitle: '新对话', claudeModel: 'Claude', claudeAvatarText: 'C',
    });
    expect(Object.isFrozen(DEFAULT_TEMPLATE_CONFIG)).toBe(true);
  });

  it('allowMissing 仅在明确允许时回默认值', () => {
    expect(normalizeTemplateConfig(undefined, { allowMissing: true })).toEqual(DEFAULT_TEMPLATE_CONFIG);
    expect(() => normalizeTemplateConfig(undefined)).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig(null)).toThrow('BAD_TEMPLATE_CONFIG');
  });

  it('旧 V1 自动迁移为 V3，同时保留原有标准化规则', () => {
    expect(normalizeTemplateConfig({ ...v1(), workspaceTitle: '  新标题  ', accentColor: '#cc0067', workspaceTitleSize: 25.6 })).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '新标题', accentColor: '#CC0067', workspaceTitleSize: 26,
    });
  });

  it('旧 V2 微信外壳自动迁移为 V3', () => {
    expect(normalizeTemplateConfig({ ...v2(), shellType: 'wechat', wechatContact: '  小王  ', wechatAvatarText: ' 王 ', wechatBubbleColor: '#aabbcc' })).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG, shellType: 'wechat', wechatContact: '小王', wechatAvatarText: '王', wechatBubbleColor: '#AABBCC',
    });
  });

  it('标题、颜色、字号边界与非法类型均拒绝', () => {
    for (const bad of ['', '   ', 'a'.repeat(81)]) expect(() => normalizeTemplateConfig({ ...v3(), workspaceTitle: bad })).toThrow('BAD_TEMPLATE_CONFIG');
    for (const bad of ['blue', '#12345', '#GGGGGG']) expect(() => normalizeTemplateConfig({ ...v3(), accentColor: bad })).toThrow('BAD_TEMPLATE_CONFIG');
    for (const bad of [17, 41, NaN, Infinity, '26', null]) expect(() => normalizeTemplateConfig({ ...v3(), workspaceTitleSize: bad })).toThrow('BAD_TEMPLATE_CONFIG');
  });

  it('微信专属字段严格校验', () => {
    expect(() => normalizeTemplateConfig({ ...v3(), shellType: 'other' })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...v3(), wechatContact: ' ' })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...v3(), wechatContact: 'a'.repeat(41) })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...v3(), wechatAvatarText: '超过两' })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...v3(), wechatBubbleColor: 'green' })).toThrow('BAD_TEMPLATE_CONFIG');
  });

  it('Claude 专属字段规范化并严格校验', () => {
    expect(normalizeTemplateConfig({ ...v3(), shellType: 'claude', claudeTitle: '  项目讨论  ', claudeModel: ' Claude ', claudeAvatarText: ' 助 ' })).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG, shellType: 'claude', claudeTitle: '项目讨论', claudeModel: 'Claude', claudeAvatarText: '助',
    });
    expect(() => normalizeTemplateConfig({ ...v3(), claudeTitle: '' })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...v3(), claudeTitle: 'x'.repeat(61) })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...v3(), claudeModel: 'x'.repeat(41) })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...v3(), claudeAvatarText: '超过两' })).toThrow('BAD_TEMPLATE_CONFIG');
  });

  it('V1/V2/V3 都拒绝多键、缺键和错误版本', () => {
    expect(() => normalizeTemplateConfig({ ...v1(), extra: 1 })).toThrow('BAD_TEMPLATE_CONFIG');
    const { wechatContact, ...missing } = v3();
    expect(() => normalizeTemplateConfig(missing)).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...v3(), schemaVersion: 4 })).toThrow('BAD_TEMPLATE_CONFIG');
  });
});
