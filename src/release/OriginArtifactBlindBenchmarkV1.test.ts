import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CHALLENGE_TAGS_V1,
  ARTIFACT_FAMILIES_V1,
  ARTIFACT_RUBRIC_AXES_V1,
  ORIGIN_ARTIFACT_BLIND_BENCHMARK_SCHEMA,
  createOriginArtifactBlindJudgePacketsV1,
  evaluateOriginArtifactBlindBenchmarkV1,
  type ArtifactBenchmarkCaseV1,
  type ArtifactRubricScoresV1,
  type OriginArtifactBlindBenchmarkInputV1,
} from './OriginArtifactBlindBenchmarkV1';

const SHA = 'a'.repeat(40);
const EVALUATOR_SHA = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);
const NOW = Date.parse('2026-09-30T00:00:00Z');

function scores(value: number): ArtifactRubricScoresV1 {
  return Object.fromEntries(ARTIFACT_RUBRIC_AXES_V1.map((axis) => [axis, value])) as ArtifactRubricScoresV1;
}

function technical() {
  return {
    formatValid: true,
    opensSuccessfully: true,
    requiredContentPassed: true,
    taskSpecificChecksPassed: true,
    noCorruption: true,
    safeDeliveryPassed: true,
    editabilityVerified: true,
    responsiveOrLayoutPassed: true,
  };
}

const formats: ArtifactBenchmarkCaseV1['expectedFormat'][] = [
  'docx', 'docx', 'xlsx', 'xlsx', 'pptx', 'pptx', 'pdf', 'pdf',
  'html-zip', 'html-zip', 'html-zip', 'html-zip', 'csv', 'markdown', 'docx', 'pptx',
];

function makeCase(index: number, family: (typeof ARTIFACT_FAMILIES_V1)[number]): ArtifactBenchmarkCaseV1 {
  const tagA = ARTIFACT_CHALLENGE_TAGS_V1[index % ARTIFACT_CHALLENGE_TAGS_V1.length];
  const tagB = ARTIFACT_CHALLENGE_TAGS_V1[(index + 3) % ARTIFACT_CHALLENGE_TAGS_V1.length];
  return {
    caseId: `artifact-${String(index + 1).padStart(2, '0')}`,
    family,
    challengeTags: [tagA, tagB],
    promptSha256: DIGEST,
    expectedFormat: formats[index],
    outputs: [
      { blindKey: 'A', systemId: 'origin-v1', role: 'origin', executionStatus: 'completed', durationMs: 30_000, artifactSha256: '1'.repeat(64), technical: technical() },
      { blindKey: 'B', systemId: 'ref-a', role: 'reference', executionStatus: 'completed', durationMs: 30_000, artifactSha256: '2'.repeat(64), technical: technical() },
      { blindKey: 'C', systemId: 'ref-b', role: 'reference', executionStatus: 'completed', durationMs: 30_000, artifactSha256: '3'.repeat(64), technical: technical() },
      { blindKey: 'D', systemId: 'ref-c', role: 'reference', executionStatus: 'completed', durationMs: 30_000, artifactSha256: '4'.repeat(64), technical: technical() },
    ],
    judges: [
      { judgeId: 'judge-a', firstChoiceBlindKey: 'A', scores: { A: scores(3.8), B: scores(3.2), C: scores(3.3), D: scores(3.4) } },
      { judgeId: 'judge-b', firstChoiceBlindKey: 'A', scores: { A: scores(3.7), B: scores(3.3), C: scores(3.2), D: scores(3.4) } },
    ],
  };
}

function input(): OriginArtifactBlindBenchmarkInputV1 {
  const cases: ArtifactBenchmarkCaseV1[] = [];
  let index = 0;
  for (const family of ARTIFACT_FAMILIES_V1) {
    for (let i = 0; i < 2; i += 1) cases.push(makeCase(index++, family));
  }
  return {
    schema: ORIGIN_ARTIFACT_BLIND_BENCHMARK_SCHEMA,
    candidateSha: SHA,
    evaluatorSha: EVALUATOR_SHA,
    corpusSha256: 'd'.repeat(64),
    originSystemId: 'origin-v1',
    referenceSystemIds: ['ref-a', 'ref-b', 'ref-c'],
    executionBudgetMs: 120_000,
    roundId: 'artifact-round-1',
    createdAt: '2026-09-29T23:30:00Z',
    expiresAt: '2026-10-06T23:30:00Z',
    cases,
  };
}

