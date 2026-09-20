// 浏览器侧 TemplateConfigV3 纯函数；校验逻辑镜像 server/template-config.js。
export const TEMPLATE_CONFIG_STORAGE_KEY = 'workbench.templateConfig.v3';
export const LEGACY_TEMPLATE_CONFIG_STORAGE_KEY = 'workbench.templateConfig.v2';
export const OLDEST_TEMPLATE_CONFIG_STORAGE_KEY = 'workbench.templateConfig.v1';
export const TEMPLATE_PRESETS_STORAGE_KEY = 'workbench.templatePresets.v1';

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

export const BUILTIN_TEMPLATE_PRESETS = Object.freeze([
  Object.freeze({
    id: 'builtin-vscode-classic',
    name: 'VS Code 经典蓝',
    builtin: true,
    config: DEFAULT_TEMPLATE_CONFIG,
  }),
  Object.freeze({
    id: 'builtin-claude-warm',
    name: 'Claude 暖白',
    builtin: true,
    config: Object.freeze({
      ...DEFAULT_TEMPLATE_CONFIG,
      shellType: 'claude',
      workspaceTitle: '复杂问题拆解',
      accentColor: '#D97757',
      claudeTitle: '项目讨论',
      claudeModel: 'Claude',
      claudeAvatarText: 'C',
    }),
  }),
  Object.freeze({
    id: 'builtin-wechat-green',
    name: '微信原生绿',
    builtin: true,
    config: Object.freeze({
      ...DEFAULT_TEMPLATE_CONFIG,
      shellType: 'wechat',
      workspaceTitle: '本地视频工作台',
      accentColor: '#07C160',
      wechatBubbleColor: '#95EC69',
    }),
  }),
]);

const PRESET_STORE_VERSION = 1;
const MAX_CUSTOM_PRESETS = 12;
const PRESET_STORE_KEYS = ['schemaVersion', 'items'];
const PRESET_KEYS = ['id', 'name', 'config'];

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

export function normalizeTemplateConfig(input) {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) bad();
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

export function parseStoredTemplateConfig(raw) {
  if (raw === null || raw === undefined) return { config: null, invalid: false };
  try {
    return { config: normalizeTemplateConfig(JSON.parse(raw)), invalid: false };
  } catch {
    return { config: null, invalid: true };
  }
}

export function serializeTemplateConfig(config) {
  return JSON.stringify(normalizeTemplateConfig(config));
}

function normalizeTemplatePreset(input) {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) bad();
  if (!hasExactKeys(input, PRESET_KEYS)) bad();
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || id.startsWith('builtin-')) bad();
  if (name.length < 1 || name.length > 30) bad();
  return { id, name, config: normalizeTemplateConfig(input.config) };
}

export function normalizeTemplatePresetStore(input) {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) bad();
  if (!hasExactKeys(input, PRESET_STORE_KEYS) || input.schemaVersion !== PRESET_STORE_VERSION || !Array.isArray(input.items)) bad();
  if (input.items.length > MAX_CUSTOM_PRESETS) bad();
  const items = input.items.map(normalizeTemplatePreset);
  if (new Set(items.map((item) => item.id)).size !== items.length) bad();
  return { schemaVersion: PRESET_STORE_VERSION, items };
}

export function parseStoredTemplatePresets(raw) {
  if (raw === null || raw === undefined) return { presets: [], invalid: false };
  try {
    return { presets: normalizeTemplatePresetStore(JSON.parse(raw)).items, invalid: false };
  } catch {
    return { presets: [], invalid: true };
  }
}

export function serializeTemplatePresets(presets) {
  return JSON.stringify(normalizeTemplatePresetStore({ schemaVersion: PRESET_STORE_VERSION, items: presets }));
}

export function upsertTemplatePreset(presets, preset) {
  const normalizedStore = normalizeTemplatePresetStore({ schemaVersion: PRESET_STORE_VERSION, items: presets });
  const normalizedPreset = normalizeTemplatePreset(preset);
  const index = normalizedStore.items.findIndex((item) => item.id === normalizedPreset.id);
  if (index >= 0) {
    return normalizedStore.items.map((item, itemIndex) => itemIndex === index ? normalizedPreset : item);
  }
  if (normalizedStore.items.length >= MAX_CUSTOM_PRESETS) bad();
  return [...normalizedStore.items, normalizedPreset];
}

export function removeTemplatePreset(presets, id) {
  const normalizedStore = normalizeTemplatePresetStore({ schemaVersion: PRESET_STORE_VERSION, items: presets });
  return normalizedStore.items.filter((item) => item.id !== id);
}
