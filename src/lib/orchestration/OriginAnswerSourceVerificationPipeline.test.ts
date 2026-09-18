import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import { verifyOriginAnswerSources } from "./OriginAnswerSourceVerificationPipeline";

const cited: OriginAnswerEvidenceItem = {
  label: "Official source",
  sourceUrl: "https://example.com/docs",
  claim: "The service has a free tier.",
  claimBinding: "explicit-inline-citation",
  evidenceLevel: "provided",
  checks: {
    safeUrl: "passed",
    content: "not-run",
    freshness: "not-run",
    claimSupport: "not-run",
  },
};

const unbound: OriginAnswerEvidenceItem = {
  label: "Background source",
  sourceUrl: "https://example.org/background",
  evidenceLevel: "provided",
  checks: {
    safeUrl: "passed",
    content: "not-run",
    freshness: "not-run",
    claimSupport: "not-run",
  },
};

describe("OriginAnswerSourceVerificationPipeline", () => {
  it("promotes only successfully verified explicit claim citations", async () => {
    const executor = vi.fn().mockResolvedValue({
      verificationId: "answer-source-1",
      sourceUrl: "https://example.com/docs",
      finalUrl: "https://example.com/docs",
      claim: "The service has a free tier.",
      fetchedAt: "2026-09-18T10:00:00.000Z",
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
    });

    const result = await verifyOriginAnswerSources(
      [cited, unbound],
      executor,
      Date.parse("2026-09-18T10:05:00.000Z"),
    );

    expect(result).toMatchObject({
      attempted: 1,
      verified: 1,
      failed: 0,
    });
    expect(result.evidence[0]).toEqual(expect.objectContaining({
      evidenceLevel: "source-checked",
      checks: expect.objectContaining({
        content: "passed",
        freshness: "passed",
        claimSupport: "passed",
      }),
    }));
    expect(result.evidence[1]).toEqual(unbound);
  });

  it("keeps failed citations explicitly unverified", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("failed"));

    const result = await verifyOriginAnswerSources(
      [cited],
      executor,
      Date.parse("2026-09-18T10:05:00.000Z"),
    );

    expect(result).toMatchObject({
      attempted: 1,
      verified: 0,
      failed: 1,
    });
    expect(result.evidence[0]).toEqual(cited);
  });

  it("does not call the verifier for unbound evidence", async () => {
    const executor = vi.fn();

    const result = await verifyOriginAnswerSources(
      [unbound],
      executor,
      Date.parse("2026-09-18T10:05:00.000Z"),
    );

    expect(result).toMatchObject({
      attempted: 0,
      verified: 0,
      failed: 0,
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it("fails closed when no source-verification executor is connected", async () => {
    const result = await verifyOriginAnswerSources(
      [cited],
      undefined,
      Date.parse("2026-09-18T10:05:00.000Z"),
    );

    expect(result).toMatchObject({
      attempted: 1,
      verified: 0,
      failed: 1,
    });
    expect(result.evidence[0].evidenceLevel).toBe("provided");
  });
});
