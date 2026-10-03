import { createHash } from 'node:crypto';

export const ORIGIN_IMAGE_EDIT_BLIND_SCHEMA = 'origin.image-edit-blind-benchmark.v1' as const;

export const IMAGE_EDIT_FAMILIES_V1 = [
  'local-attribute',
  'object-add-remove',
  'background-change',
  'relighting-recolor',
  'identity-preservation',
  'composition-preservation',
  'multi-turn-consistency',
  'variation-diversity',
] as const;

export type ImageEditFamilyV1 = (typeof IMAGE_EDIT_FAMILIES_V1)[number];

export const IMAGE_EDIT_AXES_V1 = [
  'instructionAdherence',
  'editLocality',
  'subjectPreservation',
  'compositionPreservation',
  'artifactControl',
  'professionalUsefulness',
] as const;

export type ImageEditAxisV1 = (typeof IMAGE_EDIT_AXES_V1)[number];
export type ImageEditScoresV1 = Record<ImageEditAxisV1, number>;

export type ImageEditOutputV1 = {
  blindKey: string;
  systemId: string;
  role: 'origin' | 'reference';
  executionStatus: 'completed' | 'blocked' | 'failed' | 'quota-limited';
  durationMs: number;
  imageSha256: string;
  sourcePreservationScore: number;
  changedRegionScore: number;
  identicalToSource: boolean;
};

export type ImageEditJudgeV1 = {
  judgeId: string;
  firstChoiceBlindKey: string;
  scores: Record<string, ImageEditScoresV1>;
};

export type ImageEditCaseV1 = {
  caseId: string;
  family: ImageEditFamilyV1;
  sourceImageSha256: string;
  instructionSha256: string;
  turnIndex: number;
  outputs: readonly ImageEditOutputV1[];
  judges: readonly ImageEditJudgeV1[];
};

export type OriginImageEditBlindInputV1 = {
  schema: typeof ORIGIN_IMAGE_EDIT_BLIND_SCHEMA;
  candidateSha: string;
  evaluatorSha: string;
  corpusSha256: string;
  originSystemId: string;
  referenceSystemIds: readonly string[];
  executionBudgetMs: number;
  roundId: string;
  createdAt: string;
  expiresAt: string;
  cases: readonly ImageEditCaseV1[];
};

export type OriginImageEditBlindReportV1 = {
  schema: typeof ORIGIN_IMAGE_EDIT_BLIND_SCHEMA;
  candidateSha: string;
  roundId: string;
  passed: boolean;
  wins: number;
  ties: number;
  losses: number;
  nonLossRate: number;
  axisMeans: Record<ImageEditAxisV1, number>;
  blockers: string[];
  evidenceSha256: string;
};

const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const REQUIRED_REFERENCES = 3;
const REQUIRED_JUDGES = 2;
const REQUIRED_CASES_PER_FAMILY = 2;
const REQUIRED_CASES = IMAGE_EDIT_FAMILIES_V1.length * REQUIRED_CASES_PER_FAMILY;
const MAX_EVIDENCE_AGE_MS = 31 * 24 * 60 * 60_000;
const SCORE_MIN = 0;
const SCORE_MAX = 4;
const CASE_MARGIN = 0.1;

const ABSOLUTE_MINIMUMS: Record<ImageEditAxisV1, number> = {
  instructionAdherence: 3.4,
  editLocality: 3.3,
  subjectPreservation: 3.4,
  compositionPreservation: 3.3,
  artifactControl: 3.4,
  professionalUsefulness: 3.4,
};

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validScores(scores: ImageEditScoresV1 | undefined): scores is ImageEditScoresV1 {
  if (!scores) return false;
  return IMAGE_EDIT_AXES_V1.every((axis) => Number.isFinite(scores[axis]) && scores[axis] >= SCORE_MIN && scores[axis] <= SCORE_MAX);
}

function mean(scores: ImageEditScoresV1): number {
  return average(IMAGE_EDIT_AXES_V1.map((axis) => scores[axis]));
}

export function createOriginImageEditBlindJudgePacketsV1(input: OriginImageEditBlindInputV1) {
  return input.cases.map((item) => ({
    caseId: item.caseId,
    family: item.family,
    sourceImageSha256: item.sourceImageSha256,
    instructionSha256: item.instructionSha256,
    turnIndex: item.turnIndex,
    outputs: item.outputs.map((output) => ({ blindKey: output.blindKey, imageSha256: output.imageSha256 })),
  }));
}

