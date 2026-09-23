import type { OriginAnswerExperienceFamilyV2 } from "./OriginAnswerExperienceV2.js";

export const ORIGIN_AQ_V2_BLIND_CRITERIA = Object.freeze([
  "correctness",
  "clarity",
  "structure",
  "conciseness",
  "usefulness",
  "evidenceUse",
] as const);

export type OriginBlindPreferenceCriterionV2 = (typeof ORIGIN_AQ_V2_BLIND_CRITERIA)[number];
export type OriginBlindPreferenceValueV2 = -1 | 0 | 1;

export interface OriginBlindPreferenceVoteV2 {
  readonly caseId: string;
  readonly family: OriginAnswerExperienceFamilyV2;
  readonly opponentId: string;
  readonly judgeId: string;
  /** 1 = ORIGIN preferred, 0 = tie, -1 = opponent preferred. */
  readonly overall: OriginBlindPreferenceValueV2;
  readonly criteria: Readonly<Record<OriginBlindPreferenceCriterionV2, OriginBlindPreferenceValueV2>>;
}

export interface OriginBlindPreferenceReportV2 {
  readonly schemaVersion: "origin.answer-blind-preference.v2";
  readonly voteCount: number;
  readonly caseCount: number;
  readonly opponentCount: number;
  readonly judgeCount: number;
  readonly winRate: number;
  readonly tieRate: number;
  readonly lossRate: number;
  readonly meanCriterionPreference: Readonly<Record<OriginBlindPreferenceCriterionV2, number>>;
  readonly minimumFamilyNonLossRate: number;
  readonly competitiveEvidencePassed: boolean;
  readonly blockers: readonly string[];
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/.test(value);
}

function validPreference(value: number): value is OriginBlindPreferenceValueV2 {
  return value === -1 || value === 0 || value === 1;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateOriginBlindPreferenceV2(
  votes: readonly OriginBlindPreferenceVoteV2[],
): OriginBlindPreferenceReportV2 {
  if (votes.length === 0) throw new Error("AQ_V2_BLIND_EMPTY");
  for (const vote of votes) {
    if (!validId(vote.caseId) || !validId(vote.opponentId) || !validId(vote.judgeId)) {
      throw new Error("AQ_V2_BLIND_ID_INVALID");
    }
    if (!validPreference(vote.overall) || !ORIGIN_AQ_V2_BLIND_CRITERIA.every(key => validPreference(vote.criteria[key]))) {
      throw new Error("AQ_V2_BLIND_SCORE_INVALID");
    }
  }

  const cases = new Set(votes.map(vote => vote.caseId));
  const opponents = new Set(votes.map(vote => vote.opponentId));
  const judges = new Set(votes.map(vote => vote.judgeId));

  const wins = votes.filter(vote => vote.overall === 1).length;
  const ties = votes.filter(vote => vote.overall === 0).length;
  const losses = votes.filter(vote => vote.overall === -1).length;

  const families = [...new Set(votes.map(vote => vote.family))];
  const familyNonLossRates = families.map(family => {
    const familyVotes = votes.filter(vote => vote.family === family);
    return mean(familyVotes.map(vote => vote.overall >= 0 ? 1 : 0));
  });

  const meanCriterionPreference = Object.fromEntries(
    ORIGIN_AQ_V2_BLIND_CRITERIA.map(key => [key, mean(votes.map(vote => vote.criteria[key]))]),
  ) as Record<OriginBlindPreferenceCriterionV2, number>;

  const blockers: string[] = [];
  if (cases.size < 48) blockers.push("AQ_V2_BLIND_CASE_COVERAGE_INCOMPLETE");
  if (opponents.size < 3) blockers.push("AQ_V2_BLIND_OPPONENT_COVERAGE_INCOMPLETE");
  if (judges.size < 2) blockers.push("AQ_V2_BLIND_JUDGE_COVERAGE_INCOMPLETE");
  const winRate = wins / votes.length;
  const tieRate = ties / votes.length;
  const lossRate = losses / votes.length;
  const minimumFamilyNonLossRate = Math.min(...familyNonLossRates);
  if (winRate < 0.5) blockers.push("AQ_V2_BLIND_WIN_RATE_TOO_LOW");
  if (lossRate > 0.3) blockers.push("AQ_V2_BLIND_LOSS_RATE_TOO_HIGH");
  if (minimumFamilyNonLossRate < 0.6) blockers.push("AQ_V2_BLIND_FAMILY_NONLOSS_TOO_LOW");
  if (Object.values(meanCriterionPreference).some(value => value < 0)) {
    blockers.push("AQ_V2_BLIND_CRITERION_NET_LOSS");
  }

  return Object.freeze({
    schemaVersion: "origin.answer-blind-preference.v2",
    voteCount: votes.length,
    caseCount: cases.size,
    opponentCount: opponents.size,
    judgeCount: judges.size,
    winRate,
    tieRate,
    lossRate,
    meanCriterionPreference: Object.freeze(meanCriterionPreference),
    minimumFamilyNonLossRate,
    competitiveEvidencePassed: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}
