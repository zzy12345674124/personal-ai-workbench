import { describe, expect, it } from 'vitest';
import { normalizeManifestEntry, resolveManifestPaths } from '../scripts/sync-007-assets.js';

describe('007 → 006 portable manifest 合同', () => {
  const projectRoot = 'D:/workspace/project_006';
  const vibeRoot = 'D:/workspace/project_007/vibe-motion-app';

  it('静态素材只允许进入 006 根 public', () => {
    const result = resolveManifestPaths(projectRoot, vibeRoot, {
      from: 'public/img/claude.svg',
      to: 'public/img/claude.svg',
      type: 'static',
    });
    expect(result.src.replaceAll('\\', '/')).toBe('D:/workspace/project_007/vibe-motion-app/public/img/claude.svg');
    expect(result.dst.replaceAll('\\', '/')).toBe('D:/workspace/project_006/public/img/claude.svg');
    expect(() => resolveManifestPaths(projectRoot, vibeRoot, {
      from: 'public/img/claude.svg', to: 'video/public/img/claude.svg', type: 'static',
    })).toThrow('MANIFEST_TARGET_NOT_ALLOWED');
  });

  it('组件只登记到 video/src，仍由人工移植', () => {
    expect(resolveManifestPaths(projectRoot, vibeRoot, {
      from: 'motion/Foo.tsx', to: 'video/src/portable/Foo.tsx', type: 'component',
    }).entry.type).toBe('component');
    expect(() => resolveManifestPaths(projectRoot, vibeRoot, {
      from: 'motion/Foo.tsx', to: 'public/Foo.tsx', type: 'component',
    })).toThrow('MANIFEST_TARGET_NOT_ALLOWED');
  });

  it('拒绝路径穿越、未知类型和合同外字段', () => {
    expect(() => resolveManifestPaths(projectRoot, vibeRoot, {
      from: '../secret.txt', to: 'public/secret.txt', type: 'static',
    })).toThrow('MANIFEST_PATH_OUTSIDE_ROOT');
    expect(() => resolveManifestPaths(projectRoot, vibeRoot, {
      from: 'public/a.txt', to: '../outside.txt', type: 'static',
    })).toThrow('MANIFEST_PATH_OUTSIDE_ROOT');
    expect(() => normalizeManifestEntry({ from: 'a', to: 'b', type: 'other' })).toThrow('MANIFEST_ENTRY_INVALID');
    expect(() => normalizeManifestEntry({ from: 'a', to: 'b', type: 'static', extra: true })).toThrow('MANIFEST_ENTRY_INVALID');
  });
});
