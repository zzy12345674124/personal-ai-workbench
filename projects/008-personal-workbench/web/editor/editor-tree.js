// web/editor/editor-tree.js —— 候选树纯函数（可单测，不依赖真实 DOM）
const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'head', 'noscript']);
const MEDIA_TAGS = new Set(['img', 'video', 'canvas', 'svg']);

export function filterCandidates(nodes) {
  const walk = (list) => list.flatMap((node) => {
    if (SKIP_TAGS.has(node.tag)) return [];
    const meaningful =
      Boolean(node.id) || node.classes.length > 0 || Boolean(node.text.trim()) ||
      MEDIA_TAGS.has(node.tag) || Boolean(node.style);
    const children = walk(node.children);
    if (!meaningful && children.length === 0) return [];
    return [{ ...node, children }];
  });
  return walk(nodes);
}

export function toTree(doc) {
  // 最终审查 FIX-2：children.map 记录兄弟序号 index（原始 DOM 顺序；filterCandidates 过滤后保留原值），
  // 供 buildSelector 路径兜底生成 `#祖先id > tag:nth-child(N)`——同祖先多个同 tag 元素可唯一区分。
  const convert = (el) => ({
    tag: (el.tagName ?? '').toLowerCase(),
    id: el.id || undefined,
    classes: typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : [],
    text: (el.childNodes ?? []).length <= 1 ? (el.textContent ?? '').trim() : '',
    style: el.getAttribute?.('style') ?? '',
    children: Array.from(el.children ?? []).map((c, i) => ({ ...convert(c), index: i })),
  });
  // 2026-08-08 审查 I-1：只遍历 body 直接子元素作为顶层条目（嵌套关系由 children 递归表达，
// 每个节点唯一）；若用 'body *' 全量后代，每个元素既作顶层又嵌在祖先 children 里，
// filterCandidates(toTree(doc)) 组合后会产生重复候选。
return Array.from(doc.querySelectorAll?.('body > *') ?? []).map(convert);
}
