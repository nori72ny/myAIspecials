import { describe, expect, it } from 'vitest';
import {
  IMAGE_CHALLENGE_TAGS_V15,
  IMAGE_FAMILIES_V15,
  IMAGE_RUBRIC_AXES_V15,
  ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA,
  createOriginImageBlindJudgePacketsV15,
  evaluateOriginImageBlindBenchmarkV15,
  type ImageBenchmarkCaseV15,
  type ImageRubricScoresV15,
  type OriginImageBlindBenchmarkInputV15,
} from './OriginImageBlindBenchmarkV15';

const SHA = 'a'.repeat(40);
const EVALUATOR_SHA = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);
const NOW = Date.parse('2026-09-29T13:20:00Z');

function scores(value: number): ImageRubricScoresV15 {
  return Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, value])) as ImageRubricScoresV15;
}

function technical() {
  return {
    signatureValid: true,
    dimensionsValid: true,
    structuralCriticPassed: true,
    technicalCriticPassed: true,
    safetyPassed: true,
    deliveryIntegrityPassed: true,
  };
}

function makeCase(index: number, family: (typeof IMAGE_FAMILIES_V15)[number]): ImageBenchmarkCaseV15 {
  const tagA = IMAGE_CHALLENGE_TAGS_V15[index % IMAGE_CHALLENGE_TAGS_V15.length];
  const tagB = IMAGE_CHALLENGE_TAGS_V15[(index + 3) % IMAGE_CHALLENGE_TAGS_V15.length];
  return {
    caseId: `img-${String(index + 1).padStart(2, '0')}`,
    family,
    challengeTags: [tagA, tagB],
    promptSha256: DIGEST,
    width: 1024,
    height: 1024,
    requiresText: tagA === 'text' || tagB === 'text',
    outputs: [
      { blindKey: 'A', systemId: 'origin-v1', role: 'origin', executionStatus: 'completed', durationMs: 25_000, imageSha256: '1'.repeat(64), technical: technical() },
      { blindKey: 'B', systemId: 'ref-a', role: 'reference', executionStatus: 'completed', durationMs: 25_000, imageSha256: '2'.repeat(64), technical: technical() },
      { blindKey: 'C', systemId: 'ref-b', role: 'reference', executionStatus: 'completed', durationMs: 25_000, imageSha256: '3'.repeat(64), technical: technical() },
      { blindKey: 'D', systemId: 'ref-c', role: 'reference', executionStatus: 'completed', durationMs: 25_000, imageSha256: '4'.repeat(64), technical: technical() },
    ],
    judges: [
      {
        judgeId: 'judge-a',
        firstChoiceBlindKey: 'A',
        scores: { A: scores(3.8), B: scores(3.2), C: scores(3.3), D: scores(3.4) },
      },
      {
        judgeId: 'judge-b',
        firstChoiceBlindKey: 'A',
        scores: { A: scores(3.7), B: scores(3.3), C: scores(3.2), D: scores(3.4) },
      },
    ],
  };
}

function input(): OriginImageBlindBenchmarkInputV15 {
  const cases: ImageBenchmarkCaseV15[] = [];
  let index = 0;
  for (const family of IMAGE_FAMILIES_V15) {
    for (let i = 0; i < 3; i += 1) cases.push(makeCase(index++, family));
  }
  return {
    schema: ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA,
    candidateSha: SHA,
    evaluatorSha: EVALUATOR_SHA,
    corpusSha256: 'd'.repeat(64),
    originSystemId: 'origin-v1',
    referenceSystemIds: ['ref-a', 'ref-b', 'ref-c'],
    executionBudgetMs: 60_000,
    roundId: 'image-round-1',
    createdAt: '2026-09-29T13:00:00Z',
    expiresAt: '2026-10-06T13:00:00Z',
    cases,
  };
}

