import { describe, expect, it } from 'vitest';
import { AGENT_BENCHMARK_CASES } from '../src/agent/benchmarkCases.js';
import { scoreBenchmark } from '../src/agent/benchmarkRunner.js';

describe('agent benchmark', () => {
  it('contains a 20-case suite', () => {
    expect(AGENT_BENCHMARK_CASES).toHaveLength(20);
  });
  it('requires the quality threshold to pass', () => {
    const outcomes = AGENT_BENCHMARK_CASES.map((c) => ({ caseId: c.id, status: 'success' as const }));
    expect(scoreBenchmark(AGENT_BENCHMARK_CASES, outcomes).passed).toBe(true);
    const failed = outcomes.map((o, i) => i < 17 ? o : { ...o, status: 'failure' as const });
    expect(scoreBenchmark(AGENT_BENCHMARK_CASES, failed).passed).toBe(false);
  });
});
