// tests/template-config.test.ts —— 006 模板生产配置合同（V1/V2/V3）校验
// 与 008 server/template-config.js 行为逐字段一致（任务书 §1）。
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_TEMPLATE_CONFIG, normalizeTemplateConfig, type TemplateConfigV1 } from '../video/src/template-config.js';
import { TEMPLATE_PREVIEW_DEFAULTS } from '../video/src/TemplatePreview.js';
import { resolveTemplateConfig, templateConfigLiteral } from '../scripts/prepare-video-assets.js';

const valid = (): TemplateConfigV1 => ({
  schemaVersion: 1,
  workspaceTitle: 'AutoMotion — vibe + git',
  accentColor: '#007ACC',
  workspaceTitleSize: 26,
});

describe('006 template config 合同', () => {
  it('IdeFrame 使用的默认字号 26：TemplatePreview 默认值绑定合同默认值（任务书 §3）', () => {
    expect(DEFAULT_TEMPLATE_CONFIG.workspaceTitleSize).toBe(26);
    expect(TEMPLATE_PREVIEW_DEFAULTS).toEqual({
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
    });
  });

  it('默认值：shape 正确且冻结', () => {
    expect(DEFAULT_TEMPLATE_CONFIG).toEqual({
      schemaVersion: 3,
      shellType: 'vscode',
      workspaceTitle: 'AutoMotion — vibe + git',
      accentColor: '#007ACC',
      workspaceTitleSize: 26,
      wechatContact: '文件传输助手',
      wechatAvatarText: '文',
      wechatBubbleColor: '#95EC69',
      claudeTitle: '新对话',
      claudeModel: 'Claude',
      claudeAvatarText: 'C',
    });
    expect(Object.isFrozen(DEFAULT_TEMPLATE_CONFIG)).toBe(true);
  });

  it('allowMissing=true 且输入为 null/undefined 时返回默认值', () => {
    expect(normalizeTemplateConfig(undefined, true)).toEqual(DEFAULT_TEMPLATE_CONFIG);
    expect(normalizeTemplateConfig(null, true)).toEqual(DEFAULT_TEMPLATE_CONFIG);
  });

  it('allowMissing 缺省时无输入显式报错（禁止静默回退）', () => {
    expect(() => normalizeTemplateConfig(undefined)).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig(null)).toThrow('BAD_TEMPLATE_CONFIG');
  });

  it('合法值标准化：标题去首尾空白、颜色转大写、字号四舍五入取整', () => {
    const out = normalizeTemplateConfig({
      schemaVersion: 1,
      workspaceTitle: '  新工作区标题  ',
      accentColor: '#cc0067',
      workspaceTitleSize: 25.6,
    });
    expect(out).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG,
      workspaceTitle: '新工作区标题',
      accentColor: '#CC0067',
      workspaceTitleSize: 26,
    });
  });

  it('空标题与超长标题拒绝（去空白后 1～80）', () => {
    for (const bad of ['', '   ', '\t']) {
      expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitle: bad })).toThrow('BAD_TEMPLATE_CONFIG');
    }
    expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitle: 'a'.repeat(81) })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitle: 'a'.repeat(80) })).not.toThrow();
  });

  it('非法颜色拒绝（必须 /^#[0-9A-Fa-f]{6}$/）', () => {
    for (const bad of ['#007AC', '007ACC', '#GGGGGG', '#007ACC33', 'blue', '']) {
      expect(() => normalizeTemplateConfig({ ...valid(), accentColor: bad })).toThrow('BAD_TEMPLATE_CONFIG');
    }
  });

  it('越界字号拒绝（有限数字、18～40、先四舍五入）', () => {
    expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitleSize: 17 })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitleSize: 41 })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitleSize: 17.4 })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitleSize: 40.5 })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitleSize: 18 })).not.toThrow();
    expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitleSize: 40 })).not.toThrow();
    for (const bad of [NaN, Infinity, '26', null, true, 1n, Symbol('size')]) {
      expect(() => normalizeTemplateConfig({ ...valid(), workspaceTitleSize: bad })).toThrow('BAD_TEMPLATE_CONFIG');
    }
  });

  it('多余键拒绝（只接受 4 个键）', () => {
    expect(() => normalizeTemplateConfig({ ...valid(), extra: 1 })).toThrow('BAD_TEMPLATE_CONFIG');
  });

  it('缺键拒绝', () => {
    const { schemaVersion, workspaceTitle, accentColor, workspaceTitleSize } = valid();
    expect(() => normalizeTemplateConfig({ workspaceTitle, accentColor, workspaceTitleSize })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ schemaVersion, accentColor, workspaceTitleSize })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ schemaVersion, workspaceTitle, workspaceTitleSize })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ schemaVersion, workspaceTitle, accentColor })).toThrow('BAD_TEMPLATE_CONFIG');
  });

  it('旧版 shape 不能伪装成其他版本', () => {
    for (const v of [2, '1', '1.0', null, true]) {
      expect(() => normalizeTemplateConfig({ ...valid(), schemaVersion: v })).toThrow('BAD_TEMPLATE_CONFIG');
    }
  });

  it('V3 微信外壳校验与标准化', () => {
    expect(normalizeTemplateConfig({ ...DEFAULT_TEMPLATE_CONFIG, shellType: 'wechat', wechatContact: '  小王  ', wechatAvatarText: ' 王 ', wechatBubbleColor: '#aabbcc' })).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG, shellType: 'wechat', wechatContact: '小王', wechatAvatarText: '王', wechatBubbleColor: '#AABBCC',
    });
    expect(() => normalizeTemplateConfig({ ...DEFAULT_TEMPLATE_CONFIG, shellType: 'other' })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...DEFAULT_TEMPLATE_CONFIG, wechatAvatarText: '超过两' })).toThrow('BAD_TEMPLATE_CONFIG');
  });

  it('V2 快照无损迁移为 V3', () => {
    const { claudeTitle: _title, claudeModel: _model, claudeAvatarText: _avatar, ...legacy } = DEFAULT_TEMPLATE_CONFIG;
    const v2 = { ...legacy, schemaVersion: 2 as const, shellType: 'wechat' as const };
    expect(normalizeTemplateConfig(v2)).toEqual({ ...DEFAULT_TEMPLATE_CONFIG, shellType: 'wechat' });
  });

  it('Claude 外壳参数标准化与边界校验', () => {
    expect(normalizeTemplateConfig({
      ...DEFAULT_TEMPLATE_CONFIG,
      shellType: 'claude',
      claudeTitle: '  项目讨论  ',
      claudeModel: '  Claude  ',
      claudeAvatarText: ' 助 ',
    })).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG,
      shellType: 'claude',
      claudeTitle: '项目讨论',
      claudeModel: 'Claude',
      claudeAvatarText: '助',
    });
    expect(() => normalizeTemplateConfig({ ...DEFAULT_TEMPLATE_CONFIG, claudeTitle: '' })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...DEFAULT_TEMPLATE_CONFIG, claudeModel: 'x'.repeat(41) })).toThrow('BAD_TEMPLATE_CONFIG');
    expect(() => normalizeTemplateConfig({ ...DEFAULT_TEMPLATE_CONFIG, claudeAvatarText: '超过两' })).toThrow('BAD_TEMPLATE_CONFIG');
  });
});

