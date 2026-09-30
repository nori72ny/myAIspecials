import { createHash } from "node:crypto";

import {
  evaluateOriginBlindPreferenceV2,
  type OriginBlindPreferenceReportV2,
  type OriginBlindPreferenceVoteV2,
} from "./OriginAnswerBlindPreferenceV2.js";
import { digestOriginAnswerExperienceRubricV2 } from "./OriginAnswerExperienceRubricV2.js";
import type { OriginTrustedAnswerRunAggregateV2 } from "./OriginTrustedAnswerRunV2.js";

export interface OriginTrustedBlindReferenceAnswerV2 {
  readonly caseId: string;
  readonly answerDigest: string;
}

export interface OriginTrustedBlindReferenceV2 {
  readonly source: "controlled-external";
  readonly opponentId: string;
  readonly independentFromCandidate: true;
  readonly evidenceId: string;
  readonly artifactDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly answers: readonly OriginTrustedBlindReferenceAnswerV2[];
}

export interface OriginTrustedBlindJudgeV2 {
  readonly source: "controlled-external";
  readonly judgeId: string;
  readonly independentFromCandidate: true;
  readonly blindToSourceIdentity: true;
  readonly evidenceId: string;
  readonly artifactDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface OriginTrustedBlindVoteV2 extends OriginBlindPreferenceVoteV2 {
  readonly candidateAnswerDigest: string;
  readonly referenceAnswerDigest: string;
  readonly pairDigest: string;
}

export interface OriginTrustedBlindPreferenceBundleV2 {
  readonly schemaVersion: "origin.trusted-answer-blind-preference-bundle.v2";
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly roundId: string;
  readonly resultDigest: string;
  readonly rubricDigest: string;
  readonly references: readonly OriginTrustedBlindReferenceV2[];
  readonly judges: readonly OriginTrustedBlindJudgeV2[];
  readonly votes: readonly OriginTrustedBlindVoteV2[];
}

export interface OriginTrustedBlindPreferenceQualificationV2 {
  readonly schemaVersion: "origin.trusted-answer-blind-preference-qualification.v2";
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly executionPassed: boolean;
  readonly identityBound: boolean;
  readonly referenceEvidenceBound: boolean;
  readonly judgeEvidenceBound: boolean;
  readonly answerBindingsBound: boolean;
  readonly competitiveEvidencePassed: boolean;
  readonly blindReport: OriginBlindPreferenceReportV2 | null;
  readonly passed: boolean;
  readonly blockers: readonly string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
const EVIDENCE_ID = /^[A-Za-z0-9._:/-]{8,180}$/;
const MAX_EVIDENCE_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function digestOriginTrustedBlindPairV2(input: {
  readonly caseId: string;
  readonly opponentId: string;
  readonly candidateAnswerDigest: string;
  readonly referenceAnswerDigest: string;
}): string {
  return sha256([
    "origin.aq-v2.trusted-blind-pair.v2",
    input.caseId,
    input.opponentId,
    input.candidateAnswerDigest,
    input.referenceAnswerDigest,
  ].join("\n"));
}

function validEvidenceWindow(
  createdAtValue: string,
  expiresAtValue: string,
  nowMs: number,
): boolean {
  const createdAt = Date.parse(createdAtValue);
  const expiresAt = Date.parse(expiresAtValue);
  return Number.isFinite(createdAt)
    && Number.isFinite(expiresAt)
    && createdAt <= nowMs + MAX_CLOCK_SKEW_MS
    && expiresAt > nowMs
    && expiresAt >= createdAt
    && expiresAt - createdAt <= MAX_EVIDENCE_LIFETIME_MS;
}

function validArtifactDigest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function validReference(reference: OriginTrustedBlindReferenceV2, nowMs: number): boolean {
  return reference?.source === "controlled-external"
    && reference.independentFromCandidate === true
    && EXTERNAL_ID.test(reference.opponentId)
    && EVIDENCE_ID.test(reference.evidenceId)
    && validArtifactDigest(reference.artifactDigest)
    && validEvidenceWindow(reference.createdAt, reference.expiresAt, nowMs)
    && Array.isArray(reference.answers);
}

function validJudge(judge: OriginTrustedBlindJudgeV2, nowMs: number): boolean {
  return judge?.source === "controlled-external"
    && judge.independentFromCandidate === true
    && judge.blindToSourceIdentity === true
    && EXTERNAL_ID.test(judge.judgeId)
    && EVIDENCE_ID.test(judge.evidenceId)
    && validArtifactDigest(judge.artifactDigest)
    && validEvidenceWindow(judge.createdAt, judge.expiresAt, nowMs);
}

export function qualifyOriginTrustedBlindPreferenceV2(
  run: OriginTrustedAnswerRunAggregateV2 | null,
  bundle: OriginTrustedBlindPreferenceBundleV2 | null,
  nowMs: number = Date.now(),
): OriginTrustedBlindPreferenceQualificationV2 {
  const blockers: string[] = [];
  const candidateSha = run?.evidence.candidateSha ?? bundle?.candidateSha ?? "unknown";
  const corpusDigest = run?.evidence.corpusDigest ?? bundle?.corpusDigest ?? "unknown";
  const executionPassed = run?.qualification.passed === true;
  if (!executionPassed) blockers.push("AQ_V2_TRUSTED_BLIND_EXECUTION_NOT_QUALIFIED");

  let identityBound = false;
  let referenceEvidenceBound = false;
  let judgeEvidenceBound = false;
  let answerBindingsBound = false;
  let blindReport: OriginBlindPreferenceReportV2 | null = null;

  if (!run || !bundle || bundle.schemaVersion !== "origin.trusted-answer-blind-preference-bundle.v2") {
    blockers.push("AQ_V2_TRUSTED_BLIND_BUNDLE_MISSING");
  } else {
    const identityMatches = bundle.candidateSha === run.evidence.candidateSha
      && bundle.corpusDigest === run.evidence.corpusDigest
      && bundle.roundId === run.binding.roundId
      && bundle.resultDigest === run.evidence.resultDigest
      && bundle.rubricDigest === run.binding.rubricDigest
      && bundle.rubricDigest === digestOriginAnswerExperienceRubricV2();

    if (!identityMatches) blockers.push("AQ_V2_TRUSTED_BLIND_IDENTITY_MISMATCH");
    else identityBound = true;

    const references = Array.isArray(bundle.references) ? bundle.references : [];
    const referenceIds = references.map(reference => reference?.opponentId);
    if (references.length < 3) blockers.push("AQ_V2_TRUSTED_BLIND_REFERENCES_LT_3");
    if (new Set(referenceIds).size !== referenceIds.length) {
      blockers.push("AQ_V2_TRUSTED_BLIND_REFERENCE_IDS_DUPLICATE");
    }
    if (references.some(reference => !validReference(reference, nowMs))) {
      blockers.push("AQ_V2_TRUSTED_BLIND_REFERENCE_EVIDENCE_INVALID");
    }

    const judges = Array.isArray(bundle.judges) ? bundle.judges : [];
    const judgeIds = judges.map(judge => judge?.judgeId);
    if (judges.length < 2) blockers.push("AQ_V2_TRUSTED_BLIND_JUDGES_LT_2");
    if (new Set(judgeIds).size !== judgeIds.length) {
      blockers.push("AQ_V2_TRUSTED_BLIND_JUDGE_IDS_DUPLICATE");
    }
    if (judges.some(judge => !validJudge(judge, nowMs))) {
      blockers.push("AQ_V2_TRUSTED_BLIND_JUDGE_EVIDENCE_INVALID");
    }

    const candidateBindings = Array.isArray(run.scoringBindings) ? run.scoringBindings : [];
    const candidateByCase = new Map(candidateBindings.map(binding => [binding.caseId, binding]));
    const expectedCaseCount = candidateBindings.length;
    const referenceAnswers = new Map<string, Map<string, string>>();

    let referencesValid = references.length >= 3
      && new Set(referenceIds).size === referenceIds.length
      && references.every(reference => validReference(reference, nowMs));

    for (const reference of references) {
      const answers = Array.isArray(reference.answers) ? reference.answers : [];
      const byCase = new Map<string, string>();
      if (answers.length !== expectedCaseCount) referencesValid = false;
      for (const answer of answers) {
        if (
          !answer
          || !candidateByCase.has(answer.caseId)
          || !SHA256.test(answer.answerDigest)
          || byCase.has(answer.caseId)
        ) {
          referencesValid = false;
          continue;
        }
        byCase.set(answer.caseId, answer.answerDigest);
      }
      if (byCase.size !== expectedCaseCount) referencesValid = false;
      referenceAnswers.set(reference.opponentId, byCase);
    }

    referenceEvidenceBound = referencesValid;
    if (!referenceEvidenceBound) blockers.push("AQ_V2_TRUSTED_BLIND_REFERENCE_ANSWERS_INVALID");

    judgeEvidenceBound = judges.length >= 2
      && new Set(judgeIds).size === judgeIds.length
      && judges.every(judge => validJudge(judge, nowMs));

    const allowedJudges = new Set(judgeIds);
    const allowedReferences = new Set(referenceIds);
    const votes = Array.isArray(bundle.votes) ? bundle.votes : [];
    let votesBound = votes.length > 0;

    for (const vote of votes) {
      const candidate = candidateByCase.get(vote.caseId);
      const referenceDigest = referenceAnswers.get(vote.opponentId)?.get(vote.caseId);
      if (
        !candidate
        || vote.family !== candidate.family
        || !allowedReferences.has(vote.opponentId)
        || !allowedJudges.has(vote.judgeId)
        || !SHA256.test(vote.candidateAnswerDigest)
        || !SHA256.test(vote.referenceAnswerDigest)
        || vote.candidateAnswerDigest !== candidate.answerDigest
        || vote.referenceAnswerDigest !== referenceDigest
        || vote.pairDigest !== digestOriginTrustedBlindPairV2({
          caseId: vote.caseId,
          opponentId: vote.opponentId,
          candidateAnswerDigest: vote.candidateAnswerDigest,
          referenceAnswerDigest: vote.referenceAnswerDigest,
        })
      ) {
        votesBound = false;
        break;
      }
    }

    answerBindingsBound = candidateBindings.length === 48
      && referenceEvidenceBound
      && judgeEvidenceBound
      && votesBound;

    if (!answerBindingsBound) blockers.push("AQ_V2_TRUSTED_BLIND_ANSWER_BINDING_MISMATCH");

    if (identityBound && referenceEvidenceBound && judgeEvidenceBound && answerBindingsBound) {
      try {
        const publicVotes: OriginBlindPreferenceVoteV2[] = votes.map(({
          candidateAnswerDigest: _candidateAnswerDigest,
          referenceAnswerDigest: _referenceAnswerDigest,
          pairDigest: _pairDigest,
          ...vote
        }) => vote);
        blindReport = evaluateOriginBlindPreferenceV2(publicVotes);
        blockers.push(...blindReport.blockers);
      } catch {
        blockers.push("AQ_V2_TRUSTED_BLIND_VOTES_INVALID");
      }
    }
  }

  const competitiveEvidencePassed = blindReport?.competitiveEvidencePassed === true;
  if (!competitiveEvidencePassed && !blockers.includes("AQ_V2_TRUSTED_BLIND_VOTES_INVALID")) {
    blockers.push("AQ_V2_TRUSTED_BLIND_COMPETITIVE_GATE_FAILED");
  }

  const unique = [...new Set(blockers)];
  return Object.freeze({
    schemaVersion: "origin.trusted-answer-blind-preference-qualification.v2",
    candidateSha,
    corpusDigest,
    executionPassed,
    identityBound,
    referenceEvidenceBound,
    judgeEvidenceBound,
    answerBindingsBound,
    competitiveEvidencePassed,
    blindReport,
    passed: executionPassed
      && identityBound
      && referenceEvidenceBound
      && judgeEvidenceBound
      && answerBindingsBound
      && competitiveEvidencePassed
      && unique.length === 0,
    blockers: Object.freeze(unique),
  });
}
