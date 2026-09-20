export interface CostEntry {
  timestamp: string;
  runId: string;
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** 该次调用的估算费用（美元）；免费调用记 0 */
  costUsd: number;
}

/** 运行成本统计：记录模型名、用量与费用，可序列化到运行记录（规格 §3.3/§11） */
export class CostTracker {
  private entries: CostEntry[] = [];

  add(entry: Omit<CostEntry, 'timestamp'>): void {
    this.entries.push({ ...entry, timestamp: new Date().toISOString() });
  }

  totalUsd(): number {
    return this.entries.reduce((sum, e) => sum + e.costUsd, 0);
  }

  byModel(): Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }> {
    const result: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }> = {};
    for (const e of this.entries) {
      const key = e.model;
      const acc = (result[key] ??= { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
      acc.calls += 1;
      acc.inputTokens += e.inputTokens;
      acc.outputTokens += e.outputTokens;
      acc.costUsd += e.costUsd;
    }
    return result;
  }

  toJSON(): CostEntry[] {
    return [...this.entries];
  }

  load(entries: CostEntry[]): void {
    this.entries = [...entries];
  }
}
