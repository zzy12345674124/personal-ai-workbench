// web/editor/editor-utils.js —— selector 生成与补丁生成纯函数（可单测，不依赖真实 DOM）
export function buildSelector(node, ancestors) {
  if (node.id) return `#${node.id}`;
  if (node.classes.length === 1) return `.${node.classes[0]}`;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.id) {
      // 最终审查 FIX-2：路径兜底带兄弟序号（nth-child N = index+1），同祖先多个同 tag 元素只改目标；
      // 无 index（非 toTree 生成的历史节点）时保持原兜底 `#祖先id > tag`
      return node.index != null ? `#${a.id} > ${node.tag}:nth-child(${node.index + 1})` : `#${a.id} > ${node.tag}`;
    }
  }
  return node.tag;
}

export function buildPatch(asset, name, edits) {
  return { asset, name, patches: edits };
}
