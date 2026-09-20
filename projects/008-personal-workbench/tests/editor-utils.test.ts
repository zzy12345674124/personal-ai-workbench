import { describe, expect, it } from 'vitest';
import { buildSelector, buildPatch } from '../web/editor/editor-utils.js';

describe('buildSelector', () => {
  it('优先 id，其次 class，最后路径', () => {
    expect(buildSelector({ tag: 'div', id: 'nav', classes: [], text: '', style: '', children: [] }, [])).toBe('#nav');
    expect(buildSelector({ tag: 'span', classes: ['menu-title'], id: undefined, text: '', style: '', children: [] }, [])).toBe('.menu-title');
    const root = { tag: 'ul', id: 'menu', classes: [], text: '', style: '', children: [] };
    const li = { tag: 'li', classes: [], text: '首页', style: '', children: [] };
    expect(buildSelector(li, [root])).toBe('#menu > li');
  });

  it('路径兜底带兄弟序号（最终审查 FIX-2）：同祖先两 li 用 nth-child 区分', () => {
    const root = { tag: 'ul', id: 'menu', classes: [], text: '', style: '', children: [] };
    const li0 = { tag: 'li', classes: [], text: 'A', style: '', children: [], index: 0 };
    const li1 = { tag: 'li', classes: [], text: 'B', style: '', children: [], index: 1 };
    expect(buildSelector(li1, [root])).toBe('#menu > li:nth-child(2)'); // 第二个 li → N = index+1
    expect(buildSelector(li0, [root])).toBe('#menu > li:nth-child(1)');
  });

  it('多 class 节点不走 class 短路（classes.length>1）→ 落祖先路径兜底（deferred 补覆盖）', () => {
    const root = { tag: 'ul', id: 'menu', classes: [], text: '', style: '', children: [] };
    const li = { tag: 'li', classes: ['a', 'b'], text: '', style: '', children: [], index: 2 };
    expect(buildSelector(li, [root])).toBe('#menu > li:nth-child(3)');
  });

  it('无 id/class 且无有 id 祖先 → 裸 tag 兜底（deferred 补覆盖）', () => {
    expect(buildSelector({ tag: 'div', classes: [], text: '', style: '', children: [] }, [])).toBe('div');
    const bare = { tag: 'p', classes: [], text: 'x', style: '', children: [] };
    const anon = { tag: 'section', classes: [], text: '', style: '', children: [] };
    expect(buildSelector(bare, [anon])).toBe('p'); // 祖先也无 id → 裸 tag
  });
});

describe('buildPatch', () => {
  it('生成 {asset, name, patches}', () => {
    const p = buildPatch('menu-nav', '我的导航', [{ selector: '#a', prop: 'textContent', value: 'x' }]);
    expect(p).toEqual({ asset: 'menu-nav', name: '我的导航', patches: [{ selector: '#a', prop: 'textContent', value: 'x' }] });
  });
});
