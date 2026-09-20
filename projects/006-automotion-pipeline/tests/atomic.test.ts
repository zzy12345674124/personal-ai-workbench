import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWriteFileSync } from '../src/fs/atomic.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'automotion-atomic-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('atomicWriteFileSync', () => {
  it('writes file and creates parent directories', () => {
    const target = join(tempDir(), 'nested', 'state.json');
    atomicWriteFileSync(target, '{"a":1}');
    expect(existsSync(target)).toBe(true);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ a: 1 });
  });

  it('leaves no temp files behind', () => {
    const dir = tempDir();
    atomicWriteFileSync(join(dir, 'x.txt'), 'hello');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('overwrites existing content', () => {
    const dir = tempDir();
    const target = join(dir, 'x.txt');
    atomicWriteFileSync(target, 'v1');
    atomicWriteFileSync(target, 'v2');
    expect(readFileSync(target, 'utf8')).toBe('v2');
  });
});
