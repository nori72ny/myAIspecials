import { createHash } from 'node:crypto';

export const ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA = 'origin.image-blind-benchmark.v1' as const;

export const IMAGE_FAMILIES_V15 = [
  'photograph',
  'portrait',
  'product',
  'advertisement',
  'social',
  'poster',
  'thumbnail',
  'illustration',
] as const;

export type ImageFamilyV15 = (typeof IMAGE_FAMILIES_V15)[number];

export const IMAGE_RUBRIC_AXES_V15 = [
  'promptAdherence',
  'composition',
  'subjectIntegrity',
  'styleExecution',
  'textHandling',
  'artifacting',
  'usefulness',
] as const;

export type ImageRubricAxisV15 = (typeof IMAGE_RUBRIC_AXES_V15)[number];

export type ImageTechnicalEvidenceV15 = {
  signatureValid: boolean;
  dimensionsValid: boolean;
  structuralCriticPassed: boolean;
  technicalCriticPassed: boolean;
  safetyPassed: boolean;
  deliveryIntegrityPassed: boolean;
};

export type ImageJudgeScoreV15 = {
  judgeId: string;
  preferred: 'origin' | 'reference' | 'tie';
  scores: Record<ImageRubricAxisV15, number>;
};

export type ImageBenchmarkCaseV15 = {
  caseId: string;
  family: ImageFamilyV15;
  promptSha256: string;
  originImageSha256: string;
  referenceSystemIds: readonly string[];
  technical: ImageTechnicalEvidenceV15;
  judges: readonly ImageJudgeScoreV15[];
};

export type OriginImageBlindBenchmarkInputV15 = {
  schema: typeof ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA;
  candidateSha: string;
  evaluatorSha: string;
  roundId: string;
  createdAt: string;
  cases: readonly ImageBenchmarkCaseV15[];
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
  familyNonLossRate: Record<ImageFamilyV15, number>;
  axisMeanDeltaFromNeutral: Record<ImageRubricAxisV15, number>;
  blockers: string[];
  evidenceSha256: string;
};

const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const SCORE_MIN = 0;
const SCORE_MAX = 4;
const REQUIRED_CASES_PER_FAMILY = 3;
const REQUIRED_CASES = IMAGE_FAMILIES_V15.length * REQUIRED_CASES_PER_FAMILY;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function validJudgeScore(score: ImageJudgeScoreV15): boolean {
  if (!score.judgeId.trim()) return false;
  return IMAGE_RUBRIC_AXES_V15.every((axis) => {
    const value = score.scores[axis];
    return Number.isFinite(value) && value >= SCORE_MIN && value <= SCORE_MAX;
  });
}

function technicalPassed(technical: ImageTechnicalEvidenceV15): boolean {
  return Object.values(technical).every(Boolean);
}

