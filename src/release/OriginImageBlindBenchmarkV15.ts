import { createHash } from 'node:crypto';
import type { OriginBlindPreferenceEvidence } from './OriginWorldClassQualityGate.js';

export const ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA = 'origin.image-blind-benchmark.v2' as const;

export const IMAGE_FAMILIES_V15 = [
  'photograph-scene',
  'portrait-anatomy',
  'product-commercial',
  'advertisement-social',
  'poster-key-visual',
  'thumbnail',
  'illustration-style',
  'infographic-ui',
] as const;

export type ImageFamilyV15 = (typeof IMAGE_FAMILIES_V15)[number];

export const IMAGE_CHALLENGE_TAGS_V15 = [
  'text',
  'hands-anatomy',
  'material-realism',
  'complex-lighting',
  'counting-layout',
  'small-size-readability',
  'style-fidelity',
  'information-density',
] as const;

export type ImageChallengeTagV15 = (typeof IMAGE_CHALLENGE_TAGS_V15)[number];

export const IMAGE_RUBRIC_AXES_V15 = [
  'promptAdherence',
  'composition',
  'subjectIntegrity',
  'styleExecution',
  'textHandling',
  'artifactControl',
  'professionalUsefulness',
] as const;

export type ImageRubricAxisV15 = (typeof IMAGE_RUBRIC_AXES_V15)[number];
export type ImageRubricScoresV15 = Record<ImageRubricAxisV15, number>;

export type ImageTechnicalEvidenceV15 = {
  signatureValid: boolean;
  dimensionsValid: boolean;
  structuralCriticPassed: boolean;
  technicalCriticPassed: boolean;
  safetyPassed: boolean;
  deliveryIntegrityPassed: boolean;
};

export type ImageBenchmarkOutputV15 = {
  blindKey: string;
  systemId: string;
  role: 'origin' | 'reference';
  executionStatus: 'completed' | 'blocked' | 'failed' | 'quota-limited';
  durationMs: number;
  imageSha256: string;
  technical: ImageTechnicalEvidenceV15;
};

export type ImageJudgeScoreV15 = {
  judgeId: string;
  firstChoiceBlindKey: string;
  scores: Record<string, ImageRubricScoresV15>;
};

export type ImageBenchmarkCaseV15 = {
  caseId: string;
  family: ImageFamilyV15;
  challengeTags: readonly ImageChallengeTagV15[];
  promptSha256: string;
  width: number;
  height: number;
  requiresText: boolean;
  outputs: readonly ImageBenchmarkOutputV15[];
  judges: readonly ImageJudgeScoreV15[];
};

export type OriginImageBlindBenchmarkInputV15 = {
  schema: typeof ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA;
  candidateSha: string;
  evaluatorSha: string;
  corpusSha256: string;
  originSystemId: string;
  referenceSystemIds: readonly string[];
  executionBudgetMs: number;
  roundId: string;
  createdAt: string;
  expiresAt: string;
  cases: readonly ImageBenchmarkCaseV15[];
};

export type OriginImageBlindJudgePacketV15 = {
  caseId: string;
  family: ImageFamilyV15;
  challengeTags: readonly ImageChallengeTagV15[];
  promptSha256: string;
  width: number;
  height: number;
  requiresText: boolean;
  outputs: readonly {
    blindKey: string;
    imageSha256: string;
  }[];
};

export type OriginImageBlindBenchmarkReportV15 = {
  schema: typeof ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA;
  candidateSha: string;
  roundId: string;
  passed: boolean;
  wins: number;
  ties: number;
  losses: number;
  winRate: number;
  lossRate: number;
  nonLossRate: number;
  overallMean: number;
  familyNonLossRate: Record<ImageFamilyV15, number>;
  originAxisMeans: Record<ImageRubricAxisV15, number>;
  bestReferenceAxisMeans: Record<ImageRubricAxisV15, number>;
  blockers: string[];
  evidenceSha256: string;
  worldClassEvidence: OriginBlindPreferenceEvidence;
};

