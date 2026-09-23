export const ORIGIN_AQ_V2_FAMILIES = Object.freeze([
  "current-factual",
  "research-synthesis",
  "multi-source-comparison",
  "contradiction-resolution",
  "explanation-teaching",
  "summarization",
  "writing-rewrite",
  "translation",
  "quantitative-reasoning",
  "data-analysis",
  "decision-support",
  "professional-advice",
  "coding-explanation",
  "coding-generation-repair",
  "artifact-generation",
  "ambiguity-handling",
] as const);

export type OriginAnswerExperienceFamilyV2 = (typeof ORIGIN_AQ_V2_FAMILIES)[number];
export type OriginAnswerExperienceScoreV2 = 0 | 1 | 2 | 3 | 4;

export const ORIGIN_AQ_V2_AXES = Object.freeze([
  "truth",
  "intentFit",
  "completeness",
  "structure",
  "clarity",
  "informationDensity",
  "actionability",
  "visualReadability",
  "taskFit",
  "evidenceUsability",
] as const);

export type OriginAnswerExperienceAxisV2 = (typeof ORIGIN_AQ_V2_AXES)[number];

export interface OriginAnswerExperienceCaseV2 {
  readonly caseId: string;
  readonly family: OriginAnswerExperienceFamilyV2;
}

export interface OriginAnswerExperienceManifestV2 {
  readonly schemaVersion: "origin.answer-experience-manifest.v2";
  readonly cases: readonly OriginAnswerExperienceCaseV2[];
}

export interface OriginAnswerExperienceObservationV2 {
  readonly caseId: string;
  readonly family: OriginAnswerExperienceFamilyV2;
  readonly scores: Readonly<Record<OriginAnswerExperienceAxisV2, OriginAnswerExperienceScoreV2>>;
  readonly p0DefectCount: number;
  readonly p1DefectCount: number;
  readonly unsupportedMaterialClaimCount: number;
  readonly mobile390Checked: boolean;
  readonly desktop1440Checked: boolean;
  readonly horizontalOverflowDetected: boolean;
  readonly clippedCriticalContent: boolean;
  readonly headingHierarchyViolation: boolean;
  readonly mobileTableFailure: boolean;
}

export interface OriginAnswerExperienceAggregateV2 {
  readonly schemaVersion: "origin.answer-experience-aggregate.v2";
  readonly caseCount: number;
  readonly familyCount: number;
  readonly meanByAxis: Readonly<Record<OriginAnswerExperienceAxisV2, number>>;
  readonly overallMean: number;
  readonly minimumFamilyMean: number;
  readonly p0DefectCount: number;
  readonly p1DefectCount: number;
  readonly unsupportedMaterialClaimCount: number;
  readonly visualRegressionCount: number;
  readonly fullViewportCoverage: boolean;
}

export interface OriginAnswerExperienceQualificationV2 {
  readonly schemaVersion: "origin.answer-experience-qualification.v2";
  readonly aggregate: OriginAnswerExperienceAggregateV2;
  readonly absoluteQualityPassed: boolean;
  readonly blockers: readonly string[];
}

const AXIS_MINIMUMS: Readonly<Record<OriginAnswerExperienceAxisV2, number>> = Object.freeze({
  truth: 3.75,
  intentFit: 3.6,
  completeness: 3.5,
  structure: 3.5,
  clarity: 3.5,
  informationDensity: 3.25,
  actionability: 3.4,
  visualReadability: 3.5,
  taskFit: 3.6,
  evidenceUsability: 3.5,
});

const OVERALL_MINIMUM = 3.55;
const FAMILY_MINIMUM = 3.25;
const CASES_PER_FAMILY = 3;

function validCaseId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,119}$/.test(value);
}

function validCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function observationMean(item: OriginAnswerExperienceObservationV2): number {
  return mean(ORIGIN_AQ_V2_AXES.map(axis => item.scores[axis]));
}

function validObservation(item: OriginAnswerExperienceObservationV2): boolean {
  return validCaseId(item.caseId)
    && ORIGIN_AQ_V2_FAMILIES.includes(item.family)
    && ORIGIN_AQ_V2_AXES.every(axis => Number.isInteger(item.scores[axis]) && item.scores[axis] >= 0 && item.scores[axis] <= 4)
    && validCount(item.p0DefectCount)
    && validCount(item.p1DefectCount)
    && validCount(item.unsupportedMaterialClaimCount)
    && typeof item.mobile390Checked === "boolean"
    && typeof item.desktop1440Checked === "boolean"
    && typeof item.horizontalOverflowDetected === "boolean"
    && typeof item.clippedCriticalContent === "boolean"
    && typeof item.headingHierarchyViolation === "boolean"
    && typeof item.mobileTableFailure === "boolean";
}