describe('ORIGIN image blind benchmark v2', () => {
  it('passes a complete 24-case blind round against the strongest per-case reference', () => {
    const report = evaluateOriginImageBlindBenchmarkV15(input(), NOW);
    expect(report.passed).toBe(true);
    expect(report.wins).toBe(24);
    expect(report.losses).toBe(0);
    expect(report.worldClassEvidence.referenceSystems).toBe(3);
    expect(report.worldClassEvidence.independentJudges).toBe(2);
    expect(report.worldClassEvidence.absoluteQualityPassed).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it('creates judge packets without revealing ORIGIN/reference identity or system IDs', () => {
    const packets = createOriginImageBlindJudgePacketsV15(input());
    const serialized = JSON.stringify(packets);
    expect(packets).toHaveLength(24);
    expect(serialized).not.toContain('systemId');
    expect(serialized).not.toContain('"role"');
    expect(serialized).not.toContain('"origin"');
    expect(serialized).not.toContain('ref-a');
  });

  it('fails closed when challenge coverage is too narrow', () => {
    const base = input();
    const cases = base.cases.map((item) => ({ ...item, challengeTags: ['text' as const] }));
    const report = evaluateOriginImageBlindBenchmarkV15({ ...base, cases }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_CHALLENGE_COVERAGE_LT_2:hands-anatomy');
  });

  it('requires the same three reference systems for every case', () => {
    const base = input();
    const first = base.cases[0];
    const broken = {
      ...first,
      outputs: first.outputs.map((output, index) => index === 1 ? { ...output, systemId: 'ref-other' } : output),
    };
    const report = evaluateOriginImageBlindBenchmarkV15({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_OUTPUT_SET_INVALID:img-01');
  });

  it('retains blocked and over-budget executions as benchmark blockers', () => {
    const base = input();
    const first = base.cases[0];
    const blocked = {
      ...first,
      outputs: first.outputs.map((output, index) => index === 0
        ? { ...output, executionStatus: 'quota-limited' as const, durationMs: 70_000 }
        : output),
    };
    const report = evaluateOriginImageBlindBenchmarkV15({ ...base, cases: [blocked, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_EXECUTION_NOT_COMPLETED:img-01:A');
    expect(report.blockers).toContain('IMAGE_BENCHMARK_EXECUTION_BUDGET_EXCEEDED:img-01:A');
  });

  it('rejects any technically invalid compared output, including a reference output', () => {
    const base = input();
    const first = base.cases[0];
    const broken = {
      ...first,
      outputs: first.outputs.map((output, index) => index === 1
        ? { ...output, technical: { ...output.technical, structuralCriticPassed: false } }
        : output),
    };
    const report = evaluateOriginImageBlindBenchmarkV15({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_TECHNICAL_FAILURE:img-01');
  });

  it('rejects judge evidence that does not score every blinded output', () => {
    const base = input();
    const first = base.cases[0];
    const brokenJudge = {
      ...first.judges[0],
      scores: { A: scores(3.8), B: scores(3.2), C: scores(3.3) },
    };
    const broken = { ...first, judges: [brokenJudge, first.judges[1]] };
    const report = evaluateOriginImageBlindBenchmarkV15({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_JUDGE_PACKET_INVALID:img-01');
  });

  it('does not pass when ORIGIN loses to the strongest reference', () => {
    const base = input();
    const cases = base.cases.map((item) => ({
      ...item,
      judges: item.judges.map((judge) => ({
        ...judge,
        firstChoiceBlindKey: 'D',
        scores: { ...judge.scores, A: scores(3.3), D: scores(3.8) },
      })),
    }));
    const report = evaluateOriginImageBlindBenchmarkV15({ ...base, cases }, NOW);
    expect(report.passed).toBe(false);
    expect(report.losses).toBe(24);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_WIN_RATE_LT_60');
  });

  it('requires a decisive world-class win rate rather than a bare majority', () => {
    const base = input();
    const cases = base.cases.map((item, index) => index < 13 ? item : ({
      ...item,
      judges: item.judges.map((judge) => ({
        ...judge,
        firstChoiceBlindKey: 'D',
        scores: { ...judge.scores, A: scores(3.6), D: scores(3.8) },
      })),
    }));
    const report = evaluateOriginImageBlindBenchmarkV15({ ...base, cases }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_WIN_RATE_LT_60');
  });

  it('requires absolute image quality even if preference votes would otherwise pass', () => {
    const base = input();
    const cases = base.cases.map((item) => ({
      ...item,
      judges: item.judges.map((judge) => ({
        ...judge,
        scores: {
          A: scores(2.9),
          B: scores(2.6),
          C: scores(2.7),
          D: scores(2.8),
        },
      })),
    }));
    const report = evaluateOriginImageBlindBenchmarkV15({ ...base, cases }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_ABSOLUTE_QUALITY_NOT_PASSED');
  });

  it('requires fresh exact-round evidence with a bounded lifetime', () => {
    const base = input();
    const report = evaluateOriginImageBlindBenchmarkV15(
      { ...base, createdAt: '2026-09-01T13:00:00Z', expiresAt: '2026-09-10T13:00:00Z' },
      NOW,
    );
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_EVIDENCE_STALE_OR_FUTURE');
  });

  it('rejects reference lists with repeated or blank identities instead of silently truncating them', () => {
    for (const referenceSystemIds of [
      ['ref-a', 'ref-b', 'ref-c', 'ref-c'],
      ['ref-a', 'ref-b', 'ref-c', ''],
      ['ref-a', 'ref-b', 'ref-b'],
    ]) {
      const base = input();
      const report = evaluateOriginImageBlindBenchmarkV15({ ...base, referenceSystemIds }, NOW);
      expect(report.passed).toBe(false);
      expect(report.blockers).toContain('IMAGE_BENCHMARK_INPUT_INVALID');
    }
  });

});
