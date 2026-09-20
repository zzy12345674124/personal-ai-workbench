import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const changelog = JSON.parse(readFileSync(join(import.meta.dirname, '../web/changelog.json'), 'utf8'));

describe('工作台更新日志', () => {
  it('把 v1.5.0 置于首位并保留唯一的语义化版本号', () => {
    expect(changelog.versions[0]).toMatchObject({ version: '1.5.0', date: '2026-08-24' });
    const versions = changelog.versions.map((item: { version: string }) => item.version);
    expect(new Set(versions).size).toBe(versions.length);
    versions.forEach((version: string) => expect(version).toMatch(/^\d+\.\d+\.\d+$/));
  });
});
