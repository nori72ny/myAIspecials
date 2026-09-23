import { createHash } from "node:crypto";

import type {
  OriginAnswerExperiencePreparedCorpusV2,
} from "./OriginAnswerExperienceSealedCorpusV2.js";

export interface OriginAnswerCaseLeasePublicV2 {
  readonly schemaVersion: "origin.answer-case-lease-public.v2";
  readonly leaseId: string;
  readonly candidateSha: string;
  readonly roundId: string;
  readonly caseId: string;
  readonly family: string;
  readonly prompt: string;
  readonly promptDigest: string;
  readonly ordinal: number;
  readonly totalCases: number;
}

export interface OriginAnswerCaseLeaseTrustedV2 {
  readonly schemaVersion: "origin.answer-case-lease-trusted.v2";
  readonly leaseId: string;
  readonly corpusDigest: string;
  readonly evaluatorNotes: string;
  readonly promptDigest: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validSha(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value);
}

function validRoundId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(value);
}

export function leaseOriginAnswerExperienceCaseV2(
  prepared: OriginAnswerExperiencePreparedCorpusV2,
  input: {
    readonly candidateSha: string;
    readonly roundId: string;
    readonly ordinal: number;
  },
): {
  readonly publicLease: OriginAnswerCaseLeasePublicV2;
  readonly trustedLease: OriginAnswerCaseLeaseTrustedV2;
} {
  if (!validSha(input.candidateSha) || !validRoundId(input.roundId)) {
    throw new Error("AQ_V2_CASE_LEASE_BINDING_INVALID");
  }
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0 || input.ordinal >= prepared.privateCorpus.cases.length) {
    throw new Error("AQ_V2_CASE_LEASE_ORDINAL_INVALID");
  }

  const item = prepared.privateCorpus.cases[input.ordinal];
  const promptDigest = sha256(item.prompt);
  const leaseId = sha256([
    prepared.corpusDigest,
    input.candidateSha,
    input.roundId,
    String(input.ordinal),
    item.caseId,
    promptDigest,
  ].join("\n")).slice(0, 32);

  return Object.freeze({
    publicLease: Object.freeze({
      schemaVersion: "origin.answer-case-lease-public.v2",
      leaseId,
      candidateSha: input.candidateSha,
      roundId: input.roundId,
      caseId: item.caseId,
      family: item.family,
      prompt: item.prompt,
      promptDigest,
      ordinal: input.ordinal,
      totalCases: prepared.privateCorpus.cases.length,
    }),
    trustedLease: Object.freeze({
      schemaVersion: "origin.answer-case-lease-trusted.v2",
      leaseId,
      corpusDigest: prepared.corpusDigest,
      evaluatorNotes: item.evaluatorNotes,
      promptDigest,
    }),
  });
}

export function assertOriginAnswerCaseLeaseIsolationV2(input: {
  readonly publicLease: OriginAnswerCaseLeasePublicV2;
  readonly trustedLease: OriginAnswerCaseLeaseTrustedV2;
  readonly fullCorpusSerialized: string;
}): void {
  const publicSerialized = JSON.stringify(input.publicLease);
  if (publicSerialized.includes(input.trustedLease.evaluatorNotes)) {
    throw new Error("AQ_V2_CASE_LEASE_EVALUATOR_NOTES_LEAK");
  }
  if (publicSerialized.includes(input.trustedLease.corpusDigest)) {
    throw new Error("AQ_V2_CASE_LEASE_CORPUS_DIGEST_LEAK");
  }
  if (input.fullCorpusSerialized === publicSerialized) {
    throw new Error("AQ_V2_CASE_LEASE_FULL_CORPUS_EXPOSED");
  }
}

export interface OriginAnswerCaseResultTrustedV2 {
  readonly schemaVersion: "origin.answer-case-result-trusted.v2";
  readonly leaseId: string;
  readonly candidateSha: string;
  readonly caseId: string;
  readonly promptDigest: string;
  readonly answer: string;
  readonly answerDigest: string;
  readonly answerLength: number;
  readonly providerRequests: number;
  readonly costUsd: 0;
}

export function buildOriginAnswerCaseResultTrustedV2(input: {
  readonly publicLease: OriginAnswerCaseLeasePublicV2;
  readonly answer: string;
  readonly providerRequests: number;
  readonly costUsd: number;
}): OriginAnswerCaseResultTrustedV2 {
  if (
    typeof input.answer !== "string"
    || input.answer.trim().length === 0
    || input.answer.length > 200_000
    || !Number.isInteger(input.providerRequests)
    || input.providerRequests < 1
    || input.providerRequests > 4
    || input.costUsd !== 0
  ) {
    throw new Error("AQ_V2_CASE_RESULT_INVALID");
  }

  return Object.freeze({
    schemaVersion: "origin.answer-case-result-trusted.v2",
    leaseId: input.publicLease.leaseId,
    candidateSha: input.publicLease.candidateSha,
    caseId: input.publicLease.caseId,
    promptDigest: input.publicLease.promptDigest,
    answer: input.answer,
    answerDigest: sha256(input.answer),
    answerLength: input.answer.length,
    providerRequests: input.providerRequests,
    costUsd: 0,
  });
}