const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const SCORE_MIN = 0;
const SCORE_MAX = 4;
const REQUIRED_CASES_PER_FAMILY = 3;
const REQUIRED_CASES = IMAGE_FAMILIES_V15.length * REQUIRED_CASES_PER_FAMILY;
const REQUIRED_REFERENCES = 3;
const REQUIRED_JUDGES = 2;
const MAX_EVIDENCE_AGE_MS = 31 * 24 * 60 * 60_000;
const CASE_MARGIN = 0.1;

const ABSOLUTE_MINIMUMS: Record<ImageRubricAxisV15, number> = {
  promptAdherence: 3.6,
  composition: 3.5,
  subjectIntegrity: 3.5,
  styleExecution: 3.4,
  textHandling: 3.4,
  artifactControl: 3.6,
  professionalUsefulness: 3.6,
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function technicalPassed(technical: ImageTechnicalEvidenceV15): boolean {
  return Object.values(technical).every(Boolean);
}

function validRubric(scores: ImageRubricScoresV15 | undefined): scores is ImageRubricScoresV15 {
  if (!scores) return false;
  return IMAGE_RUBRIC_AXES_V15.every((axis) => {
    const value = scores[axis];
    return Number.isFinite(value) && value >= SCORE_MIN && value <= SCORE_MAX;
  });
}

function meanRubric(scores: ImageRubricScoresV15): number {
  return average(IMAGE_RUBRIC_AXES_V15.map((axis) => scores[axis]));
}

export function createOriginImageBlindJudgePacketsV15(
  input: OriginImageBlindBenchmarkInputV15,
): readonly OriginImageBlindJudgePacketV15[] {
  return input.cases.map((item) => ({
    caseId: item.caseId,
    family: item.family,
    challengeTags: [...item.challengeTags],
    promptSha256: item.promptSha256,
    width: item.width,
    height: item.height,
    requiresText: item.requiresText,
    outputs: item.outputs.map((output) => ({
      blindKey: output.blindKey,
      imageSha256: output.imageSha256,
    })),
  }));
}

export function evaluateOriginImageBlindBenchmarkV15(
  input: OriginImageBlindBenchmarkInputV15,
  nowMs = Date.now(),
): OriginImageBlindBenchmarkReportV15 {
  const blockers: string[] = [];
  const evidenceSha256 = createHash('sha256').update(JSON.stringify(input)).digest('hex');

  const emptyFamilyRates = Object.fromEntries(IMAGE_FAMILIES_V15.map((family) => [family, 0])) as Record<ImageFamilyV15, number>;
  const emptyAxisMeans = Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, 0])) as Record<ImageRubricAxisV15, number>;

  const emptyEvidence: OriginBlindPreferenceEvidence = {
    kind: 'blind-preference',
    candidateSha: input.candidateSha,
    evidenceId: input.roundId ? `image:${input.roundId}` : 'image:invalid',
    artifactSha256: evidenceSha256,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    referenceSystems: 0,
    independentJudges: 0,
    cases: input.cases.length,
    wins: 0,
    ties: 0,
    losses: 0,
    absoluteQualityPassed: false,
    technicalValidationPassed: false,
    negativeCriterionMeanCount: 0,
    criticalFailures: 0,
  };

  const baseReport = {
    schema: ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA,
    candidateSha: input.candidateSha,
    roundId: input.roundId,
    wins: 0,
    ties: 0,
    losses: 0,
    winRate: 0,
    lossRate: 0,
    nonLossRate: 0,
    overallMean: 0,
    familyNonLossRate: emptyFamilyRates,
    originAxisMeans: emptyAxisMeans,
    bestReferenceAxisMeans: emptyAxisMeans,
    evidenceSha256,
    worldClassEvidence: emptyEvidence,
  };

  const createdAtMs = Date.parse(input.createdAt);
  const expiresAtMs = Date.parse(input.expiresAt);
  if (
    input.schema !== ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA
    || !FULL_SHA.test(input.candidateSha)
    || !FULL_SHA.test(input.evaluatorSha)
    || !DIGEST.test(input.corpusSha256)
    || !input.originSystemId.trim()
    || input.referenceSystemIds.length !== REQUIRED_REFERENCES
    || unique(input.referenceSystemIds).length !== REQUIRED_REFERENCES
    || input.referenceSystemIds.some((systemId) => !systemId.trim())
    || input.referenceSystemIds.includes(input.originSystemId)
    || !Number.isInteger(input.executionBudgetMs)
    || input.executionBudgetMs < 1_000
    || input.executionBudgetMs > 300_000
    || !input.roundId.trim()
    || !Number.isFinite(createdAtMs)
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= createdAtMs
  ) {
    return {
      ...baseReport,
      passed: false,
      blockers: ['IMAGE_BENCHMARK_INPUT_INVALID'],
    };
  }

  if (createdAtMs > nowMs + 5 * 60_000 || expiresAtMs < nowMs) blockers.push('IMAGE_BENCHMARK_EVIDENCE_STALE_OR_FUTURE');
  if (expiresAtMs - createdAtMs > MAX_EVIDENCE_AGE_MS) blockers.push('IMAGE_BENCHMARK_EVIDENCE_LIFETIME_TOO_LONG');
  if (input.cases.length !== REQUIRED_CASES) blockers.push('IMAGE_BENCHMARK_REQUIRES_24_CASES');

  const ids = input.cases.map((item) => item.caseId);
  if (unique(ids).length !== ids.length || ids.some((id) => !id.trim())) blockers.push('IMAGE_BENCHMARK_CASE_IDS_INVALID');

  for (const family of IMAGE_FAMILIES_V15) {
    const count = input.cases.filter((item) => item.family === family).length;
    if (count !== REQUIRED_CASES_PER_FAMILY) blockers.push(`IMAGE_BENCHMARK_FAMILY_COUNT_INVALID:${family}`);
  }
  for (const tag of IMAGE_CHALLENGE_TAGS_V15) {
    const count = input.cases.filter((item) => item.challengeTags.includes(tag)).length;
    if (count < 2) blockers.push(`IMAGE_BENCHMARK_CHALLENGE_COVERAGE_LT_2:${tag}`);
  }

  let wins = 0;
  let ties = 0;
  let losses = 0;
  let criticalFailures = 0;
  let technicalFailures = 0;
  const allReferenceSystems = new Set<string>();
  const allJudges = new Set<string>();
  const familyTally = Object.fromEntries(
    IMAGE_FAMILIES_V15.map((family) => [family, { wins: 0, ties: 0, losses: 0 }]),
  ) as Record<ImageFamilyV15, { wins: number; ties: number; losses: number }>;
  const originAxisValues = Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, []])) as Record<ImageRubricAxisV15, number[]>;
  const bestReferenceAxisValues = Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, []])) as Record<ImageRubricAxisV15, number[]>;
  const originOverallValues: number[] = [];

  for (const item of input.cases) {
    if (
      !DIGEST.test(item.promptSha256)
      || !IMAGE_FAMILIES_V15.includes(item.family)
      || !Number.isInteger(item.width)
      || !Number.isInteger(item.height)
      || item.width < 256
      || item.height < 256
      || item.width > 1536
      || item.height > 1536
      || item.challengeTags.some((tag) => !IMAGE_CHALLENGE_TAGS_V15.includes(tag))
    ) {
      blockers.push(`IMAGE_BENCHMARK_CASE_METADATA_INVALID:${item.caseId}`);
      continue;
    }

    const blindKeys = item.outputs.map((output) => output.blindKey);
    const systemIds = item.outputs.map((output) => output.systemId);
    const originOutputs = item.outputs.filter((output) => output.role === 'origin');
    const references = item.outputs.filter((output) => output.role === 'reference');
    const expectedReferences = [...input.referenceSystemIds].sort();
    const actualReferences = references.map((output) => output.systemId).sort();
    if (
      item.outputs.length !== REQUIRED_REFERENCES + 1
      || originOutputs.length !== 1
      || originOutputs[0]?.systemId !== input.originSystemId
      || references.length !== REQUIRED_REFERENCES
      || actualReferences.some((systemId, index) => systemId !== expectedReferences[index])
      || unique(blindKeys).length !== item.outputs.length
      || unique(systemIds).length !== item.outputs.length
      || item.outputs.some((output) =>
        !output.blindKey.trim()
        || !output.systemId.trim()
        || !DIGEST.test(output.imageSha256)
        || !Number.isInteger(output.durationMs)
        || output.durationMs < 0
      )
    ) {
      blockers.push(`IMAGE_BENCHMARK_OUTPUT_SET_INVALID:${item.caseId}`);
      continue;
    }

    for (const reference of references) allReferenceSystems.add(reference.systemId);
    for (const output of item.outputs) {
      if (output.executionStatus !== 'completed') blockers.push(`IMAGE_BENCHMARK_EXECUTION_NOT_COMPLETED:${item.caseId}:${output.blindKey}`);
      if (output.durationMs > input.executionBudgetMs) blockers.push(`IMAGE_BENCHMARK_EXECUTION_BUDGET_EXCEEDED:${item.caseId}:${output.blindKey}`);
    }
    if (item.outputs.some((output) => output.executionStatus !== 'completed' || output.durationMs > input.executionBudgetMs)) {
      continue;
    }
    if (item.outputs.some((output) => !technicalPassed(output.technical))) {
      technicalFailures += 1;
      blockers.push(`IMAGE_BENCHMARK_TECHNICAL_FAILURE:${item.caseId}`);
      continue;
    }

    const judgeIds = unique(item.judges.map((judge) => judge.judgeId));
    for (const judgeId of judgeIds) allJudges.add(judgeId);
    if (judgeIds.length < REQUIRED_JUDGES || judgeIds.length !== item.judges.length) {
      blockers.push(`IMAGE_BENCHMARK_INDEPENDENT_JUDGES_LT_2:${item.caseId}`);
      continue;
    }

    const expectedKeys = [...blindKeys].sort();
    const invalidJudge = item.judges.some((judge) => {
      const scoreKeys = Object.keys(judge.scores).sort();
      return !judge.judgeId.trim()
        || !blindKeys.includes(judge.firstChoiceBlindKey)
        || scoreKeys.length !== expectedKeys.length
        || scoreKeys.some((key, index) => key !== expectedKeys[index])
        || expectedKeys.some((key) => !validRubric(judge.scores[key]));
    });
    if (invalidJudge) {
      blockers.push(`IMAGE_BENCHMARK_JUDGE_PACKET_INVALID:${item.caseId}`);
      continue;
    }

    const averagedByKey = new Map<string, ImageRubricScoresV15>();
    for (const blindKey of blindKeys) {
      averagedByKey.set(
        blindKey,
        Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map((axis) => [
          axis,
          average(item.judges.map((judge) => judge.scores[blindKey][axis])),
        ])) as ImageRubricScoresV15,
      );
    }

    const origin = originOutputs[0];
    const originScores = averagedByKey.get(origin.blindKey)!;
    const referencesWithScores = references.map((output) => ({
      output,
      scores: averagedByKey.get(output.blindKey)!,
    }));
    const bestReference = [...referencesWithScores].sort((a, b) => meanRubric(b.scores) - meanRubric(a.scores))[0];

    const originMean = meanRubric(originScores);
    const bestReferenceMean = meanRubric(bestReference.scores);
    originOverallValues.push(originMean);
    for (const axis of IMAGE_RUBRIC_AXES_V15) {
      originAxisValues[axis].push(originScores[axis]);
      bestReferenceAxisValues[axis].push(bestReference.scores[axis]);
    }

    const firstChoiceCounts = new Map(blindKeys.map((key) => [key, 0]));
    for (const judge of item.judges) {
      firstChoiceCounts.set(judge.firstChoiceBlindKey, (firstChoiceCounts.get(judge.firstChoiceBlindKey) ?? 0) + 1);
    }
    const originChoiceCount = firstChoiceCounts.get(origin.blindKey) ?? 0;
    const bestReferenceChoiceCount = Math.max(...references.map((reference) => firstChoiceCounts.get(reference.blindKey) ?? 0));

    let outcome: 'win' | 'tie' | 'loss';
    if (originMean >= bestReferenceMean + CASE_MARGIN && originChoiceCount >= bestReferenceChoiceCount) outcome = 'win';
    else if (originMean <= bestReferenceMean - CASE_MARGIN || originChoiceCount < bestReferenceChoiceCount) outcome = 'loss';
    else outcome = 'tie';

    if (outcome === 'win') {
      wins += 1;
      familyTally[item.family].wins += 1;
    } else if (outcome === 'loss') {
      losses += 1;
      familyTally[item.family].losses += 1;
    } else {
      ties += 1;
      familyTally[item.family].ties += 1;
    }

    if (originMean < 2.5 || IMAGE_RUBRIC_AXES_V15.some((axis) => originScores[axis] < 2)) criticalFailures += 1;
  }

  if (allReferenceSystems.size < REQUIRED_REFERENCES) blockers.push('IMAGE_BENCHMARK_REFERENCE_SYSTEMS_LT_3');

  const total = wins + ties + losses;
  const winRate = total ? wins / total : 0;
  const lossRate = total ? losses / total : 1;
  const nonLossRate = total ? (wins + ties) / total : 0;

  if (winRate < 0.6) blockers.push('IMAGE_BENCHMARK_WIN_RATE_LT_60');
  if (lossRate > 0.2) blockers.push('IMAGE_BENCHMARK_LOSS_RATE_GT_20');
  if (nonLossRate < 0.8) blockers.push('IMAGE_BENCHMARK_NON_LOSS_RATE_LT_80');

  const familyNonLossRate = Object.fromEntries(
    IMAGE_FAMILIES_V15.map((family) => {
      const tally = familyTally[family];
      const familyTotal = tally.wins + tally.ties + tally.losses;
      const rate = familyTotal ? (tally.wins + tally.ties) / familyTotal : 0;
      if (rate < 2 / 3) blockers.push(`IMAGE_BENCHMARK_FAMILY_NON_LOSS_LT_67:${family}`);
      return [family, round4(rate)];
    }),
  ) as Record<ImageFamilyV15, number>;

  const originAxisMeans = Object.fromEntries(
    IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, round4(average(originAxisValues[axis]))]),
  ) as Record<ImageRubricAxisV15, number>;
  const bestReferenceAxisMeans = Object.fromEntries(
    IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, round4(average(bestReferenceAxisValues[axis]))]),
  ) as Record<ImageRubricAxisV15, number>;

  const overallMean = round4(average(originOverallValues));
  const absoluteQualityPassed = overallMean >= 3.55
    && IMAGE_RUBRIC_AXES_V15.every((axis) => originAxisMeans[axis] >= ABSOLUTE_MINIMUMS[axis]);
  if (!absoluteQualityPassed) blockers.push('IMAGE_BENCHMARK_ABSOLUTE_QUALITY_NOT_PASSED');

  const negativeCriterionMeanCount = IMAGE_RUBRIC_AXES_V15.filter(
    (axis) => originAxisMeans[axis] + 0.01 < bestReferenceAxisMeans[axis],
  ).length;
  if (negativeCriterionMeanCount > 0) blockers.push('IMAGE_BENCHMARK_NEGATIVE_AXIS_MEAN');
  if (criticalFailures > 0) blockers.push('IMAGE_BENCHMARK_CRITICAL_FAILURES_PRESENT');

  const worldClassEvidence: OriginBlindPreferenceEvidence = {
    kind: 'blind-preference',
    candidateSha: input.candidateSha,
    evidenceId: `image:${input.roundId}:${input.corpusSha256.slice(0, 12)}`,
    artifactSha256: evidenceSha256,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    referenceSystems: allReferenceSystems.size,
    independentJudges: allJudges.size,
    cases: input.cases.length,
    wins,
    ties,
    losses,
    absoluteQualityPassed,
    technicalValidationPassed: technicalFailures === 0,
    negativeCriterionMeanCount,
    criticalFailures,
  };

  return {
    schema: ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA,
    candidateSha: input.candidateSha,
    roundId: input.roundId,
    passed: blockers.length === 0,
    wins,
    ties,
    losses,
    winRate: round4(winRate),
    lossRate: round4(lossRate),
    nonLossRate: round4(nonLossRate),
    overallMean,
    familyNonLossRate,
    originAxisMeans,
    bestReferenceAxisMeans,
    blockers,
    evidenceSha256,
    worldClassEvidence,
  };
}
