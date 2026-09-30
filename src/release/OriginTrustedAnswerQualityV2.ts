import {
  ORIGIN_AQ_V2_FAMILIES,
  qualifyOriginAnswerExperienceV2,
  type OriginAnswerExperienceAggregateV2,
  type OriginAnswerExperienceObservationV2,
} from "./OriginAnswerExperienceV2.js";
import { digestOriginAnswerExperienceRubricV2 } from "./OriginAnswerExperienceRubricV2.js";
import type { OriginTrustedAnswerRunAggregateV2 } from "./OriginTrustedAnswerRunV2.js";

export interface OriginTrustedAnswerScoredObservationV2 extends OriginAnswerExperienceObservationV2 {
  readonly answerDigest: string;
}

export interface OriginTrustedAnswerExternalEvaluatorV2 {
  readonly source: "controlled-external";
  readonly evaluatorId: string;
  readonly independentFromCandidate: true;
  readonly evidenceId: string;
  readonly artifactDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface OriginTrustedAnswerScoreBundleV2 {
  readonly schemaVersion: "origin.trusted-answer-score-bundle.v2";
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly roundId: string;
  readonly resultDigest: string;
  readonly rubricDigest: string;
  readonly evaluator: OriginTrustedAnswerExternalEvaluatorV2;
  readonly observations: readonly OriginTrustedAnswerScoredObservationV2[];
}

export interface OriginTrustedAnswerQualityQualificationV2 {
  readonly schemaVersion: "origin.trusted-answer-quality-qualification.v2";
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly executionPassed: boolean;
  readonly scoringIdentityBound: boolean;
  readonly absoluteQualityPassed: boolean;
  readonly aggregate: OriginAnswerExperienceAggregateV2 | null;
  readonly passed: boolean;
  readonly blockers: readonly string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const EVALUATOR_ID = /^[A-Za-z0-9._:/-]{3,160}$/;
const EVIDENCE_ID = /^[A-Za-z0-9._:/-]{8,180}$/;
const MAX_EVIDENCE_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function validEvaluator(
  evaluator: OriginTrustedAnswerExternalEvaluatorV2 | null | undefined,
  nowMs: number,
): boolean {
  if (!evaluator || evaluator.source !== "controlled-external" || evaluator.independentFromCandidate !== true) return false;
  if (!EVALUATOR_ID.test(evaluator.evaluatorId) || !EVIDENCE_ID.test(evaluator.evidenceId)) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(evaluator.artifactDigest)) return false;
  const createdAt = Date.parse(evaluator.createdAt);
  const expiresAt = Date.parse(evaluator.expiresAt);
  return Number.isFinite(createdAt)
    && Number.isFinite(expiresAt)
    && createdAt <= nowMs + MAX_CLOCK_SKEW_MS
    && expiresAt > nowMs
    && expiresAt >= createdAt
    && expiresAt - createdAt <= MAX_EVIDENCE_LIFETIME_MS;
}

export function qualifyOriginTrustedAnswerQualityV2(
  run: OriginTrustedAnswerRunAggregateV2 | null,
  bundle: OriginTrustedAnswerScoreBundleV2 | null,
  nowMs: number = Date.now(),
): OriginTrustedAnswerQualityQualificationV2 {
  const blockers: string[] = [];
  const candidateSha = run?.evidence.candidateSha ?? bundle?.candidateSha ?? "unknown";
  const corpusDigest = run?.evidence.corpusDigest ?? bundle?.corpusDigest ?? "unknown";
  const executionPassed = run?.qualification.passed === true;
  if (!executionPassed) blockers.push("AQ_V2_TRUSTED_EXECUTION_NOT_QUALIFIED");

  let scoringIdentityBound = false;
  let absoluteQualityPassed = false;
  let aggregate: OriginAnswerExperienceAggregateV2 | null = null;

  if (!run || !bundle || bundle.schemaVersion !== "origin.trusted-answer-score-bundle.v2") {
    blockers.push("AQ_V2_EXTERNAL_SCORE_BUNDLE_MISSING");
  } else {
    const identityMatches =
      bundle.candidateSha === run.evidence.candidateSha
      && bundle.corpusDigest === run.evidence.corpusDigest
      && bundle.roundId === run.binding.roundId
      && bundle.resultDigest === run.evidence.resultDigest
      && bundle.rubricDigest === run.binding.rubricDigest
      && bundle.rubricDigest === digestOriginAnswerExperienceRubricV2();

    if (!identityMatches) blockers.push("AQ_V2_EXTERNAL_SCORE_IDENTITY_MISMATCH");
    if (!validEvaluator(bundle.evaluator, nowMs)) blockers.push("AQ_V2_EXTERNAL_EVALUATOR_INVALID");

    const bindings = Array.isArray(run.scoringBindings) ? run.scoringBindings : [];
    const expected = new Map(bindings.map(item => [item.caseId, item]));
    const observations = Array.isArray(bundle.observations) ? bundle.observations : [];
    const seen = new Set<string>();
    const observationBindingsValid =
      bindings.length === ORIGIN_AQ_V2_FAMILIES.length * 3
      && observations.length === bindings.length
      && observations.every(item => {
        const binding = expected.get(item.caseId);
        if (!binding || seen.has(item.caseId) || !SHA256.test(item.answerDigest)) return false;
        seen.add(item.caseId);
        return item.family === binding.family && item.answerDigest === binding.answerDigest;
      });

    if (!observationBindingsValid) blockers.push("AQ_V2_EXTERNAL_SCORE_ANSWER_BINDING_MISMATCH");

    if (
      identityMatches
      && validEvaluator(bundle.evaluator, nowMs)
      && observationBindingsValid
    ) {
      scoringIdentityBound = true;
      try {
        const manifest = {
          schemaVersion: "origin.answer-experience-manifest.v2" as const,
          cases: bindings.map(item => ({ caseId: item.caseId, family: item.family })),
        };
        const scored = observations.map(({ answerDigest: _answerDigest, ...item }) => item);
        const quality = qualifyOriginAnswerExperienceV2(manifest, scored);
        aggregate = quality.aggregate;
        absoluteQualityPassed = quality.absoluteQualityPassed;
        blockers.push(...quality.blockers);
      } catch {
        blockers.push("AQ_V2_EXTERNAL_SCORE_OBSERVATIONS_INVALID");
      }
    }
  }

  const unique = [...new Set(blockers)];
  return Object.freeze({
    schemaVersion: "origin.trusted-answer-quality-qualification.v2",
    candidateSha,
    corpusDigest,
    executionPassed,
    scoringIdentityBound,
    absoluteQualityPassed,
    aggregate,
    passed: executionPassed && scoringIdentityBound && absoluteQualityPassed && unique.length === 0,
    blockers: Object.freeze(unique),
  });
}
