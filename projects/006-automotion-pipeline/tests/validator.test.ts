import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SchemaValidator } from '../src/schemas/validator.js';

// 与 tests/fixtures/preflight-ok.schema.json 一致（Codex/Claude 探针共用夹具）
const PREFLIGHT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'message'],
  properties: {
    ok: { type: 'boolean', const: true },
    message: { type: 'string', const: 'automotion-preflight' },
  },
};

describe('SchemaValidator', () => {
  const validator = new SchemaValidator();

  it('accepts a conforming payload', () => {
    const result = validator.validate(PREFLIGHT_SCHEMA, { ok: true, message: 'automotion-preflight' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects wrong const values', () => {
    const result = validator.validate(PREFLIGHT_SCHEMA, { ok: false, message: 'automotion-preflight' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects missing required fields', () => {
    const result = validator.validate(PREFLIGHT_SCHEMA, { ok: true });
    expect(result.valid).toBe(false);
  });

  it('rejects additional properties', () => {
    const result = validator.validate(PREFLIGHT_SCHEMA, {
      ok: true,
      message: 'automotion-preflight',
      extra: 1,
    });
    expect(result.valid).toBe(false);
  });

  it('reports errors with instance paths', () => {
    const result = validator.validate(PREFLIGHT_SCHEMA, { ok: 'not-a-boolean', message: 'automotion-preflight' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('/ok'))).toBe(true);
  });

  it('正式 final-script schema 接受 shotcraft + card', () => {
    const schema = JSON.parse(readFileSync(join('schemas', 'final-script.schema.json'), 'utf8')) as object;
    const result = validator.validate(schema, {
      title: '组件联动验证',
      narration: ['镜头卡进入正式合同。'],
      storyboard: [{
        index: 1,
        visual: '镜头卡组件',
        narration_index: 0,
        type: 'shotcraft',
        theme: 'tech',
        card: 'Fracture',
      }],
      review_resolution: [],
    });
    expect(result.valid).toBe(true);
  });
});