describe('prepare-video-assets 模板配置读取（任务书 §6）', () => {
  const makeRun = () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-run-'));
    const inner = join(root, 'run-999');
    mkdirSync(inner, { recursive: true });
    return { root, inner };
  };
  const writeConfig = (dir: string, config: TemplateConfigV1) =>
    writeFileSync(join(dir, 'template-config.json'), JSON.stringify(config), 'utf8');

  it('读取优先级：内层快照优先于外层（008 外层运行快照）', () => {
    const { root, inner } = makeRun();
    writeConfig(root, { ...valid(), workspaceTitle: '外层' });
    writeConfig(inner, { ...valid(), workspaceTitle: '内层', accentColor: '#123abc' });
    expect(resolveTemplateConfig(inner)).toEqual({
      ...DEFAULT_TEMPLATE_CONFIG,
      workspaceTitle: '内层',
      accentColor: '#123ABC',
      workspaceTitleSize: 26,
    });
  });

  it('内层缺失时读取外层快照', () => {
    const { root, inner } = makeRun();
    writeConfig(root, { ...valid(), workspaceTitle: '外层快照' });
    expect(resolveTemplateConfig(inner)).toEqual({ ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: '外层快照' });
  });

  it('两处都缺失时返回正式默认值', () => {
    const { inner } = makeRun();
    expect(resolveTemplateConfig(inner)).toEqual(DEFAULT_TEMPLATE_CONFIG);
  });

  it('候选文件损坏/不合规必须失败并指出文件路径（禁止静默回退默认值）', () => {
    const { inner } = makeRun();
    writeFileSync(join(inner, 'template-config.json'), '{broken', 'utf8');
    expect(() => resolveTemplateConfig(inner)).toThrowError(/TEMPLATE_CONFIG_INVALID/);
    expect(() => resolveTemplateConfig(inner)).toThrowError(/template-config\.json/);
    // 外层损坏同样失败，不回退默认值
    const { root, inner: inner2 } = makeRun();
    writeFileSync(join(root, 'template-config.json'), JSON.stringify({ ...valid(), schemaVersion: 2 }), 'utf8');
    expect(() => resolveTemplateConfig(inner2)).toThrowError(/TEMPLATE_CONFIG_INVALID/);
  });

  it('含引号标题安全序列化（JSON.stringify 转义，不破坏 TypeScript 字面量）', () => {
    const quoted = '标题 "带引号" 与 \\n换行';
    const literal = templateConfigLiteral({ ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: quoted });
    expect(literal).toContain('export const templateConfig =');
    expect(literal.endsWith('as const;')).toBe(true);
    // 生成的字面量重新解析回原值（安全往返）
    const match = literal.match(/= ([\s\S]*?) as const;/);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual({ ...DEFAULT_TEMPLATE_CONFIG, workspaceTitle: quoted });
  });
});
