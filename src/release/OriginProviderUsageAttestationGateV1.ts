import {
  verifyOriginEvidenceAttestationV1,
  type OriginEvidenceAttestationExpectedBindingV1,
  type OriginEvidenceNonceClaimerV1,
  type OriginEvidenceTrustedKeyV1,
  type OriginVerifiedEvidenceAttestationV1,
} from "./OriginEvidenceAttestationV1.js";

export interface OriginProviderUsageRequestV1 {
  readonly requestId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly occurredAt: string;
  readonly costUsd: number;
}

export interface OriginProviderUsageStatementV1 {
  readonly schemaVersion: "origin.provider-usage-ledger.v1";
  readonly runId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly billingWindowStart: string;
  readonly billingWindowEnd: string;
  readonly complete: true;
  readonly requests: readonly OriginProviderUsageRequestV1[];
}

export interface OriginProviderUsageExpectedV1 {
  readonly runId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly billingWindowStart: string;
  readonly billingWindowEnd: string;
  /** Request IDs independently recorded by the trusted host execution ledger. */
  readonly hostRequestIds: readonly string[];
}

export type OriginProviderUsageGateResultV1 =
  | {
      readonly ok: true;
      readonly verified: OriginVerifiedEvidenceAttestationV1;
      readonly requestCount: number;
      readonly totalCostUsd: 0;
    }
  | {
      readonly ok: false;
      readonly code:
        | "ORIGIN_PROVIDER_USAGE_ATTESTATION_INVALID"
        | "ORIGIN_PROVIDER_USAGE_STATEMENT_INVALID"
        | "ORIGIN_PROVIDER_USAGE_BINDING_MISMATCH"
        | "ORIGIN_PROVIDER_USAGE_LEDGER_INCOMPLETE"
        | "ORIGIN_PROVIDER_USAGE_NONZERO_COST";
    };

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validExpected(expected: OriginProviderUsageExpectedV1): boolean {
  return typeof expected.runId === "string"
    && expected.runId.trim().length > 0
    && typeof expected.providerId === "string"
    && expected.providerId.trim().length > 0
    && typeof expected.modelId === "string"
    && expected.modelId.trim().length > 0
    && validIso(expected.billingWindowStart)
    && validIso(expected.billingWindowEnd)
    && Date.parse(expected.billingWindowEnd) > Date.parse(expected.billingWindowStart)
    && Array.isArray(expected.hostRequestIds)
    && expected.hostRequestIds.every((id) => typeof id === "string" && REQUEST_ID.test(id))
    && new Set(expected.hostRequestIds).size === expected.hostRequestIds.length;
}

/**
 * A $0 qualification gate. The provider usage ledger must be signed by a
 * trusted provider-cost-verifier key and must reconcile exactly with the
 * independently maintained host request-ID ledger. Missing, extra, duplicate,
 * malformed, or non-zero-cost records fail closed.
 *
 * This function does not provision trust keys or a nonce database. Both must
 * be supplied by trusted infrastructure outside the candidate application.
 */
export async function verifyOriginProviderUsageAttestationV1(input: {
  readonly rawCanonicalPayload: string;
  readonly signatureBase64Url: string;
  readonly trustedKeys: readonly OriginEvidenceTrustedKeyV1[];
  readonly expectedBinding: OriginEvidenceAttestationExpectedBindingV1;
  readonly expected: OriginProviderUsageExpectedV1;
  readonly claimNonce: OriginEvidenceNonceClaimerV1 | null;
  readonly nowMs?: number;
}): Promise<OriginProviderUsageGateResultV1> {
  if (!validExpected(input.expected)) {
    return { ok: false, code: "ORIGIN_PROVIDER_USAGE_BINDING_MISMATCH" };
  }

  const verification = await verifyOriginEvidenceAttestationV1(
    input.rawCanonicalPayload,
    input.signatureBase64Url,
    input.trustedKeys,
    input.expectedBinding,
    input.claimNonce,
    input.nowMs === undefined ? {} : { nowMs: input.nowMs },
  );
  if (!verification.ok) {
    return { ok: false, code: "ORIGIN_PROVIDER_USAGE_ATTESTATION_INVALID" };
  }

  const verified = verification.value;
  if (verified.attestationType !== "provider-usage" || verified.signerRole !== "provider-cost-verifier") {
    return { ok: false, code: "ORIGIN_PROVIDER_USAGE_ATTESTATION_INVALID" };
  }

  const statement: unknown = verified.statement;
  if (!isRecord(statement)
    || statement.schemaVersion !== "origin.provider-usage-ledger.v1"
    || statement.complete !== true
    || typeof statement.runId !== "string"
    || typeof statement.providerId !== "string"
    || typeof statement.modelId !== "string"
    || !validIso(statement.billingWindowStart)
    || !validIso(statement.billingWindowEnd)
    || !Array.isArray(statement.requests)) {
    return { ok: false, code: "ORIGIN_PROVIDER_USAGE_STATEMENT_INVALID" };
  }

  const expected = input.expected;
  if (statement.runId !== expected.runId
    || statement.providerId !== expected.providerId
    || statement.modelId !== expected.modelId
    || statement.billingWindowStart !== expected.billingWindowStart
    || statement.billingWindowEnd !== expected.billingWindowEnd) {
    return { ok: false, code: "ORIGIN_PROVIDER_USAGE_BINDING_MISMATCH" };
  }

  const requests = statement.requests as unknown[];
  const seen = new Set<string>();
  let totalCostUsd = 0;
  for (const raw of requests) {
    if (!isRecord(raw)
      || typeof raw.requestId !== "string"
      || !REQUEST_ID.test(raw.requestId)
      || typeof raw.providerId !== "string"
      || typeof raw.modelId !== "string"
      || !validIso(raw.occurredAt)
      || typeof raw.costUsd !== "number"
      || !Number.isFinite(raw.costUsd)
      || raw.costUsd < 0) {
      return { ok: false, code: "ORIGIN_PROVIDER_USAGE_STATEMENT_INVALID" };
    }
    if (seen.has(raw.requestId)) {
      return { ok: false, code: "ORIGIN_PROVIDER_USAGE_LEDGER_INCOMPLETE" };
    }
    seen.add(raw.requestId);
    if (raw.providerId !== expected.providerId
      || raw.modelId !== expected.modelId
      || Date.parse(raw.occurredAt) < Date.parse(expected.billingWindowStart)
      || Date.parse(raw.occurredAt) > Date.parse(expected.billingWindowEnd)) {
      return { ok: false, code: "ORIGIN_PROVIDER_USAGE_BINDING_MISMATCH" };
    }
    totalCostUsd += raw.costUsd;
    if (raw.costUsd !== 0) {
      return { ok: false, code: "ORIGIN_PROVIDER_USAGE_NONZERO_COST" };
    }
  }

  if (seen.size !== expected.hostRequestIds.length
    || expected.hostRequestIds.some((id) => !seen.has(id))) {
    return { ok: false, code: "ORIGIN_PROVIDER_USAGE_LEDGER_INCOMPLETE" };
  }
  if (totalCostUsd !== 0) {
    return { ok: false, code: "ORIGIN_PROVIDER_USAGE_NONZERO_COST" };
  }

  return {
    ok: true,
    verified,
    requestCount: requests.length,
    totalCostUsd: 0,
  };
}
