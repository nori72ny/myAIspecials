import { describe, expect, it } from 'vitest';
import {
  ORIGIN_IMAGE_QUALITY_BENCHMARK_VERSION_V15,
  ORIGIN_IMAGE_QUALITY_CRITERIA_V15,
  ORIGIN_IMAGE_QUALITY_FAMILIES_V15,
  createOriginImageBlindJudgePacketsV15,
  evaluateOriginImageQualityBenchmarkV15,
  type OriginImageQualityBenchmarkInputV15,
  type OriginImageQualityScoresV15,
} from './OriginImageQualityBenchmarkV15';

const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const ARTIFACT = 'c'.repeat(64);
const NOW = Date.parse('2026-09-29T13:10:00Z');

function scores(value: number): OriginImageQualityScoresV15 {
  return Object.fromEntries(ORIGIN_IMAGE_QUALITY_CRITERIA_V15.map((criterion) => [criterion, value])) as OriginImageQualityScoresV15;
}

function input(): OriginImageQualityBenchmarkInputV15 {
  const cases = ORIGIN_IMAGE_QUALITY_FAMILIES_V15.flatMap((family, familyIndex) =>
    [0, 1].map((caseIndex) => {
      const caseId = `img-${String(familyIndex + 1).padStart(2, '0')}-${caseIndex + 1}`;
      return {
        caseId,
        family,
        promptSha256: 'd'.repeat(64),
        width: 1024,
        height: 1024,
        requiresText: family === 'typography' || family === 'poster-key-visual',
        outputs: [
          { blindKey: 'A', systemId: 'origin', role: 'origin' as const, outputSha256: '1'.repeat(64), technicalValidationPassed: true },
          { blindKey: 'B', systemId: 'ref-1', role: 'reference' as const, outputSha256: '2'.repeat(64), technicalValidationPassed: true },
          { blindKey: 'C', systemId: 'ref-2', role: 'reference' as const, outputSha256: '3'.repeat(64), technicalValidationPassed: true },
          { blindKey: 'D', systemId: 'ref-3', role: 'reference' as const, outputSha256: '4'.repeat(64), technicalValidationPassed: true },
        ],
      };
    }),
  );

  const judgments = cases.flatMap((item) => [
    {
      caseId: item.caseId,
      judgeId: 'judge-1',
      scores: { A: scores(3.8), B: scores(3.2), C: scores(3.3), D: scores(3.4) },
      firstChoiceBlindKey: 'A',
    },
    {
      caseId: item.caseId,
      judgeId: 'judge-2',
      scores: { A: scores(3.7), B: scores(3.1), C: scores(3.4), D: scores(3.3) },
      firstChoiceBlindKey: 'A',
    },
  ]);

  return {
    version: ORIGIN_IMAGE_QUALITY_BENCHMARK_VERSION_V15,
    candidateSha: SHA,
    roundId: 'image-round-001',
    corpusSha256: DIGEST,
    createdAt: '2026-09-29T13:00:00Z',
    expiresAt: '2026-10-06T13:00:00Z',
    cases,
    judgments,
  };
}

describe('ORIGIN V1.5 image quality benchmark', () => {
  it('passes a complete 24-case blind comparison that beats the strongest reference', () => {
    const report = evaluateOriginImageQualityBenchmarkV15(input(), ARTIFACT, NOW);
    expect(report.passed).toBe(true);
    expect(report.wins).toBe(24);
    expect(report.losses).toBe(0);
    expect(report.evidence.referenceSystems).toBe(3);
    expect(report.evidence.independentJudges).toBe(2);
    expect(report.evidence.absoluteQualityPassed).toBe(true);
  });

  it('builds judge packets without revealing system identity or ORIGIN role', () => {
    const packets = createOriginImageBlindJudgePacketsV15(input());
    const serialized = JSON.stringify(packets);
    expect(packets).toHaveLength(24);
    expect(serialized).not.toContain('systemId');
    expect(serialized).not.toContain('"role"');
    expect(serialized).not.toContain('"origin"');
  });

  it('fails closed when a family is missing from the frozen 24-case shape', () => {
    const candidate = input();
    const broken = { ...candidate, cases: candidate.cases.slice(0, 22) };
    const report = evaluateOriginImageQualityBenchmarkV15(broken, ARTIFACT, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_CASE_COUNT_INVALID');
  });

  it('fails when any compared output did not pass deterministic technical validation', () => {
    const candidate = input();
    const first = candidate.cases[0];
    const brokenCase = {
      ...first,
      outputs: first.outputs.map((output, index) => index === 0 ? { ...output, technicalValidationPassed: false } : output),
    };
    const report = evaluateOriginImageQualityBenchmarkV15(
      { ...candidate, cases: [brokenCase, ...candidate.cases.slice(1)] },
      ARTIFACT,
      NOW,
    );
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain(`${first.caseId}:TECHNICAL_VALIDATION_FAILED`);
  });

  it('requires two independent judgments for every case', () => {
    const candidate = input();
    const target = candidate.cases[0].caseId;
    const report = evaluateOriginImageQualityBenchmarkV15(
      { ...candidate, judgments: candidate.judgments.filter((judgment) => !(judgment.caseId === target && judgment.judgeId === 'judge-2')) },
      ARTIFACT,
      NOW,
    );
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain(`${target}:JUDGES_INVALID`);
  });

  it('does not pass a polished-looking round when ORIGIN loses to the best reference', () => {
    const candidate = input();
    const judgments = candidate.judgments.map((judgment) => ({
      ...judgment,
      scores: { ...judgment.scores, A: scores(3.3), D: scores(3.8) },
      firstChoiceBlindKey: 'D',
    }));
    const report = evaluateOriginImageQualityBenchmarkV15({ ...candidate, judgments }, ARTIFACT, NOW);
    expect(report.passed).toBe(false);
    expect(report.losses).toBe(24);
    expect(report.blockers).toContain('IMAGE_BENCHMARK_WIN_RATE_LT_50');
  });
});
