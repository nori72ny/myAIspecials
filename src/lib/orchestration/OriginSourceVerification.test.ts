import { describe, expect, it, vi } from "vitest";
import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import {
  executeOriginSourceVerification,
  type OriginSourceVerificationExecutor,
  type OriginSourceVerificationRecord,
} from "./OriginSourceVerification";

const nowMs = Date.parse("2026-07-23T04:30:00.000Z");
const evidence: OriginAnswerEvidenceItem = {
  label: "公式資料",
  sourceUrl: "https://docs.example.com/current",
  claim: "公式資料では無料枠が提供されています。",
  claimBinding: "explicit-inline-citation",
  evidenceLevel: "provided",
  checks: {
    safeUrl: "passed",
    content: "not-run",
    freshness: "not-run",
    claimSupport: "not-run",
  },
};
const request = {
  verificationId: "source-check-001",
  evidence,
};
const validRecord: OriginSourceVerificationRecord = {
  verificationId: request.verificationId,
  sourceUrl: "https://docs.example.com/current",
  finalUrl: "https://docs.example.com/current",
  claim: "公式資料では無料枠が提供されています。",
  fetchedAt: "2026-07-23T04:29:00.000Z",
  httpStatus: 200,
  contentDigest: `sha256:${"a".repeat(64)}`,
  externalFetchPerformed: true,
  actualCostUsd: 0,
  networkPolicy: {
    publicAddressOnly: true,
    redirectsFollowed: false,
  },
  checks: {
    content: "passed",
    freshness: "passed",
    claimSupport: "passed",
  },
};

