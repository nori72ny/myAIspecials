import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";

export type OriginEvidenceAttestationRoleV1 =
  | "host-attestor"
  | "absolute-evaluator"
  | "reference-capture"
  | "blind-judge"
  | "provider-cost-verifier";

export type OriginEvidenceAttestationTypeV1 =
  | "host-execution"
  | "evaluator-score"
  | "reference-answer"
  | "judge-vote"
  | "provider-usage";

export interface OriginEvidenceTrustedKeyV1 {
  readonly keyId: string;
  readonly signerId: string;
  readonly role: OriginEvidenceAttestationRoleV1;
  readonly publicKeyPem: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revoked?: boolean;
}

export interface OriginEvidenceAttestationExpectedBindingV1 {
  readonly repository: string;
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly rubricDigest: string;
  readonly roundId: string;
  readonly artifactDigest: string;
}

export interface OriginEvidenceAttestationPayloadV1 {
  readonly schemaVersion: "origin.signed-evidence-attestation.v1";
  readonly attestationType: OriginEvidenceAttestationTypeV1;
  readonly keyId: string;
  readonly signerId: string;
  readonly signerRole: OriginEvidenceAttestationRoleV1;
  readonly repository: string;
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly rubricDigest: string;
  readonly roundId: string;
  readonly artifactDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly statement: Readonly<Record<string, unknown>>;
}

export interface OriginVerifiedEvidenceAttestationV1 {
  readonly schemaVersion: "origin.verified-evidence-attestation.v1";
  readonly attestationType: OriginEvidenceAttestationTypeV1;
  readonly keyId: string;
  readonly signerId: string;
  readonly signerRole: OriginEvidenceAttestationRoleV1;
  readonly repository: string;
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly rubricDigest: string;
  readonly roundId: string;
  readonly artifactDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly statement: Readonly<Record<string, unknown>>;
}

export type OriginEvidenceAttestationVerificationV1 =
  | { readonly ok: true; readonly value: OriginVerifiedEvidenceAttestationV1 }
  | { readonly ok: false; readonly code: string };

export type OriginEvidenceNonceClaimerV1 = (
  keyId: string,
  nonce: string,
) => Promise<boolean>;

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_SIGNATURE_BYTES = 128;
const MAX_ATTESTATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;

