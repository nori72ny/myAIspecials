import { describe, expect, it } from 'vitest';
import { compareBenchmarkReports } from '../src/agent/benchmarkRegressionGate.js';
import type { BenchmarkReport } from '../src/agent/benchmarkRunner.js';

const report = (score: number, passed = score >= 0.9): BenchmarkReport => ({ total: 20, success: Math.floor(score * 20), partial: 0, failure: 20 - Math.floor(score * 20), score, passed, outcomes: [] });

describe('benchmark regression gate', () => {
  it('allows improvement and blocks regression', () => {
    expect(compareBenchmarkReports(report(0.9), report(0.95)).allowed).toBe(true);
    expect(compareBenchmarkReports(report(0.95), report(0.9)).allowed).toBe(false);
  });
  it('allows an unchanged passing score', () => {
    expect(compareBenchmarkReports(report(0.95), report(0.95))).toMatchObject({ allowed: true, reason: 'unchanged', delta: 0 });
  });
});
