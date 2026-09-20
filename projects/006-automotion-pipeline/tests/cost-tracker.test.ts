import { describe, expect, it } from 'vitest';
import { CostTracker, type CostEntry } from '../src/cost/cost-tracker.js';

describe('CostTracker', () => {
  it('accumulates totals across entries', () => {
    const tracker = new CostTracker();
    tracker.add({ runId: 'r1', stage: 'codex_draft', model: 'gpt-5.6-sol', inputTokens: 1000, outputTokens: 500, costUsd: 0.05 });
    tracker.add({ runId: 'r1', stage: 'flash_challenge', model: 'deepseek-v4-flash', inputTokens: 2000, outputTokens: 300, costUsd: 0.03 });
    expect(tracker.totalUsd()).toBeCloseTo(0.08, 6);
  });

  it('aggregates by model', () => {
    const tracker = new CostTracker();
    tracker.add({ runId: 'r1', stage: 'a', model: 'm1', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    tracker.add({ runId: 'r1', stage: 'b', model: 'm1', inputTokens: 200, outputTokens: 100, costUsd: 0.02 });
    tracker.add({ runId: 'r1', stage: 'c', model: 'm2', inputTokens: 10, outputTokens: 5, costUsd: 0 });
    const byModel = tracker.byModel();
    expect(byModel['m1']).toEqual({ calls: 2, inputTokens: 300, outputTokens: 150, costUsd: 0.03 });
    expect(byModel['m2']).toEqual({ calls: 1, inputTokens: 10, outputTokens: 5, costUsd: 0 });
  });

  it('round-trips through toJSON/load', () => {
    const tracker = new CostTracker();
    tracker.add({ runId: 'r1', stage: 'a', model: 'm1', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    const restored = new CostTracker();
    restored.load(tracker.toJSON() as CostEntry[]);
    expect(restored.totalUsd()).toBeCloseTo(0.01, 6);
    expect(restored.toJSON()[0]?.model).toBe('m1');
  });
});
