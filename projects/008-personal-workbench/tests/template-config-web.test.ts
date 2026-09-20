import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TEMPLATE_PRESETS, DEFAULT_TEMPLATE_CONFIG, LEGACY_TEMPLATE_CONFIG_STORAGE_KEY, OLDEST_TEMPLATE_CONFIG_STORAGE_KEY, normalizeTemplateConfig,
  parseStoredTemplateConfig, parseStoredTemplatePresets, removeTemplatePreset, serializeTemplateConfig,
  serializeTemplatePresets, TEMPLATE_CONFIG_STORAGE_KEY, TEMPLATE_PRESETS_STORAGE_KEY, upsertTemplatePreset,
} from '../web/template-config.js';

const v1 = () => ({ schemaVersion: 1, workspaceTitle: 'AutoMotion — vibe + git', accentColor: '#007ACC', workspaceTitleSize: 26 });

describe('web TemplateConfigV3 纯函数', () => {
  it('新旧保存键固定', () => {
    expect(TEMPLATE_CONFIG_STORAGE_KEY).toBe('workbench.templateConfig.v3');
    expect(LEGACY_TEMPLATE_CONFIG_STORAGE_KEY).toBe('workbench.templateConfig.v2');
    expect(OLDEST_TEMPLATE_CONFIG_STORAGE_KEY).toBe('workbench.templateConfig.v1');
  });

  it('V3 serialize → parse 往返一致', () => {
    const raw = serializeTemplateConfig(DEFAULT_TEMPLATE_CONFIG);
    expect(parseStoredTemplateConfig(raw)).toEqual({ config: DEFAULT_TEMPLATE_CONFIG, invalid: false });
  });

  it('旧 V1 存储值解析时迁移为 V3', () => {
    expect(parseStoredTemplateConfig(JSON.stringify(v1()))).toEqual({ config: DEFAULT_TEMPLATE_CONFIG, invalid: false });
  });

  it('旧 V2 存储值解析时保留外壳并迁移为 V3', () => {
    const { claudeTitle: _title, claudeModel: _model, claudeAvatarText: _avatar, ...legacy } = DEFAULT_TEMPLATE_CONFIG;
    expect(parseStoredTemplateConfig(JSON.stringify({ ...legacy, schemaVersion: 2, shellType: 'wechat' }))).toEqual({
      config: { ...DEFAULT_TEMPLATE_CONFIG, shellType: 'wechat' },
      invalid: false,
    });
  });

  it('序列化前规范化通用与微信字段', () => {
    const raw = serializeTemplateConfig({ ...DEFAULT_TEMPLATE_CONFIG, shellType: 'wechat', workspaceTitle: '  标题  ', accentColor: '#aa00bb', workspaceTitleSize: 28.6, wechatContact: ' 联系人 ', wechatBubbleColor: '#abcdef' });
    expect(parseStoredTemplateConfig(raw)).toEqual({
      config: { ...DEFAULT_TEMPLATE_CONFIG, shellType: 'wechat', workspaceTitle: '标题', accentColor: '#AA00BB', workspaceTitleSize: 29, wechatContact: '联系人', wechatBubbleColor: '#ABCDEF' },
      invalid: false,
    });
  });

  it('损坏 JSON/错误版本/合同外字段均 invalid', () => {
    expect(parseStoredTemplateConfig('{oops')).toEqual({ config: null, invalid: true });
    expect(parseStoredTemplateConfig(JSON.stringify({ ...DEFAULT_TEMPLATE_CONFIG, schemaVersion: 4 }))).toEqual({ config: null, invalid: true });
    expect(parseStoredTemplateConfig(JSON.stringify({ ...DEFAULT_TEMPLATE_CONFIG, extra: 1 }))).toEqual({ config: null, invalid: true });
    expect(parseStoredTemplateConfig(JSON.stringify({ ...DEFAULT_TEMPLATE_CONFIG, wechatAvatarText: '超过两' }))).toEqual({ config: null, invalid: true });
  });

  it('存储缺失不算损坏', () => {
    expect(parseStoredTemplateConfig(null)).toEqual({ config: null, invalid: false });
    expect(parseStoredTemplateConfig(undefined)).toEqual({ config: null, invalid: false });
  });

  it('非法输入 serialize 直接报错', () => {
    expect(() => serializeTemplateConfig({ ...DEFAULT_TEMPLATE_CONFIG, workspaceTitleSize: '26' })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => serializeTemplateConfig(null)).toThrow('BAD_TEMPLATE_CONFIG');
    expect(normalizeTemplateConfig(DEFAULT_TEMPLATE_CONFIG)).toEqual(DEFAULT_TEMPLATE_CONFIG);
  });
});

describe('web 主题参数预设纯函数', () => {
  const preset = (id = 'preset-one', name = '我的主题') => ({
    id,
    name,
    config: { ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: `标题-${id}` },
  });

  it('存储键与三套内置预设固定，内置配置均满足 V3 合同', () => {
    expect(TEMPLATE_PRESETS_STORAGE_KEY).toBe('workbench.templatePresets.v1');
    expect(BUILTIN_TEMPLATE_PRESETS.map((item) => item.id)).toEqual(['builtin-vscode-classic', 'builtin-claude-warm', 'builtin-wechat-green']);
    for (const item of BUILTIN_TEMPLATE_PRESETS) expect(normalizeTemplateConfig(item.config)).toEqual(item.config);
  });

  it('自定义预设 serialize → parse 往返，并规范化名称与配置', () => {
    const raw = serializeTemplatePresets([{ ...preset(), name: '  常用主题  ', config: { ...DEFAULT_TEMPLATE_CONFIG, accentColor: '#aa00bb' } }]);
    expect(parseStoredTemplatePresets(raw)).toEqual({
      presets: [{ ...preset(), name: '常用主题', config: { ...DEFAULT_TEMPLATE_CONFIG, accentColor: '#AA00BB' } }],
      invalid: false,
    });
  });

  it('缺失存储返回空列表；损坏 JSON、重复 id、内置 id 与合同外字段均 invalid', () => {
    expect(parseStoredTemplatePresets(null)).toEqual({ presets: [], invalid: false });
    expect(parseStoredTemplatePresets('{oops')).toEqual({ presets: [], invalid: true });
    expect(parseStoredTemplatePresets(JSON.stringify({ schemaVersion: 1, items: [preset(), preset()] }))).toEqual({ presets: [], invalid: true });
    expect(parseStoredTemplatePresets(JSON.stringify({ schemaVersion: 1, items: [preset('builtin-fake')] }))).toEqual({ presets: [], invalid: true });
    expect(parseStoredTemplatePresets(JSON.stringify({ schemaVersion: 1, items: [{ ...preset(), extra: true }] }))).toEqual({ presets: [], invalid: true });
  });

  it('新增、更新、删除均保持稳定顺序，最多保存 12 个', () => {
    const first = upsertTemplatePreset([], preset());
    const second = upsertTemplatePreset(first, preset('preset-two', '第二套'));
    const updated = upsertTemplatePreset(second, preset('preset-one', '更新后'));
    expect(updated.map((item) => item.name)).toEqual(['更新后', '第二套']);
    expect(removeTemplatePreset(updated, 'preset-one')).toEqual([preset('preset-two', '第二套')]);
    const full = Array.from({ length: 12 }, (_, index) => preset(`preset-${index}`));
    expect(() => upsertTemplatePreset(full, preset('preset-overflow'))).toThrow('BAD_TEMPLATE_CONFIG');
  });
});
