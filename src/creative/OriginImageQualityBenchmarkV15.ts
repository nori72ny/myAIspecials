import type { OriginBlindPreferenceEvidence } from '../release/OriginWorldClassQualityGate.js';

export const ORIGIN_IMAGE_QUALITY_BENCHMARK_VERSION_V15 = 'origin-image-quality-benchmark-v1' as const;

export const ORIGIN_IMAGE_QUALITY_FAMILIES_V15 = [
  'photoreal-scene',
  'portrait-anatomy',
  'product-commercial',
  'food-material',
  'cinematic-lighting',
  'illustration-style',
  'anime-comic',
  'social-ad',
  'poster-key-visual',
  'thumbnail',
  'typography',
  'infographic-ui',
] as const;

export type OriginImageQualityFamilyV15 = (typeof ORIGIN_IMAGE_QUALITY_FAMILIES_V15)[number];

export const ORIGIN_IMAGE_QUALITY_CRITERIA_V15 = [
  'promptAdherence',
  'composition',
  'subjectIntegrity',
  'styleExecution',
  'textFidelity',
  'artifactControl',
  'professionalUsefulness',
] as const;

export type OriginImageQualityCriterionV15 = (typeof ORIGIN_IMAGE_QUALITY_CRITERIA_V15)[number];

export type OriginImageQualityScoresV15 = Record<OriginImageQualityCriterionV15, number>;

export type OriginImageBenchmarkOutputV15 = {
  blindKey: string;
  systemId: string;
  role: 'origin' | 'reference';
  outputSha256: string;
  technicalValidationPassed: boolean;
};

export type OriginImageBenchmarkCaseV15 = {
  caseId: string;
  family: OriginImageQualityFamilyV15;
  promptSha256: string;
  width: number;
  height: number;
  requiresText: boolean;
  outputs: readonly OriginImageBenchmarkOutputV15[];
};

export type OriginImageJudgeCaseResultV15 = {
  caseId: string;
  judgeId: string;
  scores: Record<string, OriginImageQualityScoresV15>;
  firstChoiceBlindKey: string;
};

export type OriginImageQualityBenchmarkInputV15 = {
  version: typeof ORIGIN_IMAGE_QUALITY_BENCHMARK_VERSION_V15;
  candidateSha: string;
  roundId: string;
  corpusSha256: string;
  createdAt: string;
  expiresAt: string;
  cases: readonly OriginImageBenchmarkCaseV15[];
  judgments: readonly OriginImageJudgeCaseResultV15[];
};

export type OriginImageBlindJudgePacketV15 = {
  caseId: string;
  family: OriginImageQualityFamilyV15;
  promptSha256: string;
  width: number;
  height: number;
  requiresText: boolean;
  outputs: readonly {
    blindKey: string;
    outputSha256: string;
  }[];
};

export type OriginImageQualityBenchmarkReportV15 = {
  version: typeof ORIGIN_IMAGE_QUALITY_BENCHMARK_VERSION_V15;
  candidateSha: string;
  roundId: string;
  passed: boolean;
  blockers: readonly string[];
  wins: number;
  ties: number;
  losses: number;
  overallMean: number;
  criterionMeans: Record<OriginImageQualityCriterionV15, number>;
  bestReferenceCriterionMeans: Record<OriginImageQualityCriterionV15, number>;
  evidence: OriginBlindPreferenceEvidence;
};

const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const REQUIRED_CASES = 24;
const REQUIRED_CASES_PER_FAMILY = 2;
const REQUIRED_REFERENCES_PER_CASE = 3;
const REQUIRED_JUDGES_PER_CASE = 2;
const SCORE_EPSILON = 0.1;

const ABSOLUTE_MINIMUMS: Record<OriginImageQualityCriterionV15, number> = {
  promptAdherence: 3.4,
  composition: 3.3,
  subjectIntegrity: 3.3,
  styleExecution: 3.2,
  textFidelity: 3.2,
  artifactControl: 3.4,
  professionalUsefulness: 3.4,
};

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function scoreMean(scores: OriginImageQualityScoresV15): number {
  return average(ORIGIN_IMAGE_QUALITY_CRITERIA_V15.map((criterion) => scores[criterion]));
}

