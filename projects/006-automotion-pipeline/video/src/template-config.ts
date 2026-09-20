/** 006/008 共用的模板生产配置合同。旧版本读取时自动迁移为 V3。 */
export type TemplateConfigV1 = {
  schemaVersion: 1;
  workspaceTitle: string;
  accentColor: string;
  workspaceTitleSize: number;
};

export type TemplateConfigV2 = {
  schemaVersion: 2;
  shellType: 'vscode' | 'wechat';
  workspaceTitle: string;
  accentColor: string;
  workspaceTitleSize: number;
  wechatContact: string;
  wechatAvatarText: string;
  wechatBubbleColor: string;
};

export type TemplateConfigV3 = {
  schemaVersion: 3;
  shellType: 'vscode' | 'wechat' | 'claude';
  workspaceTitle: string;
  accentColor: string;
  workspaceTitleSize: number;
  wechatContact: string;
  wechatAvatarText: string;
  wechatBubbleColor: string;
  claudeTitle: string;
  claudeModel: string;
  claudeAvatarText: string;
};

export type TemplateConfigInput = TemplateConfigV1 | TemplateConfigV2 | TemplateConfigV3;

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfigV3 = Object.freeze({
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

const V1_KEYS = ['schemaVersion', 'workspaceTitle', 'accentColor', 'workspaceTitleSize'];
const V2_KEYS = ['schemaVersion', 'shellType', 'workspaceTitle', 'accentColor', 'workspaceTitleSize', 'wechatContact', 'wechatAvatarText', 'wechatBubbleColor'];
const V3_KEYS = [...V2_KEYS, 'claudeTitle', 'claudeModel', 'claudeAvatarText'];
const hasOwn = (obj: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const hasExactKeys = (input: Record<string, unknown>, keys: string[]) => Object.keys(input).length === keys.length && keys.every((key) => hasOwn(input, key));
const bad = (): never => { throw new Error('BAD_TEMPLATE_CONFIG'); };

function normalizeBase(input: Record<string, unknown>) {
  const workspaceTitle = typeof input.workspaceTitle === 'string' ? input.workspaceTitle.trim() : '';
  if (workspaceTitle.length < 1 || workspaceTitle.length > 80) bad();
  if (typeof input.accentColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(input.accentColor)) bad();
  if (typeof input.workspaceTitleSize !== 'number' || !Number.isFinite(input.workspaceTitleSize)) bad();
  const workspaceTitleSize = Math.round(input.workspaceTitleSize);
  if (workspaceTitleSize < 18 || workspaceTitleSize > 40) bad();
  return { workspaceTitle, accentColor: input.accentColor.toUpperCase(), workspaceTitleSize };
}

function normalizeWechat(input: Record<string, unknown>) {
  const wechatContact = typeof input.wechatContact === 'string' ? input.wechatContact.trim() : '';
  if (wechatContact.length < 1 || wechatContact.length > 40) bad();
  const wechatAvatarText = typeof input.wechatAvatarText === 'string' ? input.wechatAvatarText.trim() : '';
  if (Array.from(wechatAvatarText).length < 1 || Array.from(wechatAvatarText).length > 2) bad();
  if (typeof input.wechatBubbleColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(input.wechatBubbleColor)) bad();
  return { wechatContact, wechatAvatarText, wechatBubbleColor: input.wechatBubbleColor.toUpperCase() };
}

function normalizeClaude(input: Record<string, unknown>) {
  const claudeTitle = typeof input.claudeTitle === 'string' ? input.claudeTitle.trim() : '';
  if (claudeTitle.length < 1 || claudeTitle.length > 60) bad();
  const claudeModel = typeof input.claudeModel === 'string' ? input.claudeModel.trim() : '';
  if (claudeModel.length < 1 || claudeModel.length > 40) bad();
  const claudeAvatarText = typeof input.claudeAvatarText === 'string' ? input.claudeAvatarText.trim() : '';
  if (Array.from(claudeAvatarText).length < 1 || Array.from(claudeAvatarText).length > 2) bad();
  return { claudeTitle, claudeModel, claudeAvatarText };
}

export function normalizeTemplateConfig(input: unknown, allowMissing = false): TemplateConfigV3 {
  if (input === null || input === undefined) {
    if (allowMissing) return DEFAULT_TEMPLATE_CONFIG;
    return bad();
  }
  if (typeof input !== 'object' || Array.isArray(input)) return bad();
  const value = input as Record<string, unknown>;
  if (value.schemaVersion === 1) {
    if (!hasExactKeys(value, V1_KEYS)) return bad();
    return { ...DEFAULT_TEMPLATE_CONFIG, ...normalizeBase(value) };
  }
  if (value.schemaVersion === 2) {
    if (!hasExactKeys(value, V2_KEYS)) return bad();
    if (value.shellType !== 'vscode' && value.shellType !== 'wechat') return bad();
    return {
      ...DEFAULT_TEMPLATE_CONFIG,
      shellType: value.shellType,
      ...normalizeBase(value),
      ...normalizeWechat(value),
    };
  }
  if (value.schemaVersion !== 3 || !hasExactKeys(value, V3_KEYS)) return bad();
  if (value.shellType !== 'vscode' && value.shellType !== 'wechat' && value.shellType !== 'claude') return bad();
  return {
    schemaVersion: 3,
    shellType: value.shellType,
    ...normalizeBase(value),
    ...normalizeWechat(value),
    ...normalizeClaude(value),
  };
}