const ROLE_BY_TYPE: Readonly<Record<OriginEvidenceAttestationTypeV1, OriginEvidenceAttestationRoleV1>> = {
  "host-execution": "host-attestor",
  "evaluator-score": "absolute-evaluator",
  "reference-answer": "reference-capture",
  "judge-vote": "blind-judge",
  "provider-usage": "provider-cost-verifier",
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ORIGIN_ATTESTATION_NON_FINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ORIGIN_ATTESTATION_NON_JSON_VALUE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTimeWindow(payload: Record<string, unknown>, nowMs: number): boolean {
  if (typeof payload.issuedAt !== "string" || typeof payload.expiresAt !== "string") return false;
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  return Number.isFinite(issuedAt)
    && Number.isFinite(expiresAt)
    && issuedAt <= nowMs + MAX_CLOCK_SKEW_MS
    && expiresAt > nowMs
    && expiresAt > issuedAt
    && expiresAt - issuedAt <= MAX_ATTESTATION_LIFETIME_MS;
}

function validExpectedBinding(
  payload: Record<string, unknown>,
  expected: OriginEvidenceAttestationExpectedBindingV1,
): boolean {
  return payload.repository === expected.repository
    && payload.candidateSha === expected.candidateSha
    && payload.corpusDigest === expected.corpusDigest
    && payload.rubricDigest === expected.rubricDigest
    && payload.roundId === expected.roundId
    && payload.artifactDigest === expected.artifactDigest;
}

function decodeSignature(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length !== 64 || decoded.toString("base64url") !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Verifies an independently signed AQ evidence envelope.
 *
 * The trust registry and nonce claimer must be controlled by the verifier,
 * never by the candidate or the evidence packet. The nonce claimer must be
 * atomic (for example, a UNIQUE insert in a trusted ledger) to prevent replay
 * under concurrent verification. An empty registry fails closed.
 */
export async function verifyOriginEvidenceAttestationV1(
  rawCanonicalPayload: string,
  signatureBase64Url: string,
  trustedKeys: readonly OriginEvidenceTrustedKeyV1[],
  expected: OriginEvidenceAttestationExpectedBindingV1,
  claimNonce: OriginEvidenceNonceClaimerV1 | null,
  options: { readonly nowMs?: number } = {},
): Promise<OriginEvidenceAttestationVerificationV1> {
  const fail = (code: string): OriginEvidenceAttestationVerificationV1 => ({ ok: false, code });
  if (typeof rawCanonicalPayload !== "string" || Buffer.byteLength(rawCanonicalPayload, "utf8") > MAX_PAYLOAD_BYTES) {
    return fail("ORIGIN_ATTESTATION_PAYLOAD_SIZE_INVALID");
  }
  if (!claimNonce) return fail("ORIGIN_ATTESTATION_NONCE_LEDGER_REQUIRED");
  if (!Array.isArray(trustedKeys) || trustedKeys.length === 0) return fail("ORIGIN_ATTESTATION_TRUST_REGISTRY_EMPTY");

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawCanonicalPayload);
    if (!isRecord(parsed)) return fail("ORIGIN_ATTESTATION_PAYLOAD_INVALID");
    payload = parsed;
    if (canonicalJson(parsed as JsonValue) !== rawCanonicalPayload) return fail("ORIGIN_ATTESTATION_PAYLOAD_NOT_CANONICAL");
  } catch {
    return fail("ORIGIN_ATTESTATION_PAYLOAD_INVALID");
  }

  if (payload.schemaVersion !== "origin.signed-evidence-attestation.v1") return fail("ORIGIN_ATTESTATION_SCHEMA_INVALID");
  const type = payload.attestationType;
  if (typeof type !== "string" || !Object.hasOwn(ROLE_BY_TYPE, type)) return fail("ORIGIN_ATTESTATION_TYPE_INVALID");
  const expectedRole = ROLE_BY_TYPE[type as OriginEvidenceAttestationTypeV1];
  if (payload.signerRole !== expectedRole) return fail("ORIGIN_ATTESTATION_ROLE_INVALID");
  if (typeof payload.keyId !== "string" || !ID.test(payload.keyId)) return fail("ORIGIN_ATTESTATION_KEY_ID_INVALID");
  if (typeof payload.signerId !== "string" || !ID.test(payload.signerId)) return fail("ORIGIN_ATTESTATION_SIGNER_ID_INVALID");
  if (typeof payload.nonce !== "string" || !NONCE.test(payload.nonce)) return fail("ORIGIN_ATTESTATION_NONCE_INVALID");
  if (typeof payload.candidateSha !== "string" || !SHA40.test(payload.candidateSha)) return fail("ORIGIN_ATTESTATION_CANDIDATE_SHA_INVALID");
  for (const field of ["corpusDigest", "rubricDigest", "artifactDigest"] as const) {
    if (typeof payload[field] !== "string" || !SHA64.test(payload[field])) return fail(`ORIGIN_ATTESTATION_${field.toUpperCase()}_INVALID`);
  }
  if (typeof payload.repository !== "string" || !ID.test(payload.repository.replace("/", ":"))) return fail("ORIGIN_ATTESTATION_REPOSITORY_INVALID");
  if (typeof payload.roundId !== "string" || !ID.test(payload.roundId)) return fail("ORIGIN_ATTESTATION_ROUND_INVALID");
  if (!isRecord(payload.statement)) return fail("ORIGIN_ATTESTATION_STATEMENT_INVALID");
  const nowMs = options.nowMs ?? Date.now();
  if (!validTimeWindow(payload, nowMs)) return fail("ORIGIN_ATTESTATION_TIME_WINDOW_INVALID");
  if (!validExpectedBinding(payload, expected)) return fail("ORIGIN_ATTESTATION_BINDING_MISMATCH");

  const matchingKeys = trustedKeys.filter(item => item.keyId === payload.keyId);
  if (matchingKeys.length === 0) return fail("ORIGIN_ATTESTATION_KEY_UNTRUSTED");
  if (matchingKeys.length !== 1) return fail("ORIGIN_ATTESTATION_TRUST_REGISTRY_AMBIGUOUS");
  const key = matchingKeys[0];
  if (key.revoked === true) return fail("ORIGIN_ATTESTATION_KEY_REVOKED");
  if (key.signerId !== payload.signerId || key.role !== expectedRole || payload.signerRole !== key.role) {
    return fail("ORIGIN_ATTESTATION_TRUST_ROLE_MISMATCH");
  }
  const keyStart = Date.parse(key.validFrom);
  const keyEnd = Date.parse(key.validUntil);
  const issuedAt = Date.parse(payload.issuedAt as string);
  if (!Number.isFinite(keyStart) || !Number.isFinite(keyEnd) || nowMs < keyStart || issuedAt < keyStart || issuedAt > keyEnd || nowMs > keyEnd) {
    return fail("ORIGIN_ATTESTATION_KEY_OUTSIDE_VALIDITY");
  }

  const signature = decodeSignature(signatureBase64Url);
  if (!signature || Buffer.byteLength(signatureBase64Url, "utf8") > MAX_SIGNATURE_BYTES) {
    return fail("ORIGIN_ATTESTATION_SIGNATURE_ENCODING_INVALID");
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(key.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") return fail("ORIGIN_ATTESTATION_KEY_ALGORITHM_INVALID");
  } catch {
    return fail("ORIGIN_ATTESTATION_PUBLIC_KEY_INVALID");
  }

  if (!verifySignature(null, Buffer.from(rawCanonicalPayload, "utf8"), publicKey, signature)) {
    return fail("ORIGIN_ATTESTATION_SIGNATURE_INVALID");
  }

  let nonceClaimed = false;
  try {
    nonceClaimed = await claimNonce(key.keyId, payload.nonce as string);
  } catch {
    return fail("ORIGIN_ATTESTATION_NONCE_LEDGER_UNAVAILABLE");
  }
  if (!nonceClaimed) return fail("ORIGIN_ATTESTATION_REPLAY_DETECTED");

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.verified-evidence-attestation.v1",
      attestationType: type as OriginEvidenceAttestationTypeV1,
      keyId: key.keyId,
      signerId: key.signerId,
      signerRole: key.role,
      repository: payload.repository as string,
      candidateSha: payload.candidateSha as string,
      corpusDigest: payload.corpusDigest as string,
      rubricDigest: payload.rubricDigest as string,
      roundId: payload.roundId as string,
      artifactDigest: payload.artifactDigest as string,
      issuedAt: payload.issuedAt as string,
      expiresAt: payload.expiresAt as string,
      nonce: payload.nonce as string,
      statement: Object.freeze({ ...payload.statement }),
    }),
  };
}
