// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  ORIGIN_AQ_V2_AXES,
  ORIGIN_AQ_V2_FAMILIES,
  type OriginAnswerExperienceObservationV2,
} from "./OriginAnswerExperienceV2.js";
import { digestOriginAnswerExperienceRubricV2 } from "./OriginAnswerExperienceRubricV2.js";
import type { OriginTrustedAnswerRunAggregateV2 } from "./OriginTrustedAnswerRunV2.js";
import {
  qualifyOriginTrustedAnswerQualityV2,
  type OriginTrustedAnswerScoreBundleV2,
} from "./OriginTrustedAnswerQualityV2.js";

const candidateSha = "a".repeat(40);
const corpusDigest = "b".repeat(64);
const resultDigest = "c".repeat(64);
const roundId = "round-independent-score-v2";
const nowMs = Date.parse("2026-09-24T00:00:00.000Z");

const scoringBindings = ORIGIN_AQ_V2_FAMILIES.flatMap((family, familyIndex) =>
  Array.from({ length: 3 }, (_, index) => ({
    caseId: `aq2-${String(familyIndex + 1).padStart(2, "0")}-${index + 1}`,
    family,
    answerDigest: (familyIndex * 3 + index).toString(16).padStart(2, "0") + "d".repeat(62),
  })),
);

function run(): OriginTrustedAnswerRunAggregateV2 {
  return {
    schemaVersion: "origin.trusted-answer-run-aggregate.v2",
    evidence: {
      schemaVersion: "origin.answer-trusted-execution.v2",
      candidateSha,
      corpusDigest,
      executionId: "gh-run:12345678:aq-v2",
      exactCandidateBound: true,
      sameRepoOpenPrHead: true,
      trustedHostControlled: true,
      sealedCorpusNotExposedBeforeRequest: true,
      providerCredentialWithheldFromCandidate: true,
      providerProxyEnforced: true,
      freeOnlyEnforced: true,
      zeroCostVerified: true,
      candidateExternalNetworkBlocked: true,
      candidateArtifactsSanitized: true,
      candidateLogsSanitized: true,
      promptLeakDetected: false,
      secretLeakDetected: false,
      providerRequestCount: 48,
      maxProviderRequests: 48,
      resultDigest,
    },
    qualification: {
      schemaVersion: "origin.answer-trusted-execution-qualification.v2",
      passed: true,
      blockers: [],
    },
    binding: {
      schemaVersion: "origin.answer-evaluation-binding.v2",
      candidateSha,
      corpusDigest,
      evaluatorSha: "e".repeat(40),
      rubricDigest: digestOriginAnswerExperienceRubricV2(),
      roundId,
    },
    completedCases: 48,
    familyCounts: Object.freeze(Object.fromEntries(ORIGIN_AQ_V2_FAMILIES.map(family => [family, 3]))),
    scoringBindings,
  };
}

function observation(index: number): OriginAnswerExperienceObservationV2 & { answerDigest: string } {
  const binding = scoringBindings[index];
  return {
    caseId: binding.caseId,
    family: binding.family,
    answerDigest: binding.answerDigest,
    scores: Object.freeze(Object.fromEntries(ORIGIN_AQ_V2_AXES.map(axis => [axis, 4])) as Record<(typeof ORIGIN_AQ_V2_AXES)[number], 4>),
    p0DefectCount: 0,
    p1DefectCount: 0,
    unsupportedMaterialClaimCount: 0,
    mobile390Checked: true,
    desktop1440Checked: true,
    horizontalOverflowDetected: false,
    clippedCriticalContent: false,
    headingHierarchyViolation: false,
    mobileTableFailure: false,
  };
}

function bundle(): OriginTrustedAnswerScoreBundleV2 {
  return {
    schemaVersion: "origin.trusted-answer-score-bundle.v2",
    candidateSha,
    corpusDigest,
    roundId,
    resultDigest,
    rubricDigest: digestOriginAnswerExperienceRubricV2(),
    evaluator: {
      source: "controlled-external",
      evaluatorId: "independent-evaluator:external-v1",
      independentFromCandidate: true,
      evidenceId: "external-score:12345678",
      artifactDigest: `sha256:${"f".repeat(64)}`,
      createdAt: "2026-09-23T23:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
    },
    observations: scoringBindings.map((_, index) => observation(index)),
  };
}

describe("AQ V2 independently scored quality binding", () => {
  it("passes only when exact execution, answers, evaluator and quality thresholds all bind", () => {
    const report = qualifyOriginTrustedAnswerQualityV2(run(), bundle(), nowMs);
    expect(report.passed).toBe(true);
    expect(report.executionPassed).toBe(true);
    expect(report.scoringIdentityBound).toBe(true);
    expect(report.absoluteQualityPassed).toBe(true);
    expect(report.aggregate?.caseCount).toBe(48);
    expect(report.aggregate?.familyCount).toBe(16);
    expect(report.blockers).toEqual([]);
  });

  it("does not treat trusted execution completion as answer-quality acceptance", () => {
    const report = qualifyOriginTrustedAnswerQualityV2(run(), null, nowMs);
    expect(report.passed).toBe(false);
    expect(report.executionPassed).toBe(true);
    expect(report.absoluteQualityPassed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_EXTERNAL_SCORE_BUNDLE_MISSING");
  });

  it("rejects scores that are not bound to the exact candidate answer digest", () => {
    const value = bundle();
    const observations = [...value.observations];
    observations[0] = { ...observations[0], answerDigest: "0".repeat(64) };
    const report = qualifyOriginTrustedAnswerQualityV2(run(), { ...value, observations }, nowMs);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_EXTERNAL_SCORE_ANSWER_BINDING_MISMATCH");
  });

  it("rejects stale or non-independent evaluator provenance", () => {
    const value = bundle();
    const report = qualifyOriginTrustedAnswerQualityV2(run(), {
      ...value,
      evaluator: {
        ...value.evaluator,
        expiresAt: "2026-09-23T23:30:00.000Z",
      },
    }, nowMs);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_EXTERNAL_EVALUATOR_INVALID");
  });

  it("applies the existing AQ V2 absolute quality thresholds and defect blockers", () => {
    const value = bundle();
    const observations = [...value.observations];
    observations[0] = {
      ...observations[0],
      scores: Object.freeze(Object.fromEntries(ORIGIN_AQ_V2_AXES.map(axis => [axis, 0])) as Record<(typeof ORIGIN_AQ_V2_AXES)[number], 0>),
      unsupportedMaterialClaimCount: 1,
    };
    const report = qualifyOriginTrustedAnswerQualityV2(run(), { ...value, observations }, nowMs);
    expect(report.passed).toBe(false);
    expect(report.absoluteQualityPassed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_UNSUPPORTED_MATERIAL_CLAIM");
    expect(report.blockers).toContain("AQ_V2_FAMILY_BELOW_MINIMUM");
  });

  it("fails when trusted execution itself did not qualify", () => {
    const value = run();
    const report = qualifyOriginTrustedAnswerQualityV2({
      ...value,
      qualification: { ...value.qualification, passed: false, blockers: ["synthetic-execution-failure"] },
    }, bundle(), nowMs);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain("AQ_V2_TRUSTED_EXECUTION_NOT_QUALIFIED");
  });
});
