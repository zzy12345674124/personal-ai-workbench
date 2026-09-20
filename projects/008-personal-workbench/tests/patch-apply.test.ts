// tests/patch-apply.test.ts
import { describe, expect, it } from 'vitest';
import { applyPatches } from '../web/editor/patch-apply.js';

function fakeDoc(elements: Record<string, { text?: string; style?: Record<string, string>; attr?: Record<string, string> }>) {
  return {
    querySelector(sel: string) {
      const e = elements[sel];
      if (!e) return null;
      e.style ??= {}; // 共享 style/attr 对象：applyPatches 写入与断言读取须同一引用（否则断言读到空快照）
      return {
        // 真实 DOM 的 textContent 是活属性：用 getter/setter 回写 e.text，否则赋值在快照上丢失
        get textContent() { return e.text ?? ''; },
        set textContent(v) { e.text = v; },
        style: e.style,
        get attr() { return e.attr; },
        setAttribute: (k: string, v: string) => { (e.attr ??= {})[k] = v; },
      };
    },
  };
}

describe('applyPatches', () => {
  it('应用 textContent 与 style 补丁；找不到的 selector 记入 skipped', () => {
    const doc = fakeDoc({ '#a': { text: '旧' }, '.bar': { style: { background: '#000' } } });
    const r = applyPatches(doc as unknown as Document, [
      { selector: '#a', prop: 'textContent', value: '新' },
      { selector: '.bar', prop: 'background', value: '#FFB347' },
      { selector: '#missing', prop: 'textContent', value: 'x' },
    ]);
    expect(r.applied).toBe(2);
    expect(r.skipped).toEqual(['#missing']);
    expect((doc as any).querySelector('#a').textContent).toBe('新');
    expect((doc as any).querySelector('.bar').style.background).toBe('#FFB347');
  });

  it('style.* 显式前缀写 style；id/data-* 走 setAttribute（deferred 补覆盖）', () => {
    const doc = fakeDoc({ '#a': {}, '#b': {}, '#c': {} });
    const r = applyPatches(doc as unknown as Document, [
      { selector: '#a', prop: 'style.color', value: '#ff0' }, // 显式前缀分支
      { selector: '#b', prop: 'id', value: 'renamed' },       // 非 style 属性 → setAttribute
      { selector: '#c', prop: 'data-x', value: '42' },        // 非 style 属性 → setAttribute
    ]);
    expect(r.applied).toBe(3);
    expect((doc as any).querySelector('#a').style.color).toBe('#ff0');
    expect((doc as any).querySelector('#b').attr.id).toBe('renamed');
    expect((doc as any).querySelector('#c').attr['data-x']).toBe('42');
  });
});
