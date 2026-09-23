import type { OriginAnswerExperienceQualificationV2 } from "./OriginAnswerExperienceV2.js";
import type { OriginBlindPreferenceReportV2 } from "./OriginAnswerBlindPreferenceV2.js";

export interface OriginAnswerWorldClassGateInputV2 {
  readonly candidateSha: string;
  readonly answerExperience: OriginAnswerExperienceQualificationV2 | null;
  readonly blindPreference: OriginBlindPreferenceReportV2 | null;
  readonly liveProviderRunCompleted: boolean;
  readonly zeroCost: boolean;
}

export interface OriginAnswerWorldClassGateReportV2 {
  readonly schemaVersion: "origin.answer-world-class-gate.v2";
  readonly candidateSha: string;
  readonly answerExperiencePassed: boolean;
  readonly competitiveEvidencePassed: boolean;
  readonly liveEvidencePassed: boolean;
  readonly worldClassCandidate: boolean;
  readonly blockers: readonly string[];
}

export function evaluateOriginAnswerWorldClassGateV2(
  input: OriginAnswerWorldClassGateInputV2,
): OriginAnswerWorldClassGateReportV2 {
  if (!/^[a-f0-9]{40}$/.test(input.candidateSha)) throw new Error("AQ_V2_CANDIDATE_SHA_INVALID");
  const blockers: string[] = [];

  const answerExperiencePassed = input.answerExperience?.absoluteQualityPassed === true;
  if (!answerExperiencePassed) blockers.push("AQ_V2_ABSOLUTE_QUALITY_NOT_PROVEN");

  const competitiveEvidencePassed = input.blindPreference?.competitiveEvidencePassed === true;
  if (!competitiveEvidencePassed) blockers.push("AQ_V2_COMPETITIVE_EVIDENCE_NOT_PROVEN");

  const liveEvidencePassed = input.liveProviderRunCompleted === true && input.zeroCost === true;
  if (!input.liveProviderRunCompleted) blockers.push("AQ_V2_LIVE_PROVIDER_RUN_MISSING");
  if (!input.zeroCost) blockers.push("AQ_V2_ZERO_COST_NOT_PROVEN");

  return Object.freeze({
    schemaVersion: "origin.answer-world-class-gate.v2",
    candidateSha: input.candidateSha,
    answerExperiencePassed,
    competitiveEvidencePassed,
    liveEvidencePassed,
    worldClassCandidate: answerExperiencePassed && competitiveEvidencePassed && liveEvidencePassed,
    blockers: Object.freeze(blockers),
  });
}
