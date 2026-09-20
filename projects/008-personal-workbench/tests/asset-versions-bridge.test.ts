import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAssetVersionsBridge } from '../server/bridges/asset-versions.js';

describe('asset versions bridge', () => {
  it('saveVersion 落盘 + listVersions 返回 + renameVersion + deleteVersion', () => {
    const dir = mkdtempSync(join(tmpdir(), 'av-'));
    const b = createAssetVersionsBridge({ versionsDir: dir });
    const v = b.saveVersion('menu-nav', '定制 1', [{ selector: '#a', prop: 'textContent', value: 'x' }]);
    expect(v.id).toMatch(/^\d{4}-\d{2}-\d{2}-定制-\d+$/);
    expect(existsSync(join(dir, 'menu-nav', `${v.id}.json`))).toBe(true);
    const list = b.listVersions('menu-nav');
    expect(list).toHaveLength(1);
    expect(list[0].patches[0].selector).toBe('#a');
    expect(b.renameVersion('menu-nav', v.id, '我的导航')).toBe(true);
    expect(b.listVersions('menu-nav')[0].name).toBe('我的导航');
    expect(b.deleteVersion('menu-nav', v.id)).toBe(true);
    expect(b.listVersions('menu-nav')).toHaveLength(0);
  });

  it('非法 asset 名拒绝（防穿越）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'av-'));
    const b = createAssetVersionsBridge({ versionsDir: dir });
    expect(() => b.saveVersion('../evil', 'n', [])).toThrow();
    expect(() => b.listVersions('../evil')).toThrow();
  });

  it('非法 id 拒绝（rename/delete 防穿越，审查 I-2）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'av-'));
    const b = createAssetVersionsBridge({ versionsDir: dir });
    expect(() => b.renameVersion('menu-nav', '../x', 'n')).toThrow();
    expect(() => b.deleteVersion('menu-nav', '../x')).toThrow();
  });

  it('删中间版本后保存不复用 id（最终审查 FIX-1）：A/B/C → 删 B → D 后缀=4 且 C 仍存在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'av-'));
    const b = createAssetVersionsBridge({ versionsDir: dir });
    const A = b.saveVersion('menu-nav', 'A', []);
    const B = b.saveVersion('menu-nav', 'B', []);
    const C = b.saveVersion('menu-nav', 'C', []);
    expect(A.id.endsWith('-定制-1')).toBe(true);
    expect(B.id.endsWith('-定制-2')).toBe(true);
    expect(C.id.endsWith('-定制-3')).toBe(true);
    expect(b.deleteVersion('menu-nav', B.id)).toBe(true);
    const D = b.saveVersion('menu-nav', 'D', []);
    expect(D.id.endsWith('-定制-4')).toBe(true); // 不复用 B 的 2，也不撞 A/C 现存文件
    expect(existsSync(join(dir, 'menu-nav', `${C.id}.json`))).toBe(true); // C 文件未被覆盖
    expect(existsSync(join(dir, 'menu-nav', `${D.id}.json`))).toBe(true);
    expect(b.listVersions('menu-nav').map((v) => v.name)).toEqual(['A', 'C', 'D']); // 列表 3 条
  });

  it('renameVersion 空名拒绝（deferred M-1）：非字符串/空白 → false 且不落盘', () => {
    const dir = mkdtempSync(join(tmpdir(), 'av-'));
    const b = createAssetVersionsBridge({ versionsDir: dir });
    const v = b.saveVersion('menu-nav', '原名', []);
    expect(b.renameVersion('menu-nav', v.id, '')).toBe(false);
    expect(b.renameVersion('menu-nav', v.id, '   ')).toBe(false);
    expect(b.renameVersion('menu-nav', v.id, null)).toBe(false);
    expect(b.renameVersion('menu-nav', v.id, 42)).toBe(false);
    expect(b.listVersions('menu-nav')[0].name).toBe('原名'); // 未被改写
  });

  it('损坏的版本文件 rename 返回 false 不抛错（deferred M-4）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'av-'));
    const b = createAssetVersionsBridge({ versionsDir: dir });
    const v = b.saveVersion('menu-nav', 'A', []);
    writeFileSync(join(dir, 'menu-nav', `${v.id}.json`), '{ 不是JSON', 'utf8'); // 人为损坏
    expect(b.renameVersion('menu-nav', v.id, '新名')).toBe(false);
    expect(b.renameVersion('menu-nav', v.id, '新名')).toBe(false); // 二次调用也不抛
    // 损坏文件 listVersions 已容错（跳过坏文件），不抛错
    expect(b.listVersions('menu-nav')).toHaveLength(0);
  });
});
