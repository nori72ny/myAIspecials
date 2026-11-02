import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalizeOriginAqJsonV1,
  verifyOriginAqSignedAttestationV1,
  type OriginAqAttestationBindingV1,
  type OriginAqAttestationRoleV1,
  type OriginAqAttestationTypeV1,
  type OriginAqSignedAttestationV1,
  type OriginAqTrustedSignerKeyV1,
} from "./OriginAqSignedAttestationV1.js";

const binding: OriginAqAttestationBindingV1 = {
  repository: "nori72ny/myAIspecials",
  candidateSha: "a".repeat(40),
  corpusDigest: "b".repeat(64),
  rubricDigest: "c".repeat(64),
  roundId: "round-2026-11-02",
};
const artifact = Buffer.from("sanitized evaluator evidence", "utf8");
const artifactDigest = createHash("sha256").update(artifact).digest("hex");

function fixture(options: {
  role?: OriginAqAttestationRoleV1;
  type?: OriginAqAttestationTypeV1;
  issuedAt?: string;
  expiresAt?: string;
  nonce?: string;
} = {}) {
  const pair = generateKeyPairSync("ed25519");
  const key: OriginAqTrustedSignerKeyV1 = {
    keyId: "evaluator-key-01",
    signerId: "evaluator-independent-01",
    role: options.role ?? "answer-evaluator",
    algorithm: "Ed25519",
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    repository: binding.repository,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
  };
  const unsigned = {
    schemaVersion: "origin.aq-signed-attestation.v1" as const,
    attestationType: options.type ?? "evaluator-score" as const,
    keyId: key.keyId,
    signerId: key.signerId,
    signerRole: key.role,
    issuedAt: options.issuedAt ?? "2026-11-02T12:00:00.000Z",
    expiresAt: options.expiresAt ?? "2026-11-03T12:00:00.000Z",
    nonce: options.nonce ?? "nonce-0123456789-abcdefghijkl",
    binding,
    artifactDigest,
    payload: { caseId: "case-001", score: 4, rationaleDigest: "d".repeat(64) },
  };
  const signatureBase64 = sign(
    null,
    Buffer.from(canonicalizeOriginAqJsonV1(unsigned)),
    pair.privateKey,
  ).toString("base64");
  const envelope: OriginAqSignedAttestationV1 = { ...unsigned, signatureBase64 };
  return {
    key,
    rawEnvelopeJson: canonicalizeOriginAqJsonV1(envelope),
    artifactBytes: artifact,
    expected: {
      attestationType: "evaluator-score" as const,
      signerRole: "answer-evaluator" as const,
      binding,
    },
  };
}

describe("OriginAqSignedAttestationV1", () => {
  it("accepts an exact signed artifact from a trusted role and claims its nonce once", async () => {
    const value = fixture();
    let claims = 0;
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      trustedKeys: [value.key],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => { claims += 1; return true; },
    });
    expect(result.ok).toBe(true);
    expect(claims).toBe(1);
  });

  it("rejects payload tampering after signing", async () => {
    const value = fixture();
    const envelope = JSON.parse(value.rawEnvelopeJson) as OriginAqSignedAttestationV1;
    const tampered = canonicalizeOriginAqJsonV1({
      ...envelope,
      payload: { ...envelope.payload, score: 5 },
    });
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      rawEnvelopeJson: tampered,
      trustedKeys: [value.key],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => true,
    });
    expect(result).toEqual({ ok: false, code: "AQ_ATTESTATION_SIGNATURE_INVALID" });
  });

  it("rejects artifact bytes that do not match the signed digest", async () => {
    const value = fixture();
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      artifactBytes: Buffer.from("substituted evidence"),
      trustedKeys: [value.key],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => true,
    });
    expect(result).toEqual({ ok: false, code: "AQ_ATTESTATION_ARTIFACT_DIGEST_MISMATCH" });
  });

  it("rejects an unknown signer even when the envelope is correctly signed", async () => {
    const value = fixture();
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      trustedKeys: [],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => true,
    });
    expect(result).toEqual({ ok: false, code: "AQ_ATTESTATION_KEY_UNTRUSTED" });
  });

  it("rejects a signer key assigned to a different role", async () => {
    const value = fixture();
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      expected: { ...value.expected, signerRole: "blind-judge" },
      trustedKeys: [value.key],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => true,
    });
    expect(result).toEqual({ ok: false, code: "AQ_ATTESTATION_BINDING_MISMATCH" });
  });

  it("rejects expired attestations before claiming a nonce", async () => {
    const value = fixture({ expiresAt: "2026-11-02T12:30:00.000Z" });
    let claims = 0;
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      trustedKeys: [value.key],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => { claims += 1; return true; },
    });
    expect(result).toEqual({ ok: false, code: "AQ_ATTESTATION_TIME_INVALID" });
    expect(claims).toBe(0);
  });

  it("rejects nonce replay through the shared atomic ledger", async () => {
    const value = fixture();
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      trustedKeys: [value.key],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => false,
    });
    expect(result).toEqual({ ok: false, code: "AQ_ATTESTATION_REPLAY" });
  });

  it("rejects non-canonical JSON including whitespace changes", async () => {
    const value = fixture();
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      rawEnvelopeJson: value.rawEnvelopeJson + "\n",
      trustedKeys: [value.key],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => true,
    });
    expect(result).toEqual({ ok: false, code: "AQ_ATTESTATION_NON_CANONICAL" });
  });

  it("rejects a candidate SHA, corpus, rubric, or round mismatch", async () => {
    const value = fixture();
    const result = await verifyOriginAqSignedAttestationV1({
      ...value,
      expected: {
        ...value.expected,
        binding: { ...binding, candidateSha: "e".repeat(40) },
      },
      trustedKeys: [value.key],
      nowMs: Date.parse("2026-11-02T13:00:00.000Z"),
      claimNonce: async () => true,
    });
    expect(result).toEqual({ ok: false, code: "AQ_ATTESTATION_BINDING_MISMATCH" });
  });
});