describe('ORIGIN artifact blind benchmark v1', () => {
  it('passes a complete 16-case blind work-product round against strongest references', () => {
    const report = evaluateOriginArtifactBlindBenchmarkV1(input(), NOW);
    expect(report.passed).toBe(true);
    expect(report.wins).toBe(16);
    expect(report.losses).toBe(0);
    expect(report.worldClassEvidence.referenceSystems).toBe(3);
    expect(report.worldClassEvidence.independentJudges).toBe(2);
    expect(report.worldClassEvidence.cases).toBe(16);
    expect(report.blockers).toEqual([]);
  });

  it('creates judge packets without system identity or ORIGIN/reference role', () => {
    const packets = createOriginArtifactBlindJudgePacketsV1(input());
    const serialized = JSON.stringify(packets);
    expect(packets).toHaveLength(16);
    expect(serialized).not.toContain('systemId');
    expect(serialized).not.toContain('"role"');
    expect(serialized).not.toContain('"origin"');
    expect(serialized).not.toContain('ref-a');
  });

  it('requires exactly two cases for every artifact family', () => {
    const base = input();
    const report = evaluateOriginArtifactBlindBenchmarkV1({ ...base, cases: base.cases.slice(1) }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_REQUIRES_16_CASES');
  });

  it('requires broad challenge coverage', () => {
    const base = input();
    const cases = base.cases.map((item) => ({ ...item, challengeTags: ['precision' as const] }));
    const report = evaluateOriginArtifactBlindBenchmarkV1({ ...base, cases }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_CHALLENGE_COVERAGE_LT_2:layout');
  });

  it('requires the same three frozen reference systems in every case', () => {
    const base = input();
    const first = base.cases[0];
    const broken = {
      ...first,
      outputs: first.outputs.map((output, index) => index === 1 ? { ...output, systemId: 'ref-other' } : output),
    };
    const report = evaluateOriginArtifactBlindBenchmarkV1({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_OUTPUT_SET_INVALID:artifact-01');
  });

  it('fails closed when any compared artifact is technically invalid', () => {
    const base = input();
    const first = base.cases[0];
    const broken = {
      ...first,
      outputs: first.outputs.map((output, index) => index === 2
        ? { ...output, technical: { ...output.technical, taskSpecificChecksPassed: false } }
        : output),
    };
    const report = evaluateOriginArtifactBlindBenchmarkV1({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_TECHNICAL_FAILURE:artifact-01');
  });

  it('retains blocked and over-budget outputs as blockers', () => {
    const base = input();
    const first = base.cases[0];
    const broken = {
      ...first,
      outputs: first.outputs.map((output, index) => index === 0
        ? { ...output, executionStatus: 'quota-limited' as const, durationMs: 130_000 }
        : output),
    };
    const report = evaluateOriginArtifactBlindBenchmarkV1({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_EXECUTION_NOT_COMPLETED:artifact-01:A');
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_EXECUTION_BUDGET_EXCEEDED:artifact-01:A');
  });

  it('rejects a candidate that loses to the strongest reference', () => {
    const base = input();
    const cases = base.cases.map((item) => ({
      ...item,
      judges: item.judges.map((judge) => ({
        ...judge,
        firstChoiceBlindKey: 'D',
        scores: { ...judge.scores, A: scores(3.2), D: scores(3.8) },
      })),
    }));
    const report = evaluateOriginArtifactBlindBenchmarkV1({ ...base, cases }, NOW);
    expect(report.passed).toBe(false);
    expect(report.losses).toBe(16);
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_WIN_RATE_LT_50');
  });

  it('requires an absolute work-product floor even if competitors are also weak', () => {
    const base = input();
    const cases = base.cases.map((item) => ({
      ...item,
      judges: item.judges.map((judge) => ({
        ...judge,
        scores: { A: scores(2.9), B: scores(2.6), C: scores(2.7), D: scores(2.8) },
      })),
    }));
    const report = evaluateOriginArtifactBlindBenchmarkV1({ ...base, cases }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_ABSOLUTE_QUALITY_NOT_PASSED');
  });

  it('requires fresh evidence bound to a valid candidate and evaluator SHA', () => {
    const base = input();
    const report = evaluateOriginArtifactBlindBenchmarkV1(
      { ...base, createdAt: '2026-08-01T00:00:00Z', expiresAt: '2026-08-10T00:00:00Z' },
      NOW,
    );
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('ARTIFACT_BENCHMARK_EVIDENCE_STALE_OR_FUTURE');
  });
});