describe("executeOriginSourceVerification", () => {
  it("fails closed without an injected verifier", async () => {
    await expect(executeOriginSourceVerification(request, undefined, nowMs)).resolves.toEqual({
      ok: false,
      code: "VERIFIER_NOT_AVAILABLE",
      message: "出典内容を確認する安全な実行経路が接続されていません。",
    });
  });

  it("promotes evidence only after one zero-cost, matching verification record", async () => {
    const execute = vi.fn().mockResolvedValue(validRecord);

    const result = await executeOriginSourceVerification(request, execute, nowMs);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      verificationId: request.verificationId,
      claim: evidence.claim,
      sourceUrl: evidence.sourceUrl,
      executionPolicy: {
        maxCostUsd: 0,
        maxAttempts: 1,
        allowRedirects: false,
        publicNetworkOnly: true,
      },
    });
    expect(result).toEqual({
      ok: true,
      evidence: {
        ...evidence,
        evidenceLevel: "source-checked",
        checks: {
          safeUrl: "passed",
          content: "passed",
          freshness: "passed",
          claimSupport: "passed",
        },
      },
    });
  });

  it("does not execute for a private target or already-promoted evidence", async () => {
    const execute = vi.fn();
    const privateTarget = {
      ...request,
      evidence: { ...evidence, sourceUrl: "https://127.0.0.1/source" },
    };
    const alreadyChecked = {
      ...request,
      evidence: {
        ...evidence,
        evidenceLevel: "source-checked" as const,
        checks: {
          safeUrl: "passed" as const,
          content: "passed" as const,
          freshness: "passed" as const,
          claimSupport: "passed" as const,
        },
      },
    };

    const privateResult = await executeOriginSourceVerification(privateTarget, execute, nowMs);
    const checkedResult = await executeOriginSourceVerification(alreadyChecked, execute, nowMs);

    expect(privateResult.ok).toBe(false);
    expect(checkedResult.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not send a secret-bearing claim or unsafe verification ID to an executor", async () => {
    const execute = vi.fn();
    const secretClaim = {
      ...request,
      evidence: {
        ...evidence,
        claim: "Authorization: Bearer synthetic_source_secret_123456",
      },
    };
    const unsafeId = {
      ...request,
      verificationId: "source-check\nforged-log-line",
    };

    const secretResult = await executeOriginSourceVerification(secretClaim, execute, nowMs);
    const idResult = await executeOriginSourceVerification(unsafeId, execute, nowMs);

    expect(secretResult).toEqual(expect.objectContaining({
      ok: false,
      code: "INVALID_VERIFICATION_REQUEST",
    }));
    expect(idResult).toEqual(expect.objectContaining({
      ok: false,
      code: "INVALID_VERIFICATION_REQUEST",
    }));
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an attempt to disable record freshness with an excessive age limit", async () => {
    const execute = vi.fn();

    const result = await executeOriginSourceVerification(
      request,
      execute,
      nowMs,
      24 * 60 * 60 * 1_000 + 1,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "INVALID_VERIFICATION_REQUEST",
    }));
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["verification ID", { verificationId: "other-check" }],
    ["claim", { claim: "異なる主張です。" }],
    ["source URL", { sourceUrl: "https://other.example.com/current" }],
    ["final URL", { finalUrl: "https://redirected.example.com/current" }],
    ["digest", { contentDigest: "sha256:not-a-digest" }],
    ["redirect policy", { networkPolicy: { publicAddressOnly: true, redirectsFollowed: true } }],
  ])("rejects a mismatched %s record", async (_label, override) => {
    const execute = vi.fn().mockResolvedValue({ ...validRecord, ...override });

    const result = await executeOriginSourceVerification(request, execute, nowMs);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "VERIFICATION_RECORD_MISMATCH",
    }));
  });

  it("rejects malformed executor output instead of throwing", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "passed" });

    await expect(executeOriginSourceVerification(request, execute, nowMs)).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "VERIFICATION_RECORD_MISMATCH",
      }),
    );
  });

  it.each([
    ["stale", "2026-07-23T04:14:59.999Z"],
    ["too far in the future", "2026-07-23T04:30:30.001Z"],
    ["invalid", "not-a-date"],
  ])("rejects a %s verification timestamp", async (_label, fetchedAt) => {
    const execute = vi.fn().mockResolvedValue({ ...validRecord, fetchedAt });

    const result = await executeOriginSourceVerification(request, execute, nowMs);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "VERIFICATION_RECORD_STALE",
    }));
  });

  it("rejects a non-zero or non-finite verification cost", async () => {
    const paid = vi.fn().mockResolvedValue({ ...validRecord, actualCostUsd: 0.01 });
    const unknown = vi.fn().mockResolvedValue({ ...validRecord, actualCostUsd: Number.NaN });

    const paidResult = await executeOriginSourceVerification(request, paid, nowMs);
    const unknownResult = await executeOriginSourceVerification(request, unknown, nowMs);

    expect(paidResult).toEqual(expect.objectContaining({
      ok: false,
      code: "VERIFICATION_COST_UNVERIFIED",
    }));
    expect(unknownResult).toEqual(expect.objectContaining({
      ok: false,
      code: "VERIFICATION_COST_UNVERIFIED",
    }));
  });

  it.each([
    { content: "failed", freshness: "passed", claimSupport: "passed" },
    { content: "passed", freshness: "failed", claimSupport: "passed" },
    { content: "passed", freshness: "passed", claimSupport: "failed" },
  ] as const)("keeps evidence unverified when a required check fails", async (checks) => {
    const execute = vi.fn().mockResolvedValue({ ...validRecord, checks });

    const result = await executeOriginSourceVerification(request, execute, nowMs);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "SOURCE_NOT_VERIFIED",
    }));
  });

  it("allows freshness to be explicitly not applicable", async () => {
    const execute = vi.fn().mockResolvedValue({
      ...validRecord,
      checks: { ...validRecord.checks, freshness: "not-applicable" },
    });

    const result = await executeOriginSourceVerification(request, execute, nowMs);

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      evidence: expect.objectContaining({
        checks: expect.objectContaining({ freshness: "not-applicable" }),
      }),
    }));
  });

  it("does not retry after an executor failure", async () => {
    const execute: OriginSourceVerificationExecutor = vi.fn().mockRejectedValue(
      new Error("synthetic verifier failure"),
    );

    const result = await executeOriginSourceVerification(request, execute, nowMs);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      code: "VERIFICATION_EXECUTION_FAILED",
      message: "出典確認に失敗したため、未確認のまま扱います。",
    });
  });
});