export function evaluateOriginImageBlindBenchmarkV15(
  input: OriginImageBlindBenchmarkInputV15,
): OriginImageBlindBenchmarkReportV15 {
  const blockers: string[] = [];
  const emptyFamilyRates = Object.fromEntries(IMAGE_FAMILIES_V15.map((family) => [family, 0])) as Record<ImageFamilyV15, number>;
  const emptyAxisMeans = Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, 0])) as Record<ImageRubricAxisV15, number>;

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
    familyNonLossRate: emptyFamilyRates,
    axisMeanDeltaFromNeutral: emptyAxisMeans,
  };

  if (
    input.schema !== ORIGIN_IMAGE_BLIND_BENCHMARK_SCHEMA
    || !FULL_SHA.test(input.candidateSha)
    || !FULL_SHA.test(input.evaluatorSha)
    || !input.roundId.trim()
    || !Number.isFinite(Date.parse(input.createdAt))
  ) {
    return {
      ...baseReport,
      passed: false,
      blockers: ['IMAGE_BENCHMARK_INPUT_INVALID'],
      evidenceSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    };
  }

  if (input.cases.length !== REQUIRED_CASES) blockers.push('IMAGE_BENCHMARK_REQUIRES_24_CASES');

  const ids = input.cases.map((item) => item.caseId);
  if (unique(ids).length !== ids.length || ids.some((id) => !id.trim())) blockers.push('IMAGE_BENCHMARK_CASE_IDS_INVALID');

  for (const family of IMAGE_FAMILIES_V15) {
    const count = input.cases.filter((item) => item.family === family).length;
    if (count !== REQUIRED_CASES_PER_FAMILY) blockers.push(`IMAGE_BENCHMARK_FAMILY_COUNT_INVALID:${family}`);
  }

  let wins = 0;
  let ties = 0;
  let losses = 0;
  const familyTally = Object.fromEntries(
    IMAGE_FAMILIES_V15.map((family) => [family, { wins: 0, ties: 0, losses: 0 }]),
  ) as Record<ImageFamilyV15, { wins: number; ties: number; losses: number }>;
  const axisTotals = Object.fromEntries(IMAGE_RUBRIC_AXES_V15.map((axis) => [axis, 0])) as Record<ImageRubricAxisV15, number>;
  let axisJudgeCount = 0;

  for (const item of input.cases) {
    if (!DIGEST.test(item.promptSha256) || !DIGEST.test(item.originImageSha256)) {
      blockers.push(`IMAGE_BENCHMARK_DIGEST_INVALID:${item.caseId}`);
    }
    if (!IMAGE_FAMILIES_V15.includes(item.family)) blockers.push(`IMAGE_BENCHMARK_FAMILY_INVALID:${item.caseId}`);
    if (!technicalPassed(item.technical)) blockers.push(`IMAGE_BENCHMARK_TECHNICAL_FAILURE:${item.caseId}`);

    const refs = unique(item.referenceSystemIds.filter(Boolean));
    if (refs.length < 3) blockers.push(`IMAGE_BENCHMARK_REFERENCE_SYSTEMS_LT_3:${item.caseId}`);

    const judges = item.judges.filter(validJudgeScore);
    if (unique(judges.map((judge) => judge.judgeId)).length < 2) {
      blockers.push(`IMAGE_BENCHMARK_INDEPENDENT_JUDGES_LT_2:${item.caseId}`);
      continue;
    }

    const preferenceCounts = judges.reduce(
      (acc, judge) => {
        acc[judge.preferred] += 1;
        return acc;
      },
      { origin: 0, reference: 0, tie: 0 },
    );

    const caseOutcome = preferenceCounts.origin > preferenceCounts.reference
      ? 'win'
      : preferenceCounts.reference > preferenceCounts.origin
        ? 'loss'
        : 'tie';

    if (caseOutcome === 'win') {
      wins += 1;
      familyTally[item.family].wins += 1;
    } else if (caseOutcome === 'loss') {
      losses += 1;
      familyTally[item.family].losses += 1;
    } else {
      ties += 1;
      familyTally[item.family].ties += 1;
    }

    for (const judge of judges) {
      for (const axis of IMAGE_RUBRIC_AXES_V15) axisTotals[axis] += judge.scores[axis] - 2;
      axisJudgeCount += 1;
    }
  }

  const total = wins + ties + losses;
  const winRate = total ? wins / total : 0;
  const lossRate = total ? losses / total : 1;
  const nonLossRate = total ? (wins + ties) / total : 0;

  if (winRate < 0.5) blockers.push('IMAGE_BENCHMARK_WIN_RATE_LT_50');
  if (lossRate > 0.3) blockers.push('IMAGE_BENCHMARK_LOSS_RATE_GT_30');
  if (nonLossRate < 0.6) blockers.push('IMAGE_BENCHMARK_NON_LOSS_RATE_LT_60');

  const familyNonLossRate = Object.fromEntries(
    IMAGE_FAMILIES_V15.map((family) => {
      const tally = familyTally[family];
      const familyTotal = tally.wins + tally.ties + tally.losses;
      const rate = familyTotal ? (tally.wins + tally.ties) / familyTotal : 0;
      if (rate < 0.6) blockers.push(`IMAGE_BENCHMARK_FAMILY_NON_LOSS_LT_60:${family}`);
      return [family, round4(rate)];
    }),
  ) as Record<ImageFamilyV15, number>;

  const axisMeanDeltaFromNeutral = Object.fromEntries(
    IMAGE_RUBRIC_AXES_V15.map((axis) => {
      const mean = axisJudgeCount ? axisTotals[axis] / axisJudgeCount : -2;
      if (mean < 0) blockers.push(`IMAGE_BENCHMARK_NEGATIVE_AXIS_MEAN:${axis}`);
      return [axis, round4(mean)];
    }),
  ) as Record<ImageRubricAxisV15, number>;

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
    familyNonLossRate,
    axisMeanDeltaFromNeutral,
    blockers,
    evidenceSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
  };
}
