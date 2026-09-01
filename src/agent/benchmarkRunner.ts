import type { BenchmarkCase } from './benchmarkCases.js';

export type BenchmarkOutcome = { caseId: string; status: 'success' | 'partial' | 'failure'; detail?: string };
export type BenchmarkReport = { total: number; success: number; partial: number; failure: number; score: number; passed: boolean; outcomes: BenchmarkOutcome[] };

export function scoreBenchmark(cases: readonly BenchmarkCase[], outcomes: readonly BenchmarkOutcome[], minimumScore = 0.9): BenchmarkReport {
  const success = outcomes.filter((o) => o.status === 'success').length;
  const partial = outcomes.filter((o) => o.status === 'partial').length;
  const failure = outcomes.filter((o) => o.status === 'failure').length;
  const total = cases.length;
  const score = total === 0 ? 0 : (success + partial * 0.5) / total;
  return { total, success, partial, failure, score, passed: total > 0 && score >= minimumScore, outcomes: [...outcomes] };
}
