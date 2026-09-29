import { describe, expect, it } from 'vitest';
import {
  IMAGE_FAMILIES_V15,
  IMAGE_RUBRIC_AXES_V15,
  ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA,
  evaluateOriginImageBlindBenchmarkV15,
  type ImageBenchmarkCaseV15,
  type OriginImageBlindBenchmarkInputV15,
} from './OriginImageBlindBenchmarkV15';

const SHA = 'a'.repeat(40);
const EVALUATOR_SHA = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);

function scores(value = 3) {
  return Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, value])) as Record<(typeof IMAGE_RUBRIC_AXES_V15)[number], number>;
}

function makeCase(index: number, family: (typeof IMAGE_FAMILIES_V15)[number], preferred: 'origin' | 'reference' | 'tie' = 'origin'): ImageBenchmarkCaseV15 {
  return {
    caseId: `img-${String(index + 1).padStart(2, '0')}`,
    family,
    promptSha256: DIGEST,
    originImageSha256: DIGEST,
    referenceSystemIds: ['ref-a', 'ref-b', 'ref-c'],
    technical: {
      signatureValid: true,
      dimensionsValid: true,
      structuralCriticPassed: true,
      technicalCriticPassed: true,
      safetyPassed: true,
      deliveryIntegrityPassed: true,
    },
    judges: [
      { judgeId: 'judge-a', preferred, scores: scores(3) },
      { judgeId: 'judge-b', preferred, scores: scores(3) },
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
    roundId: 'image-round-1',
    createdAt: '2026-09-29T12:00:00Z',
    cases,
  };
}

describe('ORIGIN image blind benchmark v1', () => {
  it('passes a complete 24-case, 8-family, multi-reference, multi-judge round', () => {
    const report = evaluateOriginImageBlindBenchmarkV15(input());
    expect(report.passed).toBe(true);
    expect(report.wins).toBe(24);
    expect(report.losses).toBe(0);
    expect(report.winRate).toBe(1);
    expect(report.blockers).toEqual([]);
  });

  it('fails closed when a family is missing', () => {
    const base = input();
    const candidate = { ...base, cases: base.cases.slice(0, 21) };
    const report = evaluateOriginImageBlindBenchmarkV15(candidate);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_REQUIRES_24_CASES');
    expect(report.blockers.some((value) => value.includes('IMAGE_BENCHMARK_FAMILY_COUNT_INVALID'))).toBe(true);
  });

  it('rejects technically invalid output even when judges prefer it', () => {
    const base = input();
    const first = base.cases[0];
    const candidate = {
      ...base,
      cases: [
        { ...first, technical: { ...first.technical, structuralCriticPassed: false } },
        ...base.cases.slice(1),
      ],
    };
    const report = evaluateOriginImageBlindBenchmarkV15(candidate);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_TECHNICAL_FAILURE:img-01');
  });

  it('rejects insufficient reference systems or judges', () => {
    const base = input();
    const first = base.cases[0];
    const candidate = {
      ...base,
      cases: [{
        ...first,
        referenceSystemIds: ['ref-a', 'ref-b'],
        judges: [first.judges[0]],
      }, ...base.cases.slice(1)],
    };
    const report = evaluateOriginImageBlindBenchmarkV15(candidate);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_REFERENCE_SYSTEMS_LT_3:img-01');
    expect(report.blockers).toContain('IMAGE_BENCHMARK_INDEPENDENT_JUDGES_LT_2:img-01');
  });

  it('rejects a round with too many blind losses', () => {
    const base = input();
    const candidate = {
      ...base,
      cases: base.cases.map((item, index) => index < 10
        ? { ...item, judges: item.judges.map((judge) => ({ ...judge, preferred: 'reference' as const })) }
        : item),
    };
    const report = evaluateOriginImageBlindBenchmarkV15(candidate);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_LOSS_RATE_GT_30');
  });

  it('rejects a negative rubric-axis mean even if preference votes pass', () => {
    const base = input();
    const candidate = {
      ...base,
      cases: base.cases.map((item) => ({
        ...item,
        judges: item.judges.map((judge) => ({
          ...judge,
          scores: { ...judge.scores, textHandling: 1 },
        })),
      })),
    };
    const report = evaluateOriginImageBlindBenchmarkV15(candidate);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_NEGATIVE_AXIS_MEAN:textHandling');
  });
});
