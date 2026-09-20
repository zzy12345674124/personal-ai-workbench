// web/editor/patch-apply.js —— 补丁应用（渲染注入与预览共用，纯函数可单测）
// 语义：textContent 直接赋值；`style.X` 写 style；裸 CSS 属性名（style 上存在者）也写 style；
// 其余属性走 setAttribute。selector 找不到 → 记入 skipped 不抛错。
export function applyPatches(doc, patches) {
  let applied = 0;
  const skipped = [];
  for (const p of patches ?? []) {
    const el = doc.querySelector(p.selector);
    if (!el) { skipped.push(p.selector); continue; }
    if (p.prop === 'textContent') {
      el.textContent = p.value;
    } else if (p.prop.startsWith('style.')) {
      el.style[p.prop.slice(6)] = p.value;
    } else if (el.style && p.prop in el.style) {
      // 裸 CSS 属性名（如 `background`）直接写 style；非样式属性（id/data-* 等）落到 setAttribute
      el.style[p.prop] = p.value;
    } else {
      el.setAttribute(p.prop, p.value);
    }
    applied++;
  }
  return { applied, skipped };
}
