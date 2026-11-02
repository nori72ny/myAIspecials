// @vitest-environment node
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyOriginEvidenceAttestationV1,
  type OriginEvidenceAttestationPayloadV1,
  type OriginEvidenceTrustedKeyV1,
} from "./OriginEvidenceAttestationV1.js";

const nowMs = Date.UTC(2026, 10, 2, 12, 0, 0);
const expected = {
  repository: "nori72ny/myAIspecials",
  candidateSha: "a".repeat(40),
  corpusDigest: "b".repeat(64),
  rubricDigest: "c".repeat(64),
  roundId: "aq-v2-round-2026-11-02",
  artifactDigest: "d".repeat(64),
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}

function fixture(overrides: Partial<OriginEvidenceAttestationPayloadV1> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = "test-key:answer-evaluator";
  const payload: OriginEvidenceAttestationPayloadV1 = {
    schemaVersion: "origin.signed-evidence-attestation.v1",
    attestationType: "evaluator-score",
    keyId,
    signerId: "reviewer:independent-01",
    signerRole: "absolute-evaluator",
    ...expected,
    issuedAt: "2026-11-02T11:59:00.000Z",
    expiresAt: "2026-11-02T12:30:00.000Z",
    nonce: randomBytes(18).toString("base64url"),
    statement: { score: 4, caseId: "aq2-01", axis: "correctness" },
    ...overrides,
  };
  const raw = canonical(payload);
  const signature = sign(null, Buffer.from(raw, "utf8"), privateKey).toString("base64url");
  const key: OriginEvidenceTrustedKeyV1 = {
    keyId,
    signerId: payload.signerId,
    role: "absolute-evaluator",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    validFrom: "2026-11-01T00:00:00.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
  };
  return { raw, signature, key, payload };
}

describe("ORIGIN signed evidence attestation V1", () => {
  it("accepts a correctly signed payload bound to the exact repository, candidate, corpus, rubric, round and artifact", async () => {
    const value = fixture();
    const result = await verifyOriginEvidenceAttestationV1(
      value.raw, value.signature, [value.key], expected,
      async (keyId, nonce) => keyId === value.key.keyId && nonce === value.payload.nonce,
      { nowMs },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidateSha).toBe(expected.candidateSha);
      expect(result.value.signerRole).toBe("absolute-evaluator");
    }
  });

  it("fails closed when the trust registry is empty", async () => {
    const value = fixture();
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_TRUST_REGISTRY_EMPTY" });
  });

  it("rejects a forged payload or altered signature", async () => {
    const value = fixture();
    await expect(verifyOriginEvidenceAttestationV1(value.raw, `${value.signature.slice(0, -2)}aa`, [value.key], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_SIGNATURE_INVALID" });
  });

  it("rejects a non-canonical or duplicate-key JSON payload", async () => {
    const value = fixture();
    const nonCanonical = `{ "schemaVersion":"origin.signed-evidence-attestation.v1","schemaVersion":"origin.signed-evidence-attestation.v1" }`;
    await expect(verifyOriginEvidenceAttestationV1(nonCanonical, value.signature, [value.key], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_PAYLOAD_NOT_CANONICAL" });
  });

  it("rejects a payload bound to a different candidate SHA", async () => {
    const value = fixture({ candidateSha: "f".repeat(40) });
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [value.key], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_BINDING_MISMATCH" });
  });

  it("rejects a signer key with a mismatched role", async () => {
    const value = fixture();
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [{ ...value.key, role: "blind-judge" }], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_TRUST_ROLE_MISMATCH" });
  });

  it("rejects revoked and expired trust keys", async () => {
    const value = fixture();
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [{ ...value.key, revoked: true }], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_KEY_REVOKED" });
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [{ ...value.key, validUntil: "2026-11-02T11:00:00.000Z" }], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_KEY_OUTSIDE_VALIDITY" });
  });

  it("requires an atomic nonce ledger and rejects replay", async () => {
    const value = fixture();
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [value.key], expected, null, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_NONCE_LEDGER_REQUIRED" });
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [value.key], expected, async () => false, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_REPLAY_DETECTED" });
  });

  it("rejects duplicate key IDs and keys that are not yet valid", async () => {
    const value = fixture();
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [value.key, value.key], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_TRUST_REGISTRY_AMBIGUOUS" });
    await expect(verifyOriginEvidenceAttestationV1(value.raw, value.signature, [{ ...value.key, validFrom: "2026-11-03T00:00:00.000Z" }], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_KEY_OUTSIDE_VALIDITY" });
  });

  it("rejects expired attestations and invalid signature encodings", async () => {
    const expired = fixture({ expiresAt: "2026-11-02T11:00:00.000Z" });
    await expect(verifyOriginEvidenceAttestationV1(expired.raw, expired.signature, [expired.key], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_TIME_WINDOW_INVALID" });
    const value = fixture();
    await expect(verifyOriginEvidenceAttestationV1(value.raw, "not-a-signature", [value.key], expected, async () => true, { nowMs }))
      .resolves.toEqual({ ok: false, code: "ORIGIN_ATTESTATION_SIGNATURE_ENCODING_INVALID" });
  });
});
