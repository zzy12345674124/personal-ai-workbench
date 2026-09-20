import { Ajv, type ErrorObject } from 'ajv';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** ajv 包装：本地 Schema 校验，不依赖模型自觉遵守格式（规格 §8） */
export class SchemaValidator {
  private readonly ajv: Ajv;

  constructor() {
    // 当前 Schema 只用 const/type/additionalProperties，无需 formats 插件；
    // 未来若引入 format 校验再按需加载
    this.ajv = new Ajv({ allErrors: true, strict: false });
  }

  validate<T = unknown>(schema: object, data: unknown): ValidationResult {
    const validate = this.ajv.compile(schema);
    const valid = validate(data) as boolean;
    if (valid) return { valid: true, errors: [] };
    return { valid: false, errors: formatErrors(validate.errors ?? []) };
  }
}

function formatErrors(errors: ErrorObject[]): string[] {
  return errors.map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
}
