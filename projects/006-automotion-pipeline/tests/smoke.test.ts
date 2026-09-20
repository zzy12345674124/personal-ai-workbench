import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';

// 与 tests/fixtures/preflight-ok.schema.json 一致的内联 Schema（Codex/Claude 探针共用）
const PREFLIGHT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'message'],
  properties: {
    ok: { type: 'boolean', const: true },
    message: { type: 'string', const: 'automotion-preflight' },
  },
} as const;

describe('harness toolchain smoke', () => {
  it('vitest + tsx run correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('ajv validates the preflight schema', () => {
    const ajv = new Ajv();
    const validate = ajv.compile(PREFLIGHT_SCHEMA);
    expect(validate({ ok: true, message: 'automotion-preflight' })).toBe(true);
    expect(validate({ ok: false, message: 'automotion-preflight' })).toBe(false);
    expect(validate({ ok: true, message: 'other' })).toBe(false);
    expect(validate({ ok: true })).toBe(false);
    expect(validate({ ok: true, message: 'automotion-preflight', extra: 1 })).toBe(false);
  });
});
