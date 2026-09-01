export type BenchmarkOutcome = 'success' | 'partial' | 'failure';
export type BenchmarkCase = { id: string; category: string; run: () => Promise<BenchmarkOutcome> };
export type BenchmarkResult = { id: string; category: string; outcome: BenchmarkOutcome };

const MAX_CASES = 20;

export async function runAgentBenchmark(cases: BenchmarkCase[]): Promise<BenchmarkResult[]> {
  if (cases.length === 0) return [];
  const selected = cases.slice(0, MAX_CASES);
  const results: BenchmarkResult[] = [];
  for (const testCase of selected) {
    let outcome: BenchmarkOutcome;
    try { outcome = await testCase.run(); } catch { outcome = 'failure'; }
    results.push({ id: testCase.id, category: testCase.category, outcome });
  }
  return results;
}

export function summarizeBenchmark(results: BenchmarkResult[]) {
  const total = results.length;
  const success = results.filter((r) => r.outcome === 'success').length;
  const partial = results.filter((r) => r.outcome === 'partial').length;
  const failure = total - success - partial;
  return { total, success, partial, failure, successRate: total === 0 ? 0 : success / total };
}
