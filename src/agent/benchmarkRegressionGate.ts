import type { BenchmarkReport } from './benchmarkRunner.js';

export type RegressionDecision = { allowed: boolean; reason: 'initial' | 'improved' | 'unchanged' | 'regressed' | 'insufficient-baseline'; delta: number };

export function compareBenchmarkReports(previous: BenchmarkReport | null, current: BenchmarkReport): RegressionDecision {
  if (!previous) return { allowed: current.passed, reason: 'initial', delta: current.score };
  if (!previous.total || !current.total) return { allowed: false, reason: 'insufficient-baseline', delta: 0 };
  const delta = current.score - previous.score;
  if (!current.passed) return { allowed: false, reason: 'regressed', delta };
  if (delta > 0) return { allowed: true, reason: 'improved', delta };
  if (delta === 0) return { allowed: true, reason: 'unchanged', delta };
  return { allowed: false, reason: 'regressed', delta };
}
