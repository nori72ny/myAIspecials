import { createHash } from "node:crypto";

import { ORIGIN_AQ_V2_FAMILIES } from "./OriginAnswerExperienceV2.js";
import { digestOriginAnswerExperienceRubricV2 } from "./OriginAnswerExperienceRubricV2.js";
import type { OriginAnswerCaseResultTrustedV2 } from "./OriginAnswerTrustedCaseLeaseV2.js";
import type { OriginAnswerEvaluationBindingV2 } from "./OriginAnswerEvaluationBindingV2.js";
import {
  qualifyOriginAnswerTrustedExecutionV2,
  type OriginAnswerTrustedExecutionEvidenceV2,
  type OriginAnswerTrustedExecutionQualificationV2,
} from "./OriginAnswerTrustedExecutionV2.js";

export interface OriginTrustedAnswerCaseEvidenceV2 {
  readonly schemaVersion: "origin.trusted-answer-case-evidence.v2";
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly roundId: string;
  readonly ordinal: number;
  readonly caseId: string;
  readonly family: string;
  readonly promptDigest: string;
  readonly leaseId: string;
  readonly providerRequests: number;
  readonly costUsd: 0;
  readonly networkBlocked: true;
  readonly fullCorpusWithheldFromCandidate: true;
  readonly providerCredentialWithheldFromCandidate: true;
  readonly gitMetadataWithheldFromCandidate: true;
  readonly trustedProxyEnforced: true;
  readonly leakDetected: false;
  readonly result: OriginAnswerCaseResultTrustedV2;
}

export interface OriginTrustedAnswerRunAggregateV2 {
  readonly schemaVersion: "origin.trusted-answer-run-aggregate.v2";
  readonly evidence: OriginAnswerTrustedExecutionEvidenceV2;
  readonly qualification: OriginAnswerTrustedExecutionQualificationV2;
  readonly binding: OriginAnswerEvaluationBindingV2;
  readonly completedCases: number;
  readonly familyCounts: Readonly<Record<string, number>>;
}

function validSha(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value);
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validRoundId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(value);
}

