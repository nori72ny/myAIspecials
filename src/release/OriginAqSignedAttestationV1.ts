import { createHash, createPublicKey, verify } from "node:crypto";

export type OriginAqAttestationRoleV1 =
  | "host-attestor"
  | "answer-evaluator"
  | "reference-capture"
  | "blind-judge"
  | "provider-cost-auditor";

export type OriginAqAttestationTypeV1 =
  | "host-execution"
  | "evaluator-score"
  | "reference-answer"
  | "judge-vote"
  | "provider-usage";

export interface OriginAqAttestationBindingV1 {
  readonly repository: string;
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly rubricDigest: string;
  readonly roundId: string;
}

export interface OriginAqTrustedSignerKeyV1 {
  readonly keyId: string;
  readonly signerId: string;
  readonly role: OriginAqAttestationRoleV1;
  readonly algorithm: "Ed25519";
  readonly publicKeyPem: string;
  readonly repository: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt?: string;
}

export interface OriginAqSignedAttestationV1 {
  readonly schemaVersion: "origin.aq-signed-attestation.v1";
  readonly attestationType: OriginAqAttestationTypeV1;
  readonly keyId: string;
  readonly signerId: string;
  readonly signerRole: OriginAqAttestationRoleV1;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly binding: OriginAqAttestationBindingV1;
  readonly artifactDigest: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signatureBase64: string;
}

export interface OriginAqAttestationExpectedBindingV1 {
  readonly attestationType: OriginAqAttestationTypeV1;
  readonly signerRole: OriginAqAttestationRoleV1;
  readonly binding: OriginAqAttestationBindingV1;
}

export type OriginAqAttestationVerificationV1 =
  | { readonly ok: true; readonly attestation: OriginAqSignedAttestationV1; readonly artifactDigest: string }
  | {
      readonly ok: false;
      readonly code:
        | "AQ_ATTESTATION_JSON_INVALID"
        | "AQ_ATTESTATION_NON_CANONICAL"
        | "AQ_ATTESTATION_SCHEMA_INVALID"
        | "AQ_ATTESTATION_BINDING_MISMATCH"
        | "AQ_ATTESTATION_KEY_UNTRUSTED"
        | "AQ_ATTESTATION_KEY_REVOKED"
        | "AQ_ATTESTATION_KEY_EXPIRED"
        | "AQ_ATTESTATION_TIME_INVALID"
        | "AQ_ATTESTATION_NONCE_INVALID"
        | "AQ_ATTESTATION_ARTIFACT_DIGEST_MISMATCH"
        | "AQ_ATTESTATION_SIGNATURE_INVALID"
        | "AQ_ATTESTATION_REPLAY";
    };

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** RFC 8785-compatible canonical JSON for the supported JSON value domain. */
export function canonicalizeOriginAqJsonV1(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("AQ_ATTESTATION_JSON_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(item => canonicalizeOriginAqJsonV1(item)).join(",") + "]";
  }
  if (!isRecord(value)) throw new TypeError("AQ_ATTESTATION_JSON_VALUE_INVALID");
  const keys = Object.keys(value).sort();
  return "{" + keys.map(key =>
    JSON.stringify(key) + ":" + canonicalizeOriginAqJsonV1(value[key]),
  ).join(",") + "}";
}

function validBinding(value: unknown): value is OriginAqAttestationBindingV1 {
  if (!isRecord(value)) return false;
  return typeof value.repository === "string"
    && value.repository.length > 0
    && SHA40.test(String(value.candidateSha))
    && SHA256.test(String(value.corpusDigest))
    && SHA256.test(String(value.rubricDigest))
    && ID.test(String(value.roundId));
}

function sameBinding(
  actual: OriginAqAttestationBindingV1,
  expected: OriginAqAttestationBindingV1,
): boolean {
  return actual.repository === expected.repository
    && actual.candidateSha === expected.candidateSha
    && actual.corpusDigest === expected.corpusDigest
    && actual.rubricDigest === expected.rubricDigest
    && actual.roundId === expected.roundId;
}

function parseCanonicalEnvelope(raw: string): OriginAqSignedAttestationV1 | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || canonicalizeOriginAqJsonV1(parsed) !== raw) return null;
    return parsed as unknown as OriginAqSignedAttestationV1;
  } catch {
    return null;
  }
}

