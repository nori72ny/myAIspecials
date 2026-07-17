import {
  assertQualityThreshold,
  evaluateAnswerQuality,
  type AnswerQualityFixture,
  type AnswerQualityResult,
} from './AnswerQualityEvaluation';

export interface AnswerQualityCase {
  fixture: AnswerQualityFixture;
  answer: string;
}

export interface AnswerQualityFailureRecord {
  fixtureId: string;
  score: number;
  minimumScore: number;
  failures: string[];
}

export interface AnswerQualitySuiteReport {
  schemaVersion: 1;
  total: number;
  passed: number;
  failed: number;
  averageScore: number;
  results: AnswerQualityResult[];
  failureRecords: AnswerQualityFailureRecord[];
}

export function createSanitizedFailureRecords(
  results: AnswerQualityResult[],
): AnswerQualityFailureRecord[] {
  return results
    .filter((result) => !result.passed)
    .map((result) => ({
      fixtureId: result.fixtureId,
      score: result.score,
      minimumScore: result.minimumScore,
      failures: [...result.failures],
    }));
}

export function runAnswerQualitySuite(cases: AnswerQualityCase[]): AnswerQualitySuiteReport {
  const results = cases.map(({ fixture, answer }) => evaluateAnswerQuality(fixture, answer));
  const passed = results.filter((result) => result.passed).length;
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);

  return {
    schemaVersion: 1,
    total: results.length,
    passed,
    failed: results.length - passed,
    averageScore: results.length === 0 ? 0 : Math.round(totalScore / results.length),
    results,
    failureRecords: createSanitizedFailureRecords(results),
  };
}

export function assertAnswerQualitySuite(report: AnswerQualitySuiteReport): void {
  assertQualityThreshold(report.results);
}