export function evaluateOriginImageEditBlindBenchmarkV1(
  input: OriginImageEditBlindInputV1,
  nowMs = Date.now(),
): OriginImageEditBlindReportV1 {
  const blockers: string[] = [];
  const evidenceSha256 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const emptyMeans = Object.fromEntries(IMAGE_EDIT_AXES_V1.map((axis) => [axis, 0])) as Record<ImageEditAxisV1, number>;
  const base = {
    schema: ORIGIN_IMAGE_EDIT_BLIND_SCHEMA,
    candidateSha: input.candidateSha,
    roundId: input.roundId,
    wins: 0,
    ties: 0,
    losses: 0,
    nonLossRate: 0,
    axisMeans: emptyMeans,
    evidenceSha256,
  };

  const createdAtMs = Date.parse(input.createdAt);
  const expiresAtMs = Date.parse(input.expiresAt);
  if (
    input.schema !== ORIGIN_IMAGE_EDIT_BLIND_SCHEMA
    || !FULL_SHA.test(input.candidateSha)
    || !FULL_SHA.test(input.evaluatorSha)
    || !DIGEST.test(input.corpusSha256)
    || !input.originSystemId.trim()
    || unique(input.referenceSystemIds.filter(Boolean)).length !== REQUIRED_REFERENCES
    || input.referenceSystemIds.includes(input.originSystemId)
    || !Number.isInteger(input.executionBudgetMs)
    || input.executionBudgetMs < 1_000
    || input.executionBudgetMs > 300_000
    || !input.roundId.trim()
    || !Number.isFinite(createdAtMs)
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= createdAtMs
  ) return { ...base, passed: false, blockers: ['IMAGE_EDIT_BENCHMARK_INPUT_INVALID'] };

  if (createdAtMs > nowMs + 5 * 60_000 || expiresAtMs < nowMs) blockers.push('IMAGE_EDIT_BENCHMARK_EVIDENCE_STALE_OR_FUTURE');
  if (expiresAtMs - createdAtMs > MAX_EVIDENCE_AGE_MS) blockers.push('IMAGE_EDIT_BENCHMARK_EVIDENCE_LIFETIME_TOO_LONG');
  if (input.cases.length !== REQUIRED_CASES) blockers.push('IMAGE_EDIT_BENCHMARK_REQUIRES_16_CASES');

  for (const family of IMAGE_EDIT_FAMILIES_V1) {
    if (input.cases.filter((item) => item.family === family).length !== REQUIRED_CASES_PER_FAMILY) {
      blockers.push(`IMAGE_EDIT_BENCHMARK_FAMILY_COUNT_INVALID:${family}`);
    }
  }

  const caseIds = input.cases.map((item) => item.caseId);
  if (unique(caseIds).length !== caseIds.length || caseIds.some((id) => !id.trim())) blockers.push('IMAGE_EDIT_BENCHMARK_CASE_IDS_INVALID');

  let wins = 0;
  let ties = 0;
  let losses = 0;
  const axisValues = Object.fromEntries(IMAGE_EDIT_AXES_V1.map((axis) => [axis, [] as number[]])) as Record<ImageEditAxisV1, number[]>;

  for (const item of input.cases) {
    if (!DIGEST.test(item.sourceImageSha256) || !DIGEST.test(item.instructionSha256) || !Number.isInteger(item.turnIndex) || item.turnIndex < 1) {
      blockers.push(`IMAGE_EDIT_BENCHMARK_CASE_METADATA_INVALID:${item.caseId}`);
      continue;
    }
    const origin = item.outputs.filter((output) => output.role === 'origin');
    const refs = item.outputs.filter((output) => output.role === 'reference');
    const expectedRefs = [...input.referenceSystemIds].sort();
    const actualRefs = refs.map((output) => output.systemId).sort();
    const blindKeys = item.outputs.map((output) => output.blindKey);
    if (
      item.outputs.length !== REQUIRED_REFERENCES + 1
      || origin.length !== 1
      || origin[0]?.systemId !== input.originSystemId
      || refs.length !== REQUIRED_REFERENCES
      || actualRefs.some((value, index) => value !== expectedRefs[index])
      || unique(blindKeys).length !== blindKeys.length
      || item.outputs.some((output) => !output.blindKey.trim() || !DIGEST.test(output.imageSha256) || !Number.isInteger(output.durationMs) || output.durationMs < 0)
    ) {
      blockers.push(`IMAGE_EDIT_BENCHMARK_OUTPUT_SET_INVALID:${item.caseId}`);
      continue;
    }
    if (item.outputs.some((output) => output.executionStatus !== 'completed')) blockers.push(`IMAGE_EDIT_BENCHMARK_EXECUTION_NOT_COMPLETED:${item.caseId}`);
    if (item.outputs.some((output) => output.durationMs > input.executionBudgetMs)) blockers.push(`IMAGE_EDIT_BENCHMARK_EXECUTION_BUDGET_EXCEEDED:${item.caseId}`);
    if (item.outputs.some((output) => output.identicalToSource)) blockers.push(`IMAGE_EDIT_BENCHMARK_IDENTICAL_FALSE_EDIT:${item.caseId}`);
    if (item.outputs.some((output) => !Number.isFinite(output.sourcePreservationScore) || output.sourcePreservationScore < 0 || output.sourcePreservationScore > 1 || !Number.isFinite(output.changedRegionScore) || output.changedRegionScore < 0 || output.changedRegionScore > 1)) {
      blockers.push(`IMAGE_EDIT_BENCHMARK_PRESERVATION_EVIDENCE_INVALID:${item.caseId}`);
      continue;
    }
    if (origin[0].sourcePreservationScore < 0.75) blockers.push(`IMAGE_EDIT_BENCHMARK_ORIGIN_PRESERVATION_LT_075:${item.caseId}`);
    if (origin[0].changedRegionScore < 0.55) blockers.push(`IMAGE_EDIT_BENCHMARK_ORIGIN_CHANGE_LT_055:${item.caseId}`);

    const judges = unique(item.judges.map((judge) => judge.judgeId));
    if (judges.length < REQUIRED_JUDGES || judges.length !== item.judges.length) {
      blockers.push(`IMAGE_EDIT_BENCHMARK_INDEPENDENT_JUDGES_LT_2:${item.caseId}`);
      continue;
    }
    const expectedKeys = [...blindKeys].sort();
    const invalidJudge = item.judges.some((judge) => {
      const keys = Object.keys(judge.scores).sort();
      return !judge.judgeId.trim() || !blindKeys.includes(judge.firstChoiceBlindKey) || keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]) || expectedKeys.some((key) => !validScores(judge.scores[key]));
    });
    if (invalidJudge) {
      blockers.push(`IMAGE_EDIT_BENCHMARK_JUDGE_PACKET_INVALID:${item.caseId}`);
      continue;
    }

    const averaged = new Map<string, ImageEditScoresV1>();
    for (const key of blindKeys) {
      averaged.set(key, Object.fromEntries(IMAGE_EDIT_AXES_V1.map((axis) => [axis, average(item.judges.map((judge) => judge.scores[key][axis]))])) as ImageEditScoresV1);
    }
    const originScores = averaged.get(origin[0].blindKey)!;
    for (const axis of IMAGE_EDIT_AXES_V1) axisValues[axis].push(originScores[axis]);
    const originMean = mean(originScores);
    const bestRefMean = Math.max(...refs.map((ref) => mean(averaged.get(ref.blindKey)!)));
    if (originMean > bestRefMean + CASE_MARGIN) wins += 1;
    else if (originMean + CASE_MARGIN < bestRefMean) losses += 1;
    else ties += 1;
  }

  const axisMeans = Object.fromEntries(IMAGE_EDIT_AXES_V1.map((axis) => [axis, average(axisValues[axis])])) as Record<ImageEditAxisV1, number>;
  for (const axis of IMAGE_EDIT_AXES_V1) {
    if (axisMeans[axis] < ABSOLUTE_MINIMUMS[axis]) blockers.push(`IMAGE_EDIT_BENCHMARK_AXIS_BELOW_MIN:${axis}`);
  }
  const total = wins + ties + losses;
  const nonLossRate = total ? (wins + ties) / total : 0;
  if (total !== REQUIRED_CASES) blockers.push('IMAGE_EDIT_BENCHMARK_INCOMPLETE_SCORING');
  if (wins / Math.max(1, total) < 0.5) blockers.push('IMAGE_EDIT_BENCHMARK_WIN_RATE_LT_50');
  if (nonLossRate < 0.75) blockers.push('IMAGE_EDIT_BENCHMARK_NON_LOSS_RATE_LT_75');

  return {
    ...base,
    passed: blockers.length === 0,
    wins,
    ties,
    losses,
    nonLossRate,
    axisMeans,
    blockers: unique(blockers),
  };
}
