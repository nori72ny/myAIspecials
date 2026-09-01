import { describe, expect, it } from 'vitest';
import { runAgentBenchmark, summarizeBenchmark } from '../src/agent/agentBenchmark.js';

describe('agent benchmark', () => {
  it('caps benchmark execution at 20 cases and records outcomes', async () => {
    const cases = Array.from({ length: 25 }, (_, i) => ({ id: String(i), category: 'core', run: async () => 'success' as const }));
    const results = await runAgentBenchmark(cases);
    expect(results).toHaveLength(20);
    expect(summarizeBenchmark(results).successRate).toBe(1);
  });

  it('classifies thrown cases as failures without aborting the suite', async () => {
    const results = await runAgentBenchmark([
      { id: 'ok', category: 'core', run: async () => 'success' as const },
      { id: 'bad', category: 'safety', run: async () => { throw new Error('boom'); } },
    ]);
    expect(results.map((r) => r.outcome)).toEqual(['success', 'failure']);
    expect(summarizeBenchmark(results)).toMatchObject({ total: 2, success: 1, failure: 1 });
  });
});
