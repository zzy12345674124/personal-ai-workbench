// tests/editor-tree.test.ts
import { describe, expect, it } from 'vitest';
import { filterCandidates, toTree, type NodeInfo } from '../web/editor/editor-tree.js';

const n = (tag: string, over: Partial<NodeInfo> = {}): NodeInfo => ({ tag, classes: [], text: '', style: '', children: [], ...over });

const flatten = (nodes: NodeInfo[]): NodeInfo[] => nodes.flatMap((x) => [x, ...flatten(x.children)]);

describe('filterCandidates', () => {
  it('保留有 id/class/文本/媒体/显式样式的节点，排除 script/空 div', () => {
    const nodes: NodeInfo[] = [
      n('div', { id: 'nav-home', text: '首页' }),
      n('span', { classes: ['menu-title'], text: '标题' }),
      n('div'),                                   // 空 div → 排除
      n('script', { text: 'var x=1' }),           // script → 排除
      n('img', { id: 'logo' }),                   // 媒体 → 保留
      n('p', { style: 'color:red', text: '正文' }),
    ];
    const out = filterCandidates(nodes);
    expect(out.map((x) => x.id ?? x.classes[0] ?? x.tag)).toEqual(['nav-home', 'menu-title', 'logo', 'p']);
  });

  it('递归过滤子节点', () => {
    const root = n('ul', { children: [n('li', { id: 'a', text: 'A' }), n('li')] });
    const out = filterCandidates([root]);
    expect(out[0].children.map((c) => c.id)).toEqual(['a']);
  });

  it('style-only / text-only 节点保留，link/meta 排除（deferred 补覆盖）', () => {
    const nodes: NodeInfo[] = [
      n('div', { style: 'color:red' }), // 仅显式样式 → 保留
      n('span', { text: '纯文本' }),     // 仅文本 → 保留
      n('link', { id: 'css' }),          // link → SKIP_TAGS 排除
      n('meta', { text: 'desc' }),       // meta → SKIP_TAGS 排除
    ];
    const out = filterCandidates(nodes);
    expect(out.map((x) => x.tag)).toEqual(['div', 'span']);
  });
});

describe('toTree', () => {
  it('从 DocumentLike 提取 NodeInfo（id/class/text/style）', () => {
    const fakeDoc = {
      querySelectorAll: () => [{
        tagName: 'DIV', id: 'x', className: 'a b', textContent: 'hi',
        getAttribute: (k: string) => (k === 'style' ? 'color:red' : null),
        children: [],
      }],
    };
    const tree = toTree(fakeDoc as unknown as Document);
    expect(tree[0]).toMatchObject({ tag: 'div', id: 'x', classes: ['a', 'b'], text: 'hi', style: 'color:red' });
  });

  it('children 记录兄弟序号 index（最终审查 FIX-2，供 nth-child 兜底）', () => {
    const liA = { tagName: 'LI', id: '', className: '', textContent: 'A', getAttribute: () => null, childNodes: [{}], children: [] };
    const liB = { tagName: 'LI', id: '', className: '', textContent: 'B', getAttribute: () => null, childNodes: [{}], children: [] };
    const ul = { tagName: 'UL', id: 'menu', className: '', textContent: '', getAttribute: () => null, childNodes: [{}, {}], children: [liA, liB] };
    const fakeDoc = { querySelectorAll: (sel: string) => (sel === 'body > *' ? [ul] : []) };
    const tree = toTree(fakeDoc as unknown as Document);
    expect(tree[0].children.map((c) => c.index)).toEqual([0, 1]); // 原始 DOM 兄弟序号
  });

  it('只取 body 直接子元素为顶层，组合 filterCandidates 后扁平化无重复（防 I-1 回归）', () => {
    const inner = { tagName: 'SPAN', id: 'inner', className: '', textContent: 'I', getAttribute: () => null, childNodes: [{}], children: [] };
    const top = { tagName: 'DIV', id: 'top', className: '', textContent: 'T', getAttribute: () => null, childNodes: [{}, {}], children: [inner] };
    const solo = { tagName: 'P', id: 'solo', className: '', textContent: 'S', getAttribute: () => null, childNodes: [{}], children: [] };
    // fake 模拟真实选择器语义：'body > *' 只返回直接子元素，'body *' 返回全量后代
    const fakeDoc = {
      querySelectorAll: (sel: string) => (sel === 'body > *' ? [top, solo] : [top, inner, solo]),
    };
    const tree = toTree(fakeDoc as unknown as Document);
    expect(tree.map((x) => x.id)).toEqual(['top', 'solo']); // 顶层条目 = body 直接子元素
    const filtered = filterCandidates(tree);
    const ids = flatten(filtered).map((x) => x.id).sort();
    expect(ids).toEqual(['inner', 'solo', 'top']); // 嵌套经 children 表达，且无重复
    expect(new Set(ids).size).toBe(ids.length);
  });
});
