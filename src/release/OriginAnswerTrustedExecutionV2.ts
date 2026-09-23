export interface OriginAnswerTrustedExecutionEvidenceV2 {
  readonly schemaVersion: "origin.answer-trusted-execution.v2";
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly executionId: string;
  readonly exactCandidateBound: boolean;
  readonly sameRepoOpenPrHead: boolean;
  readonly trustedHostControlled: boolean;
  readonly sealedCorpusNotExposedBeforeRequest: boolean;
  readonly providerCredentialWithheldFromCandidate: boolean;
  readonly providerProxyEnforced: boolean;
  readonly freeOnlyEnforced: boolean;
  readonly zeroCostVerified: boolean;
  readonly candidateExternalNetworkBlocked: boolean;
  readonly candidateArtifactsSanitized: boolean;
  readonly candidateLogsSanitized: boolean;
  readonly promptLeakDetected: boolean;
  readonly secretLeakDetected: boolean;
  readonly providerRequestCount: number;
  readonly maxProviderRequests: number;
  readonly resultDigest: string;
}

export interface OriginAnswerTrustedExecutionQualificationV2 {
  readonly schemaVersion: "origin.answer-trusted-execution-qualification.v2";
  readonly passed: boolean;
  readonly blockers: readonly string[];
}

function validSha(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value);
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9._:/-]{8,180}$/.test(value);
}

export function qualifyOriginAnswerTrustedExecutionV2(
  input: OriginAnswerTrustedExecutionEvidenceV2 | null,
  candidateSha: string,
  corpusDigest: string,
): OriginAnswerTrustedExecutionQualificationV2 {
  const blockers: string[] = [];
  if (!input) {
    return Object.freeze({
      schemaVersion: "origin.answer-trusted-execution-qualification.v2",
      passed: false,
      blockers: Object.freeze(["AQ_V2_TRUSTED_EXECUTION_EVIDENCE_MISSING"]),
    });
  }

  if (!validSha(candidateSha) || input.candidateSha !== candidateSha) {
    blockers.push("AQ_V2_TRUSTED_EXECUTION_SHA_MISMATCH");
  }
  if (!validDigest(corpusDigest) || input.corpusDigest !== corpusDigest) {
    blockers.push("AQ_V2_TRUSTED_EXECUTION_CORPUS_MISMATCH");
  }
  if (!validId(input.executionId) || !validDigest(input.resultDigest)) {
    blockers.push("AQ_V2_TRUSTED_EXECUTION_PROVENANCE_INVALID");
  }

  const required: readonly [keyof OriginAnswerTrustedExecutionEvidenceV2, string][] = [
    ["exactCandidateBound", "AQ_V2_TRUSTED_EXECUTION_CANDIDATE_NOT_BOUND"],
    ["sameRepoOpenPrHead", "AQ_V2_TRUSTED_EXECUTION_PR_BINDING_INVALID"],
    ["trustedHostControlled", "AQ_V2_TRUSTED_EXECUTION_HOST_NOT_TRUSTED"],
    ["sealedCorpusNotExposedBeforeRequest", "AQ_V2_TRUSTED_EXECUTION_CORPUS_EXPOSURE"],
    ["providerCredentialWithheldFromCandidate", "AQ_V2_TRUSTED_EXECUTION_SECRET_EXPOSURE"],
    ["providerProxyEnforced", "AQ_V2_TRUSTED_EXECUTION_PROVIDER_PROXY_MISSING"],
    ["freeOnlyEnforced", "AQ_V2_TRUSTED_EXECUTION_FREE_ONLY_NOT_ENFORCED"],
    ["zeroCostVerified", "AQ_V2_TRUSTED_EXECUTION_ZERO_COST_NOT_VERIFIED"],
    ["candidateExternalNetworkBlocked", "AQ_V2_TRUSTED_EXECUTION_NETWORK_NOT_BLOCKED"],
    ["candidateArtifactsSanitized", "AQ_V2_TRUSTED_EXECUTION_ARTIFACTS_NOT_SANITIZED"],
    ["candidateLogsSanitized", "AQ_V2_TRUSTED_EXECUTION_LOGS_NOT_SANITIZED"],
  ];

  for (const [key, blocker] of required) {
    if (input[key] !== true) blockers.push(blocker);
  }

  if (input.promptLeakDetected) blockers.push("AQ_V2_TRUSTED_EXECUTION_PROMPT_LEAK");
  if (input.secretLeakDetected) blockers.push("AQ_V2_TRUSTED_EXECUTION_SECRET_LEAK");
  if (
    !Number.isInteger(input.providerRequestCount)
    || !Number.isInteger(input.maxProviderRequests)
    || input.providerRequestCount < 0
    || input.maxProviderRequests <= 0
    || input.providerRequestCount > input.maxProviderRequests
  ) {
    blockers.push("AQ_V2_TRUSTED_EXECUTION_REQUEST_BUDGET_INVALID");
  }

  return Object.freeze({
    schemaVersion: "origin.answer-trusted-execution-qualification.v2",
    passed: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}