function validExecutionId(value: string): boolean {
  return /^[A-Za-z0-9._:/-]{8,180}$/.test(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function aggregateOriginTrustedAnswerRunV2(
  cases: readonly OriginTrustedAnswerCaseEvidenceV2[],
  expected: {
    readonly candidateSha: string;
    readonly corpusDigest: string;
    readonly roundId: string;
    readonly executionId: string;
    readonly evaluatorSha: string;
    readonly sameRepoOpenPrHead: boolean;
    readonly trustedHostControlled: boolean;
  },
): OriginTrustedAnswerRunAggregateV2 {
  if (
    !validSha(expected.candidateSha)
    || !validDigest(expected.corpusDigest)
    || !validRoundId(expected.roundId)
    || !validExecutionId(expected.executionId)
    || !validSha(expected.evaluatorSha)
  ) {
    throw new Error("AQ_V2_TRUSTED_RUN_EXPECTATION_INVALID");
  }
  if (cases.length !== ORIGIN_AQ_V2_FAMILIES.length * 3) {
    throw new Error("AQ_V2_TRUSTED_RUN_CASE_COUNT_INVALID");
  }

  const caseIds = new Set<string>();
  const ordinals = new Set<number>();
  const familyCounts: Record<string, number> = Object.fromEntries(
    ORIGIN_AQ_V2_FAMILIES.map(family => [family, 0]),
  );
  let providerRequestCount = 0;

  for (const row of cases) {
    if (
      row?.schemaVersion !== "origin.trusted-answer-case-evidence.v2"
      || row.candidateSha !== expected.candidateSha
      || row.corpusDigest !== expected.corpusDigest
      || row.roundId !== expected.roundId
      || !Number.isInteger(row.ordinal)
      || row.ordinal < 0
      || row.ordinal >= cases.length
      || ordinals.has(row.ordinal)
      || !/^[a-z0-9][a-z0-9._-]{2,119}$/.test(row.caseId)
      || caseIds.has(row.caseId)
      || !ORIGIN_AQ_V2_FAMILIES.includes(row.family as (typeof ORIGIN_AQ_V2_FAMILIES)[number])
      || !validDigest(row.promptDigest)
      || !/^[a-f0-9]{32}$/.test(row.leaseId)
      || !Number.isInteger(row.providerRequests)
      || row.providerRequests < 0
      || row.providerRequests > 1
      || row.costUsd !== 0
      || row.networkBlocked !== true
      || row.fullCorpusWithheldFromCandidate !== true
      || row.providerCredentialWithheldFromCandidate !== true
      || row.gitMetadataWithheldFromCandidate !== true
      || row.trustedProxyEnforced !== true
      || row.leakDetected !== false
    ) {
      throw new Error("AQ_V2_TRUSTED_RUN_CASE_INVALID");
    }

    const result = row.result;
    if (
      result?.schemaVersion !== "origin.answer-case-result-trusted.v2"
      || result.leaseId !== row.leaseId
      || result.candidateSha !== expected.candidateSha
      || result.roundId !== expected.roundId
      || result.caseId !== row.caseId
      || result.family !== row.family
      || result.promptDigest !== row.promptDigest
      || result.providerRequests !== row.providerRequests
      || result.costUsd !== 0
      || !validDigest(result.answerDigest)
      || typeof result.answer !== "string"
      || result.answer.trim().length === 0
      || result.answer.length !== result.answerLength
    ) {
      throw new Error("AQ_V2_TRUSTED_RUN_RESULT_INVALID");
    }

    ordinals.add(row.ordinal);
    caseIds.add(row.caseId);
    familyCounts[row.family] += 1;
    providerRequestCount += row.providerRequests;
  }

  for (let ordinal = 0; ordinal < cases.length; ordinal += 1) {
    if (!ordinals.has(ordinal)) throw new Error("AQ_V2_TRUSTED_RUN_ORDINAL_SET_INVALID");
  }
  if (ORIGIN_AQ_V2_FAMILIES.some(family => familyCounts[family] !== 3)) {
    throw new Error("AQ_V2_TRUSTED_RUN_FAMILY_SHAPE_INVALID");
  }

  const digestRows = [...cases]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(row => [
      row.ordinal,
      row.caseId,
      row.family,
      row.promptDigest,
      row.result.answerDigest,
      row.providerRequests,
      row.costUsd,
    ]);

  const evidence: OriginAnswerTrustedExecutionEvidenceV2 = Object.freeze({
    schemaVersion: "origin.answer-trusted-execution.v2",
    candidateSha: expected.candidateSha,
    corpusDigest: expected.corpusDigest,
    executionId: expected.executionId,
    exactCandidateBound: true,
    sameRepoOpenPrHead: expected.sameRepoOpenPrHead,
    trustedHostControlled: expected.trustedHostControlled,
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
    providerRequestCount,
    maxProviderRequests: cases.length,
    resultDigest: sha256(JSON.stringify(digestRows)),
  });

  const qualification = qualifyOriginAnswerTrustedExecutionV2(
    evidence,
    expected.candidateSha,
    expected.corpusDigest,
  );

  const binding: OriginAnswerEvaluationBindingV2 = Object.freeze({
    schemaVersion: "origin.answer-evaluation-binding.v2",
    candidateSha: expected.candidateSha,
    corpusDigest: expected.corpusDigest,
    evaluatorSha: expected.evaluatorSha,
    rubricDigest: digestOriginAnswerExperienceRubricV2(),
    roundId: expected.roundId,
  });

  return Object.freeze({
    schemaVersion: "origin.trusted-answer-run-aggregate.v2",
    evidence,
    qualification,
    binding,
    completedCases: cases.length,
    familyCounts: Object.freeze({ ...familyCounts }),
  });
}