export async function verifyOriginAqSignedAttestationV1(input: {
  readonly rawEnvelopeJson: string;
  readonly artifactBytes: Uint8Array;
  /** Must be loaded from the trusted main-branch registry, never from the packet. */
  readonly trustedKeys: readonly OriginAqTrustedSignerKeyV1[];
  readonly expected: OriginAqAttestationExpectedBindingV1;
  readonly nowMs?: number;
  /** Must be a persistent atomic compare-and-set operation shared by verifier workers. */
  readonly claimNonce: (key: string) => Promise<boolean>;
}): Promise<OriginAqAttestationVerificationV1> {
  const attestation = parseCanonicalEnvelope(input.rawEnvelopeJson);
  if (!attestation) return { ok: false, code: "AQ_ATTESTATION_NON_CANONICAL" };

  if (
    attestation.schemaVersion !== "origin.aq-signed-attestation.v1"
    || !["host-execution", "evaluator-score", "reference-answer", "judge-vote", "provider-usage"].includes(attestation.attestationType)
    || !ID.test(attestation.keyId)
    || !ID.test(attestation.signerId)
    || !NONCE.test(attestation.nonce)
    || !isRecord(attestation.payload)
    || !validBinding(attestation.binding)
    || !SHA256.test(attestation.artifactDigest)
    || typeof attestation.signatureBase64 !== "string"
  ) return { ok: false, code: "AQ_ATTESTATION_SCHEMA_INVALID" };

  if (
    attestation.attestationType !== input.expected.attestationType
    || attestation.signerRole !== input.expected.signerRole
    || !sameBinding(attestation.binding, input.expected.binding)
  ) return { ok: false, code: "AQ_ATTESTATION_BINDING_MISMATCH" };

  const key = input.trustedKeys.find(item =>
    item.keyId === attestation.keyId
    && item.signerId === attestation.signerId
    && item.role === attestation.signerRole
    && item.algorithm === "Ed25519"
    && item.repository === attestation.binding.repository,
  );
  if (!key) return { ok: false, code: "AQ_ATTESTATION_KEY_UNTRUSTED" };

  const now = input.nowMs ?? Date.now();
  const validFrom = Date.parse(key.validFrom);
  const validUntil = Date.parse(key.validUntil);
  const issuedAt = Date.parse(attestation.issuedAt);
  const expiresAt = Date.parse(attestation.expiresAt);
  if (key.revokedAt !== undefined) {
    const revokedAt = Date.parse(key.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt <= now) {
      return { ok: false, code: "AQ_ATTESTATION_KEY_REVOKED" };
    }
  }
  if (
    !Number.isFinite(validFrom) || !Number.isFinite(validUntil)
    || now < validFrom || now > validUntil
    || issuedAt < validFrom || issuedAt > validUntil
  ) return { ok: false, code: "AQ_ATTESTATION_KEY_EXPIRED" };
  if (
    !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > now + MAX_CLOCK_SKEW_MS
    || expiresAt <= now || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_LIFETIME_MS
  ) return { ok: false, code: "AQ_ATTESTATION_TIME_INVALID" };

  const artifactDigest = createHash("sha256").update(input.artifactBytes).digest("hex");
  if (artifactDigest !== attestation.artifactDigest) {
    return { ok: false, code: "AQ_ATTESTATION_ARTIFACT_DIGEST_MISMATCH" };
  }

  try {
    const publicKey = createPublicKey(key.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") {
      return { ok: false, code: "AQ_ATTESTATION_KEY_UNTRUSTED" };
    }
    const { signatureBase64, ...unsigned } = attestation;
    const signature = Buffer.from(signatureBase64, "base64");
    if (
      signature.length !== 64
      || signature.toString("base64") !== signatureBase64
      || !verify(null, Buffer.from(canonicalizeOriginAqJsonV1(unsigned)), publicKey, signature)
    ) return { ok: false, code: "AQ_ATTESTATION_SIGNATURE_INVALID" };
  } catch {
    return { ok: false, code: "AQ_ATTESTATION_SIGNATURE_INVALID" };
  }

  const replayKey = [attestation.keyId, attestation.nonce].join(":");
  if (!await input.claimNonce(replayKey)) return { ok: false, code: "AQ_ATTESTATION_REPLAY" };

  return Object.freeze({ ok: true, attestation, artifactDigest });
}
