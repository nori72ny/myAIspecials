/**
 * Shared, fail-closed cost evidence vocabulary.
 *
 * POLICY_ALLOWED is a pre-execution policy statement, NOT a spend measurement.
 * NOT_MEASURED and BLOCKED_UNVERIFIED carry no numeric cost.
 * ZERO_COST_VERIFIED is intentionally opaque: this module exports no constructor.
 * A future trusted verifier must mint the runtime brand only after authenticating
 * provider-origin billing evidence and reconciling the complete host request ledger.
 *
 * The TypeScript brand is defense-in-depth, not a security boundary. Runtime trust
 * must come from the signed receipt verifier and its externally managed trust roots.
 */

const verifiedReceiptBrand: unique symbol = Symbol("origin.zero-cost-verified.v1");

export type OriginCostEvidenceReasonV1 =
  | "NO_PROVIDER_EXECUTION"
  | "BILLING_NOT_AVAILABLE"
  | "INCOMPLETE_REQUEST_LEDGER"
  | "UNTRUSTED_PROVIDER_EVIDENCE"
  | "RECONCILIATION_FAILED"
  | "RECEIPT_EXPIRED"
  | "REPLAY_DETECTED"
  | "CONTRADICTORY_EVIDENCE";

export interface OriginCostPolicyAllowedV1 {
  readonly schemaVersion: "origin.cost-evidence.v1";
  readonly status: "POLICY_ALLOWED";
  readonly policyRef: string;
  readonly measurement: null;
}

export interface OriginCostNotMeasuredV1 {
  readonly schemaVersion: "origin.cost-evidence.v1";
  readonly status: "NOT_MEASURED";
  readonly reason: "NO_PROVIDER_EXECUTION" | "BILLING_NOT_AVAILABLE";
  readonly measurement: null;
}

export interface OriginCostBlockedUnverifiedV1 {
  readonly schemaVersion: "origin.cost-evidence.v1";
  readonly status: "BLOCKED_UNVERIFIED";
  readonly reason: Exclude<OriginCostEvidenceReasonV1, "NO_PROVIDER_EXECUTION" | "BILLING_NOT_AVAILABLE">;
  readonly measurement: null;
}

export interface OriginCostZeroVerifiedV1 {
  readonly schemaVersion: "origin.cost-evidence.v1";
  readonly status: "ZERO_COST_VERIFIED";
  readonly amountUsd: "0.00";
  readonly receiptRef: string;
  readonly receiptDigest: `sha256:${string}`;
  readonly measuredAt: string;
  readonly measurement: Readonly<{
    readonly totalCostUsd: "0.00";
    readonly reconciledRequestCount: number;
  }>;
  /** Runtime-only brand. The symbol is deliberately not exported. */
  readonly [verifiedReceiptBrand]: true;
}

export type OriginCostEvidenceV1 =
  | OriginCostPolicyAllowedV1
  | OriginCostNotMeasuredV1
  | OriginCostBlockedUnverifiedV1
  | OriginCostZeroVerifiedV1;

function requiredRef(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) {
    throw new Error(`ORIGIN_COST_EVIDENCE_INVALID_${field.toUpperCase()}`);
  }
  return normalized;
}

export function createOriginCostPolicyAllowedV1(policyRef: string): OriginCostPolicyAllowedV1 {
  return Object.freeze({
    schemaVersion: "origin.cost-evidence.v1",
    status: "POLICY_ALLOWED",
    policyRef: requiredRef(policyRef, "policy_ref"),
    measurement: null,
  });
}

export function createOriginCostNotMeasuredV1(
  reason: OriginCostNotMeasuredV1["reason"],
): OriginCostNotMeasuredV1 {
  return Object.freeze({
    schemaVersion: "origin.cost-evidence.v1",
    status: "NOT_MEASURED",
    reason,
    measurement: null,
  });
}

export function createOriginCostBlockedUnverifiedV1(
  reason: OriginCostBlockedUnverifiedV1["reason"],
): OriginCostBlockedUnverifiedV1 {
  return Object.freeze({
    schemaVersion: "origin.cost-evidence.v1",
    status: "BLOCKED_UNVERIFIED",
    reason,
    measurement: null,
  });
}

/**
 * Only an object minted inside the trusted verifier module can pass this check.
 * Parsed JSON, caller-provided cost fields, policy metadata, and evaluator events
 * cannot recreate the non-exported runtime brand.
 */
export function isOriginCostZeroVerifiedV1(
  value: unknown,
): value is OriginCostZeroVerifiedV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<OriginCostZeroVerifiedV1>;
  return Object.prototype.hasOwnProperty.call(value, verifiedReceiptBrand)
    && candidate.schemaVersion === "origin.cost-evidence.v1"
    && candidate.status === "ZERO_COST_VERIFIED"
    && candidate.amountUsd === "0.00"
    && typeof candidate.receiptRef === "string"
    && candidate.receiptRef.trim().length > 0
    && candidate.receiptRef.length <= 512
    && typeof candidate.receiptDigest === "string"
    && /^sha256:[a-f0-9]{64}$/.test(candidate.receiptDigest)
    && typeof candidate.measuredAt === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(candidate.measuredAt)
    && Number.isFinite(Date.parse(candidate.measuredAt))
    && candidate.measurement?.totalCostUsd === "0.00"
    && Number.isSafeInteger(candidate.measurement.reconciledRequestCount)
    && candidate.measurement.reconciledRequestCount >= 1;
}

/**
 * Never coerce unknown data into a verified state. Unknown/malformed states are
 * classified as BLOCKED_UNVERIFIED and never receive a synthetic numeric zero.
 */
export function classifyOriginCostEvidenceV1(
  value: unknown,
): OriginCostEvidenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createOriginCostBlockedUnverifiedV1("UNTRUSTED_PROVIDER_EVIDENCE");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== "origin.cost-evidence.v1") {
    return createOriginCostBlockedUnverifiedV1("UNTRUSTED_PROVIDER_EVIDENCE");
  }

  if (candidate.status === "POLICY_ALLOWED"
    && typeof candidate.policyRef === "string"
    && candidate.measurement === null) {
    try {
      return createOriginCostPolicyAllowedV1(candidate.policyRef);
    } catch {
      return createOriginCostBlockedUnverifiedV1("UNTRUSTED_PROVIDER_EVIDENCE");
    }
  }

  if (candidate.status === "NOT_MEASURED"
    && (candidate.reason === "NO_PROVIDER_EXECUTION" || candidate.reason === "BILLING_NOT_AVAILABLE")
    && candidate.measurement === null) {
    return createOriginCostNotMeasuredV1(candidate.reason);
  }

  if (candidate.status === "BLOCKED_UNVERIFIED"
    && typeof candidate.reason === "string"
    && [
      "INCOMPLETE_REQUEST_LEDGER",
      "UNTRUSTED_PROVIDER_EVIDENCE",
      "RECONCILIATION_FAILED",
      "RECEIPT_EXPIRED",
      "REPLAY_DETECTED",
      "CONTRADICTORY_EVIDENCE",
    ].includes(candidate.reason)
    && candidate.measurement === null) {
    return createOriginCostBlockedUnverifiedV1(
      candidate.reason as OriginCostBlockedUnverifiedV1["reason"],
    );
  }

  // A JSON object claiming ZERO_COST_VERIFIED is never trusted at this boundary.
  return createOriginCostBlockedUnverifiedV1("UNTRUSTED_PROVIDER_EVIDENCE");
}
