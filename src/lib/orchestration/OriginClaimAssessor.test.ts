import { describe, expect, it, vi } from "vitest";

import type { OriginFetchedPublicSource } from "./OriginPublicSourceFetch";
import { assessOriginClaimAgainstSource } from "./OriginClaimAssessor";

const source: OriginFetchedPublicSource = {
  finalUrl: "https://example.com/docs",
  fetchedAt: "2026-09-18T10:00:00.000Z",
  httpStatus: 200,
  contentType: "text/plain",
  contentDigest: `sha256:${"a".repeat(64)}`,
  body: "The service includes a free tier for eligible users.",
  pinnedAddress: { address: "93.184.216.34", family: 4 },
  networkPolicy: {
    publicAddressOnly: true,
    redirectsFollowed: false,
    dnsPinned: true,
  },
};

describe("OriginClaimAssessor", () => {
  it("accepts only a zero-cost, matching, source-contained support record", async () => {
    const assess = vi.fn().mockResolvedValue({
      claim: "The service has a free tier.",
      sourceUrl: source.finalUrl,
      sourceDigest: source.contentDigest,
      support: "supported",
      supportingExcerpt: "includes a free tier",
      actualCostUsd: 0,
      attempts: 1,
    });

    const result = await assessOriginClaimAgainstSource("The service has a free tier.", source, assess);
    expect(result.ok).toBe(true);
    expect(assess).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the assessor is unavailable or throws", async () => {
    await expect(assessOriginClaimAgainstSource("The service has a free tier.", source))
      .resolves.toEqual({ ok: false, code: "CLAIM_ASSESSOR_NOT_AVAILABLE" });

    await expect(assessOriginClaimAgainstSource(
      "The service has a free tier.",
      source,
      vi.fn().mockRejectedValue(new Error("failed")),
    )).resolves.toEqual({ ok: false, code: "CLAIM_ASSESSMENT_FAILED" });
  });

  it("rejects unsupported or conflicting assessments", async () => {
    for (const support of ["not-supported", "conflicting"] as const) {
      const assess = vi.fn().mockResolvedValue({
        claim: "The service has a free tier.",
        sourceUrl: source.finalUrl,
        sourceDigest: source.contentDigest,
        support,
        actualCostUsd: 0,
        attempts: 1,
      });
      await expect(assessOriginClaimAgainstSource("The service has a free tier.", source, assess))
        .resolves.toEqual({ ok: false, code: "CLAIM_NOT_SUPPORTED" });
    }
  });

  it("rejects paid, mismatched or fabricated excerpt records", async () => {
    const base = {
      claim: "The service has a free tier.",
      sourceUrl: source.finalUrl,
      sourceDigest: source.contentDigest,
      support: "supported" as const,
      supportingExcerpt: "includes a free tier",
      actualCostUsd: 0,
      attempts: 1 as const,
    };

    await expect(assessOriginClaimAgainstSource(
      base.claim,
      source,
      vi.fn().mockResolvedValue({ ...base, actualCostUsd: 0.01 }),
    )).resolves.toEqual({ ok: false, code: "CLAIM_ASSESSMENT_COST_UNVERIFIED" });

    await expect(assessOriginClaimAgainstSource(
      base.claim,
      source,
      vi.fn().mockResolvedValue({ ...base, sourceDigest: `sha256:${"b".repeat(64)}` }),
    )).resolves.toEqual({ ok: false, code: "CLAIM_ASSESSMENT_RECORD_MISMATCH" });

    await expect(assessOriginClaimAgainstSource(
      base.claim,
      source,
      vi.fn().mockResolvedValue({ ...base, supportingExcerpt: "not present in source" }),
    )).resolves.toEqual({ ok: false, code: "CLAIM_ASSESSMENT_RECORD_MISMATCH" });
  });

  it("rejects secret-bearing claims before external assessment", async () => {
    const assess = vi.fn();
    const result = await assessOriginClaimAgainstSource(
      "Authorization: Bearer synthetic_secret_token_123456",
      source,
      assess,
    );
    expect(result).toEqual({ ok: false, code: "INVALID_CLAIM_ASSESSMENT_REQUEST" });
    expect(assess).not.toHaveBeenCalled();
  });
});