function isValidScoreSet(scores: OriginImageQualityScoresV15 | undefined): scores is OriginImageQualityScoresV15 {
  if (!scores) return false;
  return ORIGIN_IMAGE_QUALITY_CRITERIA_V15.every((criterion) => {
    const value = scores[criterion];
    return Number.isFinite(value) && value >= 0 && value <= 4;
  });
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function createOriginImageBlindJudgePacketsV15(
  input: OriginImageQualityBenchmarkInputV15,
): readonly OriginImageBlindJudgePacketV15[] {
  return input.cases.map((item) => ({
    caseId: item.caseId,
    family: item.family,
    promptSha256: item.promptSha256,
    width: item.width,
    height: item.height,
    requiresText: item.requiresText,
    outputs: item.outputs.map((output) => ({
      blindKey: output.blindKey,
      outputSha256: output.outputSha256,
    })),
  }));
}

export function evaluateOriginImageQualityBenchmarkV15(
  input: OriginImageQualityBenchmarkInputV15,
  artifactSha256: string,
  nowMs = Date.now(),
): OriginImageQualityBenchmarkReportV15 {
  const blockers: string[] = [];
  if (input.version !== ORIGIN_IMAGE_QUALITY_BENCHMARK_VERSION_V15) blockers.push('IMAGE_BENCHMARK_VERSION_INVALID');
  if (!SHA40.test(input.candidateSha)) blockers.push('IMAGE_BENCHMARK_CANDIDATE_SHA_INVALID');
  if (!input.roundId.trim()) blockers.push('IMAGE_BENCHMARK_ROUND_ID_MISSING');
  if (!SHA256.test(input.corpusSha256)) blockers.push('IMAGE_BENCHMARK_CORPUS_DIGEST_INVALID');
  if (!SHA256.test(artifactSha256)) blockers.push('IMAGE_BENCHMARK_ARTIFACT_DIGEST_INVALID');

  const createdAtMs = Date.parse(input.createdAt);
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= createdAtMs) {
    blockers.push('IMAGE_BENCHMARK_EVIDENCE_TIME_INVALID');
  } else {
    if (createdAtMs > nowMs + 5 * 60_000 || expiresAtMs < nowMs) blockers.push('IMAGE_BENCHMARK_EVIDENCE_STALE_OR_FUTURE');
    if (expiresAtMs - createdAtMs > 31 * 24 * 60 * 60_000) blockers.push('IMAGE_BENCHMARK_EVIDENCE_LIFETIME_TOO_LONG');
  }

  if (input.cases.length !== REQUIRED_CASES) blockers.push('IMAGE_BENCHMARK_CASE_COUNT_INVALID');
  const caseIds = input.cases.map((item) => item.caseId);
  if (unique(caseIds).length !== caseIds.length || caseIds.some((id) => !id.trim())) blockers.push('IMAGE_BENCHMARK_CASE_IDS_INVALID');

  const familyCounts = new Map<OriginImageQualityFamilyV15, number>();
  for (const family of ORIGIN_IMAGE_QUALITY_FAMILIES_V15) familyCounts.set(family, 0);
  for (const item of input.cases) familyCounts.set(item.family, (familyCounts.get(item.family) ?? 0) + 1);
  for (const family of ORIGIN_IMAGE_QUALITY_FAMILIES_V15) {
    if (familyCounts.get(family) !== REQUIRED_CASES_PER_FAMILY) blockers.push(`IMAGE_BENCHMARK_FAMILY_COUNT_INVALID:${family}`);
  }

  const allReferenceSystemIds = new Set<string>();
  let technicalFailures = 0;
  let wins = 0;
  let ties = 0;
  let losses = 0;
  let criticalFailures = 0;
  const originCriterionValues: Record<OriginImageQualityCriterionV15, number[]> = Object.fromEntries(
    ORIGIN_IMAGE_QUALITY_CRITERIA_V15.map((criterion) => [criterion, []]),
  ) as Record<OriginImageQualityCriterionV15, number[]>;
  const bestReferenceCriterionValues: Record<OriginImageQualityCriterionV15, number[]> = Object.fromEntries(
    ORIGIN_IMAGE_QUALITY_CRITERIA_V15.map((criterion) => [criterion, []]),
  ) as Record<OriginImageQualityCriterionV15, number[]>;
  const originOverallValues: number[] = [];

  for (const item of input.cases) {
    if (!item.caseId.trim() || !SHA256.test(item.promptSha256)) {
      blockers.push(`${item.caseId || 'unknown'}:CASE_METADATA_INVALID`);
      continue;
    }
    if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 256 || item.height < 256 || item.width > 1536 || item.height > 1536) {
      blockers.push(`${item.caseId}:DIMENSIONS_INVALID`);
    }

    const blindKeys = item.outputs.map((output) => output.blindKey);
    const systemIds = item.outputs.map((output) => output.systemId);
    const originOutputs = item.outputs.filter((output) => output.role === 'origin');
    const referenceOutputs = item.outputs.filter((output) => output.role === 'reference');
    if (
      item.outputs.length !== REQUIRED_REFERENCES_PER_CASE + 1
      || unique(blindKeys).length !== item.outputs.length
      || unique(systemIds).length !== item.outputs.length
      || originOutputs.length !== 1
      || referenceOutputs.length !== REQUIRED_REFERENCES_PER_CASE
      || item.outputs.some((output) => !output.blindKey.trim() || !output.systemId.trim() || !SHA256.test(output.outputSha256))
    ) {
      blockers.push(`${item.caseId}:OUTPUT_SET_INVALID`);
      continue;
    }
    for (const reference of referenceOutputs) allReferenceSystemIds.add(reference.systemId);
    if (item.outputs.some((output) => !output.technicalValidationPassed)) {
      technicalFailures += 1;
      blockers.push(`${item.caseId}:TECHNICAL_VALIDATION_FAILED`);
      continue;
    }

    const caseJudgments = input.judgments.filter((judgment) => judgment.caseId === item.caseId);
    const judgeIds = unique(caseJudgments.map((judgment) => judgment.judgeId));
    if (judgeIds.length < REQUIRED_JUDGES_PER_CASE || caseJudgments.length !== judgeIds.length) {
      blockers.push(`${item.caseId}:JUDGES_INVALID`);
      continue;
    }

    let judgmentInvalid = false;
    for (const judgment of caseJudgments) {
      const scoreKeys = Object.keys(judgment.scores).sort();
      const expectedKeys = [...blindKeys].sort();
      if (
        !judgment.judgeId.trim()
        || scoreKeys.length !== expectedKeys.length
        || scoreKeys.some((key, index) => key !== expectedKeys[index])
        || !blindKeys.includes(judgment.firstChoiceBlindKey)
        || expectedKeys.some((key) => !isValidScoreSet(judgment.scores[key]))
      ) {
        judgmentInvalid = true;
        break;
      }
    }
    if (judgmentInvalid) {
      blockers.push(`${item.caseId}:JUDGMENT_INVALID`);
      continue;
    }

    const averagedByBlindKey = new Map<string, OriginImageQualityScoresV15>();
    for (const blindKey of blindKeys) {
      const averaged = Object.fromEntries(ORIGIN_IMAGE_QUALITY_CRITERIA_V15.map((criterion) => [
        criterion,
        average(caseJudgments.map((judgment) => judgment.scores[blindKey][criterion])),
      ])) as OriginImageQualityScoresV15;
      averagedByBlindKey.set(blindKey, averaged);
    }

    const origin = originOutputs[0];
    const originScores = averagedByBlindKey.get(origin.blindKey)!;
    const refsWithScores = referenceOutputs.map((output) => ({
      output,
      scores: averagedByBlindKey.get(output.blindKey)!,
    }));
    const bestReference = [...refsWithScores].sort((a, b) => scoreMean(b.scores) - scoreMean(a.scores))[0];
    const originMean = scoreMean(originScores);
    const bestReferenceMean = scoreMean(bestReference.scores);
    originOverallValues.push(originMean);

    for (const criterion of ORIGIN_IMAGE_QUALITY_CRITERIA_V15) {
      originCriterionValues[criterion].push(originScores[criterion]);
      bestReferenceCriterionValues[criterion].push(bestReference.scores[criterion]);
    }

    const firstChoiceCounts = new Map<string, number>();
    for (const key of blindKeys) firstChoiceCounts.set(key, 0);
    for (const judgment of caseJudgments) {
      firstChoiceCounts.set(judgment.firstChoiceBlindKey, (firstChoiceCounts.get(judgment.firstChoiceBlindKey) ?? 0) + 1);
    }
    const originFirstChoice = firstChoiceCounts.get(origin.blindKey) ?? 0;
    const bestReferenceFirstChoice = Math.max(...referenceOutputs.map((output) => firstChoiceCounts.get(output.blindKey) ?? 0));

    if (originMean >= bestReferenceMean + SCORE_EPSILON && originFirstChoice >= bestReferenceFirstChoice) {
      wins += 1;
    } else if (originMean <= bestReferenceMean - SCORE_EPSILON || originFirstChoice < bestReferenceFirstChoice) {
      losses += 1;
    } else {
      ties += 1;
    }

    if (originMean < 2.5 || ORIGIN_IMAGE_QUALITY_CRITERIA_V15.some((criterion) => originScores[criterion] < 2)) {
      criticalFailures += 1;
    }
  }

  if (allReferenceSystemIds.size < REQUIRED_REFERENCES_PER_CASE) blockers.push('IMAGE_BENCHMARK_REFERENCE_SYSTEMS_LT_3');

  const criterionMeans = Object.fromEntries(ORIGIN_IMAGE_QUALITY_CRITERIA_V15.map((criterion) => [
    criterion,
    round4(average(originCriterionValues[criterion])),
  ])) as Record<OriginImageQualityCriterionV15, number>;
  const bestReferenceCriterionMeans = Object.fromEntries(ORIGIN_IMAGE_QUALITY_CRITERIA_V15.map((criterion) => [
    criterion,
    round4(average(bestReferenceCriterionValues[criterion])),
  ])) as Record<OriginImageQualityCriterionV15, number>;
  const overallMean = round4(average(originOverallValues));

  const absoluteQualityPassed = overallMean >= 3.35
    && ORIGIN_IMAGE_QUALITY_CRITERIA_V15.every((criterion) => criterionMeans[criterion] >= ABSOLUTE_MINIMUMS[criterion]);
  const negativeCriterionMeanCount = ORIGIN_IMAGE_QUALITY_CRITERIA_V15.filter(
    (criterion) => criterionMeans[criterion] + 0.01 < bestReferenceCriterionMeans[criterion],
  ).length;

  const evidence: OriginBlindPreferenceEvidence = {
    kind: 'blind-preference',
    candidateSha: input.candidateSha,
    evidenceId: `image:${input.roundId}:${input.corpusSha256.slice(0, 12)}`,
    artifactSha256,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    referenceSystems: allReferenceSystemIds.size,
    independentJudges: unique(input.judgments.map((judgment) => judgment.judgeId)).length,
    cases: input.cases.length,
    wins,
    ties,
    losses,
    absoluteQualityPassed,
    technicalValidationPassed: technicalFailures === 0 && !blockers.some((blocker) => blocker.includes('TECHNICAL_VALIDATION_FAILED')),
    negativeCriterionMeanCount,
    criticalFailures,
  };

  if (!absoluteQualityPassed) blockers.push('IMAGE_BENCHMARK_ABSOLUTE_QUALITY_NOT_PASSED');
  if (criticalFailures > 0) blockers.push('IMAGE_BENCHMARK_CRITICAL_FAILURES_PRESENT');
  if (negativeCriterionMeanCount > 0) blockers.push('IMAGE_BENCHMARK_NEGATIVE_CRITERION_MEAN');
  if (input.cases.length > 0) {
    const winRate = wins / input.cases.length;
    const lossRate = losses / input.cases.length;
    const nonLossRate = (wins + ties) / input.cases.length;
    if (winRate < 0.5) blockers.push('IMAGE_BENCHMARK_WIN_RATE_LT_50');
    if (lossRate > 0.3) blockers.push('IMAGE_BENCHMARK_LOSS_RATE_GT_30');
    if (nonLossRate < 0.6) blockers.push('IMAGE_BENCHMARK_NON_LOSS_RATE_LT_60');
  }

  return {
    version: ORIGIN_IMAGE_QUALITY_BENCHMARK_VERSION_V15,
    candidateSha: input.candidateSha,
    roundId: input.roundId,
    passed: blockers.length === 0,
    blockers,
    wins,
    ties,
    losses,
    overallMean,
    criterionMeans,
    bestReferenceCriterionMeans,
    evidence,
  };
}
