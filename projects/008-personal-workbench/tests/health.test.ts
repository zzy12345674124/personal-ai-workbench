// tests/health.test.ts
import { describe, expect, it } from 'vitest';

describe('bootstrap', () => {
  it('npm test 可用', () => {
    expect(typeof describe).toBe('function');
  });
});
