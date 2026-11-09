// @vitest-environment node
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OriginEvidenceAttestationPayloadV1, OriginEvidenceTrustedKeyV1 } from "./OriginEvidenceAttestationV1.js";
import { verifyOriginProviderUsageAttestationV1 } from "./OriginProviderUsageAttestationGateV1.js";

const nowMs = Date.UTC(2026, 10, 3, 12, 0, 0);
const expectedBinding = {
  repository: "nori72ny/myAIspecials",
  candidateSha: "a".repeat(40),
  corpusDigest: "b".repeat(64),
  rubricDigest: "c".repeat(64),
  roundId: "aq-v2-round-2026-11-03",
  artifactDigest: "d".repeat(64),
};
const expected = {
  runId: "aq-run-2026-11-03-001",
  providerId: "provider-free",
  modelId: "model-free",
  billingWindowStart: "2026-11-03T11:00:00.000Z",
  billingWindowEnd: "2026-11-03T13:00:00.000Z",
  hostRequestIds: ["host:req:001", "host:req:002"],
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}

function fixture(options: {
  readonly requests?: readonly Record<string, unknown>[];
  readonly statementOverrides?: Record<string, unknown>;
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = "provider-key:cost-verifier";
  const payload: OriginEvidenceAttestationPayloadV1 = {
    schemaVersion: "origin.signed-evidence-attestation.v1",
    attestationType: "provider-usage",
    keyId,
    signerId: "provider:billing-attestor",
    signerRole: "provider-cost-verifier",
    ...expectedBinding,
    issuedAt: "2026-11-03T11:59:00.000Z",
    expiresAt: "2026-11-03T12:30:00.000Z",
    nonce: randomBytes(18).toString("base64url"),
    statement: {
      schemaVersion: "origin.provider-usage-ledger.v1",
      runId: expected.runId,
      providerId: expected.providerId,
      modelId: expected.modelId,
      billingWindowStart: expected.billingWindowStart,
      billingWindowEnd: expected.billingWindowEnd,
      complete: true,
      requests: options.requests ?? expected.hostRequestIds.map((requestId) => ({
        requestId,
        providerId: expected.providerId,
        modelId: expected.modelId,
        occurredAt: "2026-11-03T12:00:00.000Z",
        costUsd: 0,
      })),
      ...options.statementOverrides,
    },
  };
  const rawCanonicalPayload = canonical(payload);
  const signatureBase64Url = sign(null, Buffer.from(rawCanonicalPayload), privateKey).toString("base64url");
  const trustedKey: OriginEvidenceTrustedKeyV1 = {
    keyId,
    signerId: payload.signerId,
    role: "provider-cost-verifier",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    validFrom: "2026-11-01T00:00:00.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
  };
  return { rawCanonicalPayload, signatureBase64Url, trustedKey };
}

async function verify(value: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  return verifyOriginProviderUsageAttestationV1({
    ...value,
    trustedKeys: [value.trustedKey],
    expectedBinding,
    expected,
    claimNonce: async () => true,
    nowMs,
    ...overrides,
  } as Parameters<typeof verifyOriginProviderUsageAttestationV1>[0]);
}

describe("ORIGIN provider usage attestation gate V1", () => {
  it("accepts a provider-signed complete ledger reconciled with the host request IDs", async () => {
    const result = await verify(fixture());
    expect(result).toMatchObject({ ok: true, requestCount: 2, totalCostUsd: 0 });
  });

  it("rejects a missing host request from the provider ledger", async () => {
    const value = fixture({ requests: [{
      requestId: expected.hostRequestIds[0],
      providerId: expected.providerId,
      modelId: expected.modelId,
      occurredAt: "2026-11-03T12:00:00.000Z",
      costUsd: 0,
    }] });
    expect(await verify(value)).toEqual({ ok: false, code: "ORIGIN_PROVIDER_USAGE_LEDGER_INCOMPLETE" });
  });

  it("rejects duplicate request IDs", async () => {
    const request = {
      requestId: expected.hostRequestIds[0],
      providerId: expected.providerId,
      modelId: expected.modelId,
      occurredAt: "2026-11-03T12:00:00.000Z",
      costUsd: 0,
    };
    expect(await verify(fixture({ requests: [request, request] })))
      .toEqual({ ok: false, code: "ORIGIN_PROVIDER_USAGE_LEDGER_INCOMPLETE" });
  });

  it("rejects any non-zero request cost", async () => {
    const requests = expected.hostRequestIds.map((requestId) => ({
      requestId,
      providerId: expected.providerId,
      modelId: expected.modelId,
      occurredAt: "2026-11-03T12:00:00.000Z",
      costUsd: requestId === expected.hostRequestIds[0] ? 0.000001 : 0,
    }));
    expect(await verify(fixture({ requests })))
      .toEqual({ ok: false, code: "ORIGIN_PROVIDER_USAGE_NONZERO_COST" });
  });

  it("rejects a different run or provider/model binding", async () => {
    const value = fixture({ statementOverrides: { runId: "another-run" } });
    expect(await verify(value))
      .toEqual({ ok: false, code: "ORIGIN_PROVIDER_USAGE_BINDING_MISMATCH" });
  });

  it("rejects records outside the billing window", async () => {
    const requests = expected.hostRequestIds.map((requestId) => ({
      requestId,
      providerId: expected.providerId,
      modelId: expected.modelId,
      occurredAt: "2026-11-03T14:00:00.000Z",
      costUsd: 0,
    }));
    expect(await verify(fixture({ requests })))
      .toEqual({ ok: false, code: "ORIGIN_PROVIDER_USAGE_BINDING_MISMATCH" });
  });

  it("fails closed without an external trust registry or atomic nonce ledger", async () => {
    const value = fixture();
    expect(await verify(value, { trustedKeys: [] }))
      .toEqual({ ok: false, code: "ORIGIN_PROVIDER_USAGE_ATTESTATION_INVALID" });
    expect(await verify(value, { claimNonce: null }))
      .toEqual({ ok: false, code: "ORIGIN_PROVIDER_USAGE_ATTESTATION_INVALID" });
  });

  it("rejects replay when the trusted nonce ledger declines the nonce", async () => {
    expect(await verify(fixture(), { claimNonce: async () => false }))
      .toEqual({ ok: false, code: "ORIGIN_PROVIDER_USAGE_ATTESTATION_INVALID" });
  });
});
