/**
 * Read-only pre-publication diagnostic for public paired AQ-40 evidence.
 *
 * IMPORTANT: caller-supplied identities, receipts, and scores are NOT trusted
 * authority. Never use this result to dispatch a provider, merge a PR, or
 * promote a Vercel alias. Trusted external identity/cost attestations,
 * independent review, and Owner acceptance are separate mandatory gates.
 */
import {
  qualifyOriginAnswerQualityBenchmark,
  type OriginAnswerQualityBenchmarkQualificationInput,
} from "../lib/orchestration/OriginAnswerQualityBenchmarkQualification.js";

const SHA40 = /^[a-f0-9]{40}$/;
const CASE_COUNT = 40;

export interface OriginAq40CurrentProductionGateInput
  extends OriginAnswerQualityBenchmarkQualificationInput {
  /** SHA independently read from the currently-serving Production alias. */
  readonly currentProductionSha: string;
  /** Exact candidate PR head obtained from GitHub. */
  readonly candidateHeadSha: string;
  readonly currentMainSha: string;
  readonly mergeBaseSha: string;
  readonly candidateBehindMain: number;
}

export type OriginAq40CurrentProductionGateVerdict =
  | {
      readonly status: "BLOCKED";
      readonly code:
        | "AQ40_IDENTITY_INVALID"
        | "AQ40_NOT_CURRENT_MAIN_BASED"
        | "AQ40_WRONG_PRODUCTION_BASELINE"
        | "AQ40_CANDIDATE_HEAD_CHANGED"
        | "AQ40_INVALID_EVIDENCE";
      readonly measuredPairedCases: number;
      readonly productionPromotionAllowed: false;
    }
  | {
      readonly status: "NOT_MEASURED";
      readonly code: "AQ40_PAIRED_CASES_INCOMPLETE" | "AQ40_NO_ACTUAL_PROVIDER_EXECUTION";
      readonly measuredPairedCases: number;
      readonly productionPromotionAllowed: false;
    }
  | {
      readonly status: "REVIEW_REQUIRED";
      readonly code: "AQ40_STRUCTURE_ONLY_EXTERNAL_ATTESTATION_REQUIRED";
      readonly measuredPairedCases: 40;
      readonly productionPromotionAllowed: false;
      readonly structuralNoUnsupportedClaimRegression: true;
    };

function blocked(code: Extract<OriginAq40CurrentProductionGateVerdict, {status:"BLOCKED"}>["code"]): OriginAq40CurrentProductionGateVerdict {
  return { status: "BLOCKED", code, measuredPairedCases: 0, productionPromotionAllowed: false };
}

function validIdentity(input: OriginAq40CurrentProductionGateInput): boolean {
  return [
    input.currentProductionSha,
    input.candidateHeadSha,
    input.currentMainSha,
    input.mergeBaseSha,
    input.baselineRun?.gitSha,
    input.candidateRun?.gitSha,
  ].every((value) => typeof value === "string" && SHA40.test(value));
}

export function auditOriginAq40CurrentProductionEvidence(
  input: OriginAq40CurrentProductionGateInput,
): OriginAq40CurrentProductionGateVerdict {
  if (!input || !validIdentity(input)
      || input.currentProductionSha === input.candidateHeadSha
      || input.candidateHeadSha === input.currentMainSha) {
    return blocked("AQ40_IDENTITY_INVALID");
  }
  if (input.candidateBehindMain !== 0 || input.mergeBaseSha !== input.currentMainSha) {
    return blocked("AQ40_NOT_CURRENT_MAIN_BASED");
  }
  if (input.baselineRun.gitSha !== input.currentProductionSha) {
    return blocked("AQ40_WRONG_PRODUCTION_BASELINE");
  }
  if (input.candidateRun.gitSha !== input.candidateHeadSha) {
    return blocked("AQ40_CANDIDATE_HEAD_CHANGED");
  }

  if (!Array.isArray(input.baselineObservations)
      || !Array.isArray(input.candidateObservations)) {
    return blocked("AQ40_INVALID_EVIDENCE");
  }
  const baselineSize = input.baselineObservations.length;
  const candidateSize = input.candidateObservations.length;
  if (baselineSize > CASE_COUNT || candidateSize > CASE_COUNT) {
    return blocked("AQ40_INVALID_EVIDENCE");
  }
  if (baselineSize < CASE_COUNT || candidateSize < CASE_COUNT) {
    return {
      status: "NOT_MEASURED",
      code: "AQ40_PAIRED_CASES_INCOMPLETE",
      measuredPairedCases: Math.min(baselineSize, candidateSize),
      productionPromotionAllowed: false,
    };
  }
  if (input.baselineRun?.schemaVersion !== "origin.aq-benchmark-run.v1"
      || input.candidateRun?.schemaVersion !== "origin.aq-benchmark-run.v1"
      || input.baselineRun?.manifestDigest !== input.baselineManifest?.manifestDigest
      || input.candidateRun?.manifestDigest !== input.candidateManifest?.manifestDigest) {
    return blocked("AQ40_INVALID_EVIDENCE");
  }

  const result = qualifyOriginAnswerQualityBenchmark(input);
  if (!result.ok) return blocked("AQ40_INVALID_EVIDENCE");
  if (!result.value.hardGates.unsupportedClaimsNotWorse
      || !result.value.hardGates.verifierRejectionRateNotWorse) {
    return blocked("AQ40_INVALID_EVIDENCE");
  }
  // Structural completeness without an actual provider call is never a
  // measurement, even if every synthetic score is otherwise well formed.
  if (result.value.baseline.totalProviderRequests === 0
      || result.value.candidate.totalProviderRequests === 0) {
    return {
      status: "NOT_MEASURED",
      code: "AQ40_NO_ACTUAL_PROVIDER_EXECUTION",
      measuredPairedCases: 0,
      productionPromotionAllowed: false,
    };
  }

  // Even a complete numeric scorecard cannot prove that any observation
  // came from real provider requests, or that provider receipts cost $0.
  return {
    status: "REVIEW_REQUIRED",
    code: "AQ40_STRUCTURE_ONLY_EXTERNAL_ATTESTATION_REQUIRED",
    measuredPairedCases: 40,
    structuralNoUnsupportedClaimRegression: true,
    productionPromotionAllowed: false,
  };
}
