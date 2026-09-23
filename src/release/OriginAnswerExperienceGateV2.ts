export const ORIGIN_ANSWER_EXPERIENCE_V2 = "origin.answer-experience.v2" as const;

export type OriginAnswerExperienceSurfaceV2 =
  | "chat"
  | "research"
  | "coding"
  | "artifact";

export type OriginAnswerExperienceLocaleV2 = "ja" | "en";

export type OriginAnswerExperienceModeV2 =
  | "direct"
  | "decision"
  | "deliverable"
  | "research";

export interface OriginAnswerExperienceSemanticScoresV2 {
  readonly intentAlignment: number;
  readonly directness: number;
  readonly clarity: number;
  readonly structure: number;
  readonly informationDensity: number;
  readonly taskFit: number;
  readonly actionability: number;
}

export interface OriginAnswerExperienceSemanticObservationV2 {
  readonly caseId: string;
  readonly family: string;
  readonly surface: OriginAnswerExperienceSurfaceV2;
  readonly locale: OriginAnswerExperienceLocaleV2;
  readonly mode: OriginAnswerExperienceModeV2;
  readonly scores: OriginAnswerExperienceSemanticScoresV2;
}

export interface OriginAnswerExperienceRenderObservationV2 {
  readonly caseId: string;
  readonly viewport: 390 | 768 | 1440;
  readonly noHorizontalOverflow: boolean;
  readonly textContrastAA: boolean;
  readonly headingHierarchyValid: boolean;
  readonly primaryAnswerReadable: boolean;
  readonly touchTargets44px: boolean | null;
  readonly tableMobileFallback: boolean | null;
  readonly codeReadable: boolean | null;
}

export interface OriginAnswerExperienceBlindJudgmentV2 {
  readonly caseId: string;
  readonly surface: OriginAnswerExperienceSurfaceV2;
  readonly judgeId: string;
  readonly competitorId: string;
  readonly candidateDigest: string;
  readonly competitorDigest: string;
  readonly presentedCandidateAs: "A" | "B";
  readonly winner: "candidate" | "competitor" | "tie";
}

export interface OriginAnswerExperienceGateInputV2 {
  readonly semantics: readonly OriginAnswerExperienceSemanticObservationV2[];
  readonly renders: readonly OriginAnswerExperienceRenderObservationV2[];
  readonly blind: readonly OriginAnswerExperienceBlindJudgmentV2[];
}

export interface OriginAnswerExperienceGateReportV2 {
  readonly schemaVersion: typeof ORIGIN_ANSWER_EXPERIENCE_V2;
  readonly semanticCaseCount: number;
  readonly renderCaseCount: number;
  readonly blindComparisonCount: number;
  readonly independentJudgeCount: number;
  readonly semanticMeans: OriginAnswerExperienceSemanticScoresV2;
  readonly blindWinRate: number;
  readonly blindNonLossRate: number;
  readonly candidatePresentedAsARate: number;
  readonly blockers: readonly OriginAnswerExperienceGateBlockerV2[];
  readonly promotionEligible: boolean;
}

export type OriginAnswerExperienceGateBlockerV2 =
  | "SEMANTIC_COVERAGE_INCOMPLETE"
  | "SEMANTIC_ABSOLUTE_QUALITY_LOW"
  | "SEMANTIC_CASE_HAS_MATERIAL_WEAKNESS"
  | "RENDER_COVERAGE_INCOMPLETE"
  | "RENDER_EVIDENCE_INVALID"
  | "RENDER_REGRESSION"
  | "BLIND_EVIDENCE_INSUFFICIENT"
  | "BLIND_EVIDENCE_INVALID"
  | "BLIND_ORDER_IMBALANCED"
  | "BLIND_WIN_RATE_LOW"
  | "BLIND_SURFACE_REGRESSION";

const SCORE_KEYS = [
  "intentAlignment",
  "directness",
  "clarity",
  "structure",
  "informationDensity",
  "taskFit",
  "actionability",
] as const satisfies readonly (keyof OriginAnswerExperienceSemanticScoresV2)[];

const REQUIRED_SURFACES = [
  "chat",
  "research",
  "coding",
  "artifact",
] as const satisfies readonly OriginAnswerExperienceSurfaceV2[];

const REQUIRED_VIEWPORTS = [390, 768, 1440] as const;

function validScore(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 4;
}

