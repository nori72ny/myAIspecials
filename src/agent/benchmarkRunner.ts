import type { BenchmarkCase } from './benchmarkCases.js';

export type BenchmarkOutcome = { caseId: string; status: 'success' | 'partial' | 'failure'; detail?: string };
export type BenchmarkReport = { total: number; success: number; partial: number; failure: number; score: number; passed: boolean; outcomes: BenchmarkOutcome[] };

export function scoreBenchmark(cases: readonly BenchmarkCase[], outcomes: readonly BenchmarkOutcome[], minimumScore = 0.9): BenchmarkReport {
  const expectedIds = new Set(cases.map((benchmarkCase) => benchmarkCase.id));
  const seenIds = new Set<string>();
  for (const outcome of outcomes) {
    if (!expectedIds.has(outcome.caseId)) throw new Error(`BENCHMARK_UNKNOWN_CASE:${outcome.caseId}`);
    if (seenIds.has(outcome.caseId)) throw new Error(`BENCHMARK_DUPLICATE_CASE:${outcome.caseId}`);
    seenIds.add(outcome.caseId);
  }

  const normalizedOutcomes: BenchmarkOutcome[] = cases.map((benchmarkCase) => {
    const outcome = outcomes.find((item) => item.caseId === benchmarkCase.id);
    return outcome ?? { caseId: benchmarkCase.id, status: 'failure', detail: 'Missing benchmark outcome' };
  });

  const success = normalizedOutcomes.filter((o) => o.status === 'success').length;
  const partial = normalizedOutcomes.filter((o) => o.status === 'partial').length;
  const failure = normalizedOutcomes.filter((o) => o.status === 'failure').length;
  const total = cases.length;
  const score = total === 0 ? 0 : (success + partial * 0.5) / total;
  return { total, success, partial, failure, score, passed: total > 0 && score >= minimumScore, outcomes: normalizedOutcomes };
}