export function validateOriginAnswerExperienceManifestV2(
  manifest: OriginAnswerExperienceManifestV2,
): boolean {
  if (manifest.schemaVersion !== "origin.answer-experience-manifest.v2") return false;
  if (manifest.cases.length !== ORIGIN_AQ_V2_FAMILIES.length * CASES_PER_FAMILY) return false;

  const ids = new Set<string>();
  const counts = new Map<OriginAnswerExperienceFamilyV2, number>();
  for (const item of manifest.cases) {
    if (!validCaseId(item.caseId) || ids.has(item.caseId) || !ORIGIN_AQ_V2_FAMILIES.includes(item.family)) return false;
    ids.add(item.caseId);
    counts.set(item.family, (counts.get(item.family) ?? 0) + 1);
  }
  return ORIGIN_AQ_V2_FAMILIES.every(family => counts.get(family) === CASES_PER_FAMILY);
}

export function aggregateOriginAnswerExperienceV2(
  manifest: OriginAnswerExperienceManifestV2,
  observations: readonly OriginAnswerExperienceObservationV2[],
): OriginAnswerExperienceAggregateV2 {
  if (!validateOriginAnswerExperienceManifestV2(manifest)) {
    throw new Error("AQ_V2_MANIFEST_INVALID");
  }
  if (observations.length !== manifest.cases.length || !observations.every(validObservation)) {
    throw new Error("AQ_V2_OBSERVATIONS_INVALID");
  }

  const expected = new Map(manifest.cases.map(item => [item.caseId, item.family] as const));
  const seen = new Set<string>();
  for (const item of observations) {
    if (seen.has(item.caseId) || expected.get(item.caseId) !== item.family) {
      throw new Error("AQ_V2_OBSERVATION_SET_MISMATCH");
    }
    seen.add(item.caseId);
  }

  const meanByAxis = Object.fromEntries(
    ORIGIN_AQ_V2_AXES.map(axis => [axis, mean(observations.map(item => item.scores[axis]))]),
  ) as Record<OriginAnswerExperienceAxisV2, number>;

  const familyMeans = ORIGIN_AQ_V2_FAMILIES.map(family =>
    mean(observations.filter(item => item.family === family).map(observationMean)),
  );

  const visualRegressionCount = observations.reduce((sum, item) =>
    sum
    + (item.horizontalOverflowDetected ? 1 : 0)
    + (item.clippedCriticalContent ? 1 : 0)
    + (item.headingHierarchyViolation ? 1 : 0)
    + (item.mobileTableFailure ? 1 : 0), 0);

  return Object.freeze({
    schemaVersion: "origin.answer-experience-aggregate.v2",
    caseCount: observations.length,
    familyCount: ORIGIN_AQ_V2_FAMILIES.length,
    meanByAxis: Object.freeze(meanByAxis),
    overallMean: mean(observations.map(observationMean)),
    minimumFamilyMean: Math.min(...familyMeans),
    p0DefectCount: observations.reduce((sum, item) => sum + item.p0DefectCount, 0),
    p1DefectCount: observations.reduce((sum, item) => sum + item.p1DefectCount, 0),
    unsupportedMaterialClaimCount: observations.reduce((sum, item) => sum + item.unsupportedMaterialClaimCount, 0),
    visualRegressionCount,
    fullViewportCoverage: observations.every(item => item.mobile390Checked && item.desktop1440Checked),
  });
}

export function qualifyOriginAnswerExperienceV2(
  manifest: OriginAnswerExperienceManifestV2,
  observations: readonly OriginAnswerExperienceObservationV2[],
): OriginAnswerExperienceQualificationV2 {
  const aggregate = aggregateOriginAnswerExperienceV2(manifest, observations);
  const blockers: string[] = [];

  for (const axis of ORIGIN_AQ_V2_AXES) {
    if (aggregate.meanByAxis[axis] < AXIS_MINIMUMS[axis]) {
      blockers.push(`AQ_V2_AXIS_BELOW_MINIMUM:${axis}`);
    }
  }
  if (aggregate.overallMean < OVERALL_MINIMUM) blockers.push("AQ_V2_OVERALL_BELOW_MINIMUM");
  if (aggregate.minimumFamilyMean < FAMILY_MINIMUM) blockers.push("AQ_V2_FAMILY_BELOW_MINIMUM");
  if (aggregate.p0DefectCount !== 0) blockers.push("AQ_V2_P0_DEFECT");
  if (aggregate.p1DefectCount !== 0) blockers.push("AQ_V2_P1_DEFECT");
  if (aggregate.unsupportedMaterialClaimCount !== 0) blockers.push("AQ_V2_UNSUPPORTED_MATERIAL_CLAIM");
  if (aggregate.visualRegressionCount !== 0) blockers.push("AQ_V2_VISUAL_REGRESSION");
  if (!aggregate.fullViewportCoverage) blockers.push("AQ_V2_VIEWPORT_COVERAGE_INCOMPLETE");

  return Object.freeze({
    schemaVersion: "origin.answer-experience-qualification.v2",
    aggregate,
    absoluteQualityPassed: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

export const ORIGIN_AQ_V2_THRESHOLDS = Object.freeze({
  axisMinimums: AXIS_MINIMUMS,
  overallMinimum: OVERALL_MINIMUM,
  familyMinimum: FAMILY_MINIMUM,
  casesPerFamily: CASES_PER_FAMILY,
  requiredCaseCount: ORIGIN_AQ_V2_FAMILIES.length * CASES_PER_FAMILY,
});