function validSemantic(item: OriginAnswerExperienceSemanticObservationV2): boolean {
  return item.caseId.trim().length > 0
    && item.family.trim().length > 0
    && SCORE_KEYS.every((key) => validScore(item.scores[key]));
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function semanticMeans(
  observations: readonly OriginAnswerExperienceSemanticObservationV2[],
): OriginAnswerExperienceSemanticScoresV2 {
  return Object.freeze(Object.fromEntries(
    SCORE_KEYS.map((key) => [key, mean(observations.map((item) => item.scores[key]))]),
  ) as unknown as OriginAnswerExperienceSemanticScoresV2);
}

function semanticCoverageComplete(
  observations: readonly OriginAnswerExperienceSemanticObservationV2[],
): boolean {
  if (observations.length < 24 || !observations.every(validSemantic)) return false;
  if (new Set(observations.map((item) => item.caseId)).size !== observations.length) return false;
  if (!REQUIRED_SURFACES.every((surface) =>
    observations.filter((item) => item.surface === surface).length >= 4
  )) return false;
  const families = [...new Set(observations.map((item) => item.family))];
  if (families.length < 8 || families.some((family) =>
    observations.filter((item) => item.family === family).length < 2
  )) return false;
  if (!["ja", "en"].every((locale) =>
    observations.filter((item) => item.locale === locale).length >= 4
  )) return false;
  return true;
}

function rendersComplete(
  renders: readonly OriginAnswerExperienceRenderObservationV2[],
): boolean {
  if (renders.length < 12) return false;
  const unique = new Set(renders.map((item) => `${item.caseId}\t${item.viewport}`));
  if (unique.size !== renders.length) return false;
  return REQUIRED_VIEWPORTS.every((viewport) =>
    renders.filter((item) => item.viewport === viewport).length >= 4
  );
}

function renderPassed(item: OriginAnswerExperienceRenderObservationV2): boolean {
  return item.caseId.trim().length > 0
    && item.noHorizontalOverflow
    && item.textContrastAA
    && item.headingHierarchyValid
    && item.primaryAnswerReadable
    && (item.viewport !== 390 || item.touchTargets44px !== false)
    && item.tableMobileFallback !== false
    && item.codeReadable !== false;
}

function validDigest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function validBlind(item: OriginAnswerExperienceBlindJudgmentV2): boolean {
  return item.caseId.trim().length > 0
    && item.judgeId.trim().length > 0
    && item.competitorId.trim().length > 0
    && validDigest(item.candidateDigest)
    && validDigest(item.competitorDigest)
    && item.candidateDigest !== item.competitorDigest;
}

function surfaceWinRate(
  judgments: readonly OriginAnswerExperienceBlindJudgmentV2[],
  surface: OriginAnswerExperienceSurfaceV2,
): number {
  const rows = judgments.filter((item) => item.surface === surface);
  return rows.length === 0
    ? 0
    : rows.filter((item) => item.winner === "candidate").length / rows.length;
}

export function evaluateOriginAnswerExperienceGateV2(
  input: OriginAnswerExperienceGateInputV2,
): OriginAnswerExperienceGateReportV2 {
  const blockers: OriginAnswerExperienceGateBlockerV2[] = [];
  const semantics = [...input.semantics];
  const renders = [...input.renders];
  const blind = input.blind.filter(validBlind);

  if (!semanticCoverageComplete(semantics)) {
    blockers.push("SEMANTIC_COVERAGE_INCOMPLETE");
  }

  const means = semanticMeans(semantics);
  if (SCORE_KEYS.some((key) => means[key] < 3.4)) {
    blockers.push("SEMANTIC_ABSOLUTE_QUALITY_LOW");
  }
  if (semantics.some((item) => SCORE_KEYS.some((key) => item.scores[key] < 2))) {
    blockers.push("SEMANTIC_CASE_HAS_MATERIAL_WEAKNESS");
  }

  if (!rendersComplete(renders)) {
    blockers.push("RENDER_COVERAGE_INCOMPLETE");
  }
  const renderUnique = new Set(renders.map((item) => `${item.caseId}\t${item.viewport}`));
  if (renderUnique.size !== renders.length) {
    blockers.push("RENDER_EVIDENCE_INVALID");
  }
  if (renders.some((item) => !renderPassed(item))) {
    blockers.push("RENDER_REGRESSION");
  }

  const judgeCount = new Set(blind.map((item) => item.judgeId)).size;
  const competitors = new Set(blind.map((item) => item.competitorId)).size;
  const blindUnique = new Set(blind.map((item) =>
    `${item.caseId}\t${item.judgeId}\t${item.competitorId}`
  ));
  if (input.blind.length !== blind.length || blindUnique.size !== blind.length) {
    blockers.push("BLIND_EVIDENCE_INVALID");
  }
  if (blind.length < 24 || judgeCount < 2 || competitors < 2) {
    blockers.push("BLIND_EVIDENCE_INSUFFICIENT");
  }

  const presentedAsARate = blind.length === 0
    ? 0
    : blind.filter((item) => item.presentedCandidateAs === "A").length / blind.length;
  const judgeOrderImbalanced = [...new Set(blind.map((item) => item.judgeId))].some((judgeId) => {
    const rows = blind.filter((item) => item.judgeId === judgeId);
    const asA = rows.filter((item) => item.presentedCandidateAs === "A").length / rows.length;
    return asA < 0.4 || asA > 0.6;
  });
  if (
    blind.length > 0
    && (
      presentedAsARate < 0.4
      || presentedAsARate > 0.6
      || judgeOrderImbalanced
    )
  ) {
    blockers.push("BLIND_ORDER_IMBALANCED");
  }

  const blindWinRate = blind.length === 0
    ? 0
    : blind.filter((item) => item.winner === "candidate").length / blind.length;
  const blindNonLossRate = blind.length === 0
    ? 0
    : blind.filter((item) => item.winner !== "competitor").length / blind.length;
  if (blind.length > 0 && (blindWinRate < 0.60 || blindNonLossRate < 0.80)) {
    blockers.push("BLIND_WIN_RATE_LOW");
  }

  if (
    blind.length > 0
    && REQUIRED_SURFACES.some((surface) => surfaceWinRate(blind, surface) < 0.50)
  ) {
    blockers.push("BLIND_SURFACE_REGRESSION");
  }

  return Object.freeze({
    schemaVersion: ORIGIN_ANSWER_EXPERIENCE_V2,
    semanticCaseCount: semantics.length,
    renderCaseCount: renders.length,
    blindComparisonCount: blind.length,
    independentJudgeCount: judgeCount,
    semanticMeans: means,
    blindWinRate,
    blindNonLossRate,
    candidatePresentedAsARate: presentedAsARate,
    blockers: Object.freeze([...new Set(blockers)]),
    promotionEligible: blockers.length === 0,
  });
}
