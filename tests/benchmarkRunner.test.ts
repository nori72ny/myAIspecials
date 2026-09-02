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

  it('does not allow duplicate or unknown cases to inflate the score', () => {
    const first = AGENT_BENCHMARK_CASES[0].id;
    expect(() => scoreBenchmark(AGENT_BENCHMARK_CASES, [
      { caseId: first, status: 'success' },
      { caseId: first, status: 'success' },
    ])).toThrow(`BENCHMARK_DUPLICATE_CASE:${first}`);
    expect(() => scoreBenchmark(AGENT_BENCHMARK_CASES, [
      { caseId: 'not-a-real-case', status: 'success' },
    ])).toThrow('BENCHMARK_UNKNOWN_CASE:not-a-real-case');
  });

  it('treats missing cases as failures instead of silently shrinking the denominator', () => {
    const report = scoreBenchmark(AGENT_BENCHMARK_CASES, [
      { caseId: AGENT_BENCHMARK_CASES[0].id, status: 'success' },
    ]);
    expect(report.total).toBe(20);
    expect(report.success).toBe(1);
    expect(report.failure).toBe(19);
    expect(report.passed).toBe(false);
  });
});
