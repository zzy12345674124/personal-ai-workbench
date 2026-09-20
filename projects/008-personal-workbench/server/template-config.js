// server/template-config.js —— 模板生产配置合同（TemplateConfigV3）校验与标准化
// 008 与 006 video/src/template-config.ts 共用同一合同。
// V1/V2 读取时自动补齐为 V3，已有 VS Code/微信运行快照无需手动迁移。

export const DEFAULT_TEMPLATE_CONFIG = Object.freeze({
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
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const hasExactKeys = (input, keys) => Object.keys(input).length === keys.length && keys.every((key) => hasOwn(input, key));
const bad = () => { throw new Error('BAD_TEMPLATE_CONFIG'); };

function normalizeBase(input) {
  const workspaceTitle = typeof input.workspaceTitle === 'string' ? input.workspaceTitle.trim() : '';
  if (workspaceTitle.length < 1 || workspaceTitle.length > 80) bad();
  if (typeof input.accentColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(input.accentColor)) bad();
  if (typeof input.workspaceTitleSize !== 'number' || !Number.isFinite(input.workspaceTitleSize)) bad();
  const workspaceTitleSize = Math.round(input.workspaceTitleSize);
  if (workspaceTitleSize < 18 || workspaceTitleSize > 40) bad();
  return { workspaceTitle, accentColor: input.accentColor.toUpperCase(), workspaceTitleSize };
}

function normalizeWechat(input) {
  const wechatContact = typeof input.wechatContact === 'string' ? input.wechatContact.trim() : '';
  if (wechatContact.length < 1 || wechatContact.length > 40) bad();
  const wechatAvatarText = typeof input.wechatAvatarText === 'string' ? input.wechatAvatarText.trim() : '';
  if (Array.from(wechatAvatarText).length < 1 || Array.from(wechatAvatarText).length > 2) bad();
  if (typeof input.wechatBubbleColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(input.wechatBubbleColor)) bad();
  return { wechatContact, wechatAvatarText, wechatBubbleColor: input.wechatBubbleColor.toUpperCase() };
}

function normalizeClaude(input) {
  const claudeTitle = typeof input.claudeTitle === 'string' ? input.claudeTitle.trim() : '';
  const claudeModel = typeof input.claudeModel === 'string' ? input.claudeModel.trim() : '';
  const claudeAvatarText = typeof input.claudeAvatarText === 'string' ? input.claudeAvatarText.trim() : '';
  if (claudeTitle.length < 1 || claudeTitle.length > 60) bad();
  if (claudeModel.length < 1 || claudeModel.length > 40) bad();
  if (Array.from(claudeAvatarText).length < 1 || Array.from(claudeAvatarText).length > 2) bad();
  return { claudeTitle, claudeModel, claudeAvatarText };
}

/** @returns {typeof DEFAULT_TEMPLATE_CONFIG} */
export function normalizeTemplateConfig(input, { allowMissing = false } = {}) {
  if (input === null || input === undefined) {
    if (allowMissing) return DEFAULT_TEMPLATE_CONFIG;
    bad();
  }
  if (typeof input !== 'object' || Array.isArray(input)) bad();

  if (input.schemaVersion === 1) {
    if (!hasExactKeys(input, V1_KEYS)) bad();
    return { ...DEFAULT_TEMPLATE_CONFIG, ...normalizeBase(input) };
  }
  if (input.schemaVersion === 2) {
    if (!hasExactKeys(input, V2_KEYS) || (input.shellType !== 'vscode' && input.shellType !== 'wechat')) bad();
    return { ...DEFAULT_TEMPLATE_CONFIG, shellType: input.shellType, ...normalizeBase(input), ...normalizeWechat(input) };
  }
  if (input.schemaVersion !== 3 || !hasExactKeys(input, V3_KEYS)) bad();
  if (!['vscode', 'wechat', 'claude'].includes(input.shellType)) bad();
  return {
    schemaVersion: 3,
    shellType: input.shellType,
    ...normalizeBase(input),
    ...normalizeWechat(input),
    ...normalizeClaude(input),
  };
}
