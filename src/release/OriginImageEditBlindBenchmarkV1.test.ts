import { describe, expect, it } from 'vitest';
import {
  IMAGE_EDIT_AXES_V1,
  IMAGE_EDIT_FAMILIES_V1,
  ORIGIN_IMAGE_EDIT_BLIND_SCHEMA,
  createOriginImageEditBlindJudgePacketsV1,
  evaluateOriginImageEditBlindBenchmarkV1,
  type ImageEditCaseV1,
  type ImageEditScoresV1,
  type OriginImageEditBlindInputV1,
} from './OriginImageEditBlindBenchmarkV1';

const SHA = 'a'.repeat(40);
const EVALUATOR_SHA = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);
const NOW = Date.parse('2026-10-03T13:00:00Z');

function scores(value: number): ImageEditScoresV1 {
  return Object.fromEntries(IMAGE_EDIT_AXES_V1.map((axis) => [axis, value])) as ImageEditScoresV1;
}

function makeCase(index: number, family: (typeof IMAGE_EDIT_FAMILIES_V1)[number]): ImageEditCaseV1 {
  return {
    caseId: `edit-${String(index + 1).padStart(2, '0')}`,
    family,
    sourceImageSha256: DIGEST,
    instructionSha256: 'd'.repeat(64),
    turnIndex: index % 3 + 1,
    outputs: [
      { blindKey: 'A', systemId: 'origin-edit-v1', role: 'origin', executionStatus: 'completed', durationMs: 20_000, imageSha256: '1'.repeat(64), sourcePreservationScore: 0.9, changedRegionScore: 0.85, identicalToSource: false },
      { blindKey: 'B', systemId: 'ref-a', role: 'reference', executionStatus: 'completed', durationMs: 20_000, imageSha256: '2'.repeat(64), sourcePreservationScore: 0.88, changedRegionScore: 0.8, identicalToSource: false },
      { blindKey: 'C', systemId: 'ref-b', role: 'reference', executionStatus: 'completed', durationMs: 20_000, imageSha256: '3'.repeat(64), sourcePreservationScore: 0.86, changedRegionScore: 0.78, identicalToSource: false },
      { blindKey: 'D', systemId: 'ref-c', role: 'reference', executionStatus: 'completed', durationMs: 20_000, imageSha256: '4'.repeat(64), sourcePreservationScore: 0.87, changedRegionScore: 0.79, identicalToSource: false },
    ],
    judges: [
      { judgeId: 'judge-a', firstChoiceBlindKey: 'A', scores: { A: scores(3.8), B: scores(3.3), C: scores(3.2), D: scores(3.4) } },
      { judgeId: 'judge-b', firstChoiceBlindKey: 'A', scores: { A: scores(3.7), B: scores(3.2), C: scores(3.3), D: scores(3.4) } },
    ],
  };
}

function input(): OriginImageEditBlindInputV1 {
  const cases: ImageEditCaseV1[] = [];
  let index = 0;
  for (const family of IMAGE_EDIT_FAMILIES_V1) {
    for (let i = 0; i < 2; i += 1) cases.push(makeCase(index++, family));
  }
  return {
    schema: ORIGIN_IMAGE_EDIT_BLIND_SCHEMA,
    candidateSha: SHA,
    evaluatorSha: EVALUATOR_SHA,
    corpusSha256: 'e'.repeat(64),
    originSystemId: 'origin-edit-v1',
    referenceSystemIds: ['ref-a', 'ref-b', 'ref-c'],
    executionBudgetMs: 60_000,
    roundId: 'image-edit-round-1',
    createdAt: '2026-10-03T12:00:00Z',
    expiresAt: '2026-10-10T12:00:00Z',
    cases,
  };
}

describe('ORIGIN image edit blind benchmark v1', () => {
  it('passes a complete strong 16-case round', () => {
    const report = evaluateOriginImageEditBlindBenchmarkV1(input(), NOW);
    expect(report.passed).toBe(true);
    expect(report.wins).toBe(16);
    expect(report.losses).toBe(0);
    expect(report.blockers).toEqual([]);
  });

  it('creates identity-blind judge packets', () => {
    const serialized = JSON.stringify(createOriginImageEditBlindJudgePacketsV1(input()));
    expect(serialized).not.toContain('systemId');
    expect(serialized).not.toContain('role');
    expect(serialized).not.toContain('origin-edit-v1');
    expect(serialized).not.toContain('ref-a');
  });

  it('fails closed on an identical-byte false edit', () => {
    const base = input();
    const first = base.cases[0];
    const broken = { ...first, outputs: first.outputs.map((output, index) => index === 0 ? { ...output, identicalToSource: true } : output) };
    const report = evaluateOriginImageEditBlindBenchmarkV1({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain(`IMAGE_EDIT_BENCHMARK_IDENTICAL_FALSE_EDIT:${first.caseId}`);
  });

  it('fails when unrequested source preservation is too weak', () => {
    const base = input();
    const first = base.cases[0];
    const broken = { ...first, outputs: first.outputs.map((output, index) => index === 0 ? { ...output, sourcePreservationScore: 0.5 } : output) };
    const report = evaluateOriginImageEditBlindBenchmarkV1({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain(`IMAGE_EDIT_BENCHMARK_ORIGIN_PRESERVATION_LT_075:${first.caseId}`);
  });

  it('fails when the requested region barely changes', () => {
    const base = input();
    const first = base.cases[0];
    const broken = { ...first, outputs: first.outputs.map((output, index) => index === 0 ? { ...output, changedRegionScore: 0.2 } : output) };
    const report = evaluateOriginImageEditBlindBenchmarkV1({ ...base, cases: [broken, ...base.cases.slice(1)] }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain(`IMAGE_EDIT_BENCHMARK_ORIGIN_CHANGE_LT_055:${first.caseId}`);
  });

  it('does not pass when ORIGIN loses to the strongest references', () => {
    const base = input();
    const cases = base.cases.map((item) => ({
      ...item,
      judges: item.judges.map((judge) => ({ ...judge, firstChoiceBlindKey: 'D', scores: { ...judge.scores, A: scores(3.2), D: scores(3.8) } })),
    }));
    const report = evaluateOriginImageEditBlindBenchmarkV1({ ...base, cases }, NOW);
    expect(report.passed).toBe(false);
    expect(report.losses).toBe(16);
    expect(report.blockers).toContain('IMAGE_EDIT_BENCHMARK_WIN_RATE_LT_50');
  });

  it('requires fresh evidence and full family coverage', () => {
    const base = input();
    const report = evaluateOriginImageEditBlindBenchmarkV1({
      ...base,
      createdAt: '2026-10-01T12:00:00Z',
      expiresAt: '2026-10-02T12:00:00Z',
      cases: base.cases.slice(0, 15),
    }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('IMAGE_EDIT_BENCHMARK_EVIDENCE_STALE_OR_FUTURE');
    expect(report.blockers).toContain('IMAGE_EDIT_BENCHMARK_REQUIRES_16_CASES');
  });
});
