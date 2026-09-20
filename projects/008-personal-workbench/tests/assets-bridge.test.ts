// tests/assets-bridge.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createAssetsBridge } from '../server/bridges/assets.js';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ab-'));
  mkdirSync(join(root, 'radial-menu'));
  mkdirSync(join(root, 'menu-nav'));
  writeFileSync(join(root, 'radial-menu', 'index.html'), '<html>radial</html>');
  // 第三档：radial-menu 声明参数 schema；menu-nav 不声明（验证缺省为空数组）
  writeFileSync(join(root, 'radial-menu', 'params.json'), JSON.stringify({
    params: [
      { key: 'speed', label: '速度', type: 'number', default: '1', min: 0.1, max: 5, desc: '倍率' },
      { key: 'auto', label: '自动演示', type: 'bool', default: 'true' },
      { key: 'bad', label: '非法类型', type: 'weird' },
      { key: '', label: '空 key', type: 'text' },
    ],
  }));
  writeFileSync(join(root, 'README.md'), '# 素材库\n- radial-menu');
  // 前缀兄弟目录（baseDir 名 + 'evil'）：用于验证白名单检查按分隔符锚定，同名前缀目录不可绕过
  const evilDir = join(tmpdir(), basename(root) + 'evil');
  mkdirSync(evilDir);
  writeFileSync(join(evilDir, 'secret.txt'), 'top-secret');
  return root;
}

describe('assets bridge', () => {
  it('list 返回目录清单', () => {
    const b = createAssetsBridge(makeFixture());
    const list = b.list();
    expect(list.dirs.map((d) => d.name).sort()).toEqual(['menu-nav', 'radial-menu']);
  });
  it('list 的 dirs 含 indexHtml 字段（Task 9）', () => {
    const b = createAssetsBridge(makeFixture());
    const list = b.list();
    // fixture 中 radial-menu 有 index.html、menu-nav 没有
    // 偏离说明：brief 的 `list.dirs[0].indexHtml === true` 依赖 readdirSync 返回顺序
    //   （本机实测 menu-nav 在前），故改用按名查找的确定性断言
    const menuNav = list.dirs.find((d) => d.name === 'menu-nav');
    const radial = list.dirs.find((d) => d.name === 'radial-menu');
    expect(radial.indexHtml).toBe(true);
    expect(menuNav.indexHtml).toBe(false);
  });
  it('list 返回素材声明的参数 schema（第三档）；未声明素材为空数组', () => {
    const b = createAssetsBridge(makeFixture());
    const radial = b.list().dirs.find((d) => d.name === 'radial-menu');
    const menuNav = b.list().dirs.find((d) => d.name === 'menu-nav');
    expect(radial.params).toEqual([
      { key: 'speed', label: '速度', type: 'number', default: '1', min: 0.1, max: 5, desc: '倍率' },
      { key: 'auto', label: '自动演示', type: 'bool', default: 'true', desc: '' },
      { key: 'bad', label: '非法类型', type: 'text', default: '', desc: '' }, // 非法 type 宽容降级 text（不丢弃参数）
    ]); // 空 key 被过滤——4 条里只剩 3 条
    expect(menuNav.params).toEqual([]);
  });
  it('损坏的 params.json 不阻断素材列表（返回空 schema）', () => {
    const root = mkdtempSync(join(tmpdir(), 'ab-'));
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'params.json'), '{ 不是JSON');
    const b = createAssetsBridge(root);
    expect(b.list().dirs.find((d) => d.name === 'broken').params).toEqual([]);
  });
  it('preview 白名单：目录内文件可解析，目录外被拒', () => {
    const b = createAssetsBridge(makeFixture());
    expect(b.resolvePreview('radial-menu/index.html')).toContain('radial-menu');
    expect(() => b.resolvePreview('../../secret.txt')).toThrow();
    expect(() => b.resolvePreview('nope/x.html')).toThrow();
  });
  it('preview 白名单：同名前缀兄弟目录被拒', () => {
    const b = createAssetsBridge(makeFixture());
    const evilRel = '../' + basename(b.baseDir) + 'evil/secret.txt';
    expect(() => b.resolvePreview(evilRel)).toThrow('FORBIDDEN');
  });
});
