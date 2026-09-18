import { describe, expect, it, vi } from "vitest";

import type { OriginFetchedPublicSource } from "./OriginPublicSourceFetch";
import { assessOriginClaimsAgainstSourcesBatch } from "./OriginBatchClaimAssessor";

const source = (
  url: string,
  digestChar: string,
  body: string,
): OriginFetchedPublicSource => ({
  finalUrl: url,
  fetchedAt: "2026-09-18T12:00:00.000Z",
  httpStatus: 200,
  contentType: "text/plain",
  contentDigest: `sha256:${digestChar.repeat(64)}`,
  body,
  pinnedAddress: { address: "93.184.216.34", family: 4 },
  networkPolicy: {
    publicAddressOnly: true,
    redirectsFollowed: false,
    dnsPinned: true,
  },
});

describe("OriginBatchClaimAssessor", () => {
  it("verifies multiple claims in one zero-cost assessor execution", async () => {
    const items = [
      {
        id: "claim-1",
        claim: "The service has a free tier.",
        source: source(
          "https://example.com/free",
          "a",
          "The service includes a free tier for eligible users.",
        ),
      },
      {
        id: "claim-2",
        claim: "The current version is 2.0.",
        source: source(
          "https://example.com/version",
          "b",
          "The current version is 2.0.",
        ),
      },
    ];

    const assessor = vi.fn(async (request) => ({
      items: request.items.map((item) => ({
        id: item.id,
        claim: item.claim,
        sourceUrl: item.sourceUrl,
        sourceDigest: item.sourceDigest,
        support: "supported",
        supportingExcerpt: item.id === "claim-1"
          ? "includes a free tier"
          : "current version is 2.0",
      })),
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await assessOriginClaimsAgainstSourcesBatch(items, assessor);

    expect(result.ok).toBe(true);
    expect(assessor).toHaveBeenCalledTimes(1);
  });

  it("fails closed when any item is unsupported or conflicting", async () => {
    const items = [{
      id: "claim-1",
      claim: "The service has a free tier.",
      source: source(
        "https://example.com/free",
        "a",
        "This page says nothing about pricing.",
      ),
    }];

    const assessor = vi.fn(async (request) => ({
      items: request.items.map((item) => ({
        id: item.id,
        claim: item.claim,
        sourceUrl: item.sourceUrl,
        sourceDigest: item.sourceDigest,
        support: "not-supported",
      })),
      actualCostUsd: 0,
      attempts: 1,
    }));

    await expect(assessOriginClaimsAgainstSourcesBatch(items, assessor))
      .resolves.toEqual({ ok: false, code: "BATCH_CLAIM_NOT_SUPPORTED" });
  });

  it("rejects output re-binding and fabricated excerpts", async () => {
    const items = [{
      id: "claim-1",
      claim: "The service has a free tier.",
      source: source(
        "https://example.com/free",
        "a",
        "The service includes a free tier.",
      ),
    }];

    const mismatched = vi.fn(async (request) => ({
      items: [{
        id: request.items[0].id,
        claim: request.items[0].claim,
        sourceUrl: "https://example.com/other",
        sourceDigest: request.items[0].sourceDigest,
        support: "supported",
        supportingExcerpt: "includes a free tier",
      }],
      actualCostUsd: 0,
      attempts: 1,
    }));

    await expect(assessOriginClaimsAgainstSourcesBatch(items, mismatched))
      .resolves.toEqual({
        ok: false,
        code: "BATCH_CLAIM_ASSESSMENT_RECORD_MISMATCH",
      });

    const fabricated = vi.fn(async (request) => ({
      items: [{
        id: request.items[0].id,
        claim: request.items[0].claim,
        sourceUrl: request.items[0].sourceUrl,
        sourceDigest: request.items[0].sourceDigest,
        support: "supported",
        supportingExcerpt: "not in source",
      }],
      actualCostUsd: 0,
      attempts: 1,
    }));

    await expect(assessOriginClaimsAgainstSourcesBatch(items, fabricated))
      .resolves.toEqual({
        ok: false,
        code: "BATCH_CLAIM_ASSESSMENT_RECORD_MISMATCH",
      });
  });

  it("rejects duplicate output IDs that omit another requested claim", async () => {
    const items = [
      {
        id: "claim-1",
        claim: "Fact A.",
        source: source("https://example.com/a", "a", "Fact A."),
      },
      {
        id: "claim-2",
        claim: "Fact B.",
        source: source("https://example.com/b", "b", "Fact B."),
      },
    ];

    const duplicate = vi.fn(async (request) => ({
      items: [
        {
          id: request.items[0].id,
          claim: request.items[0].claim,
          sourceUrl: request.items[0].sourceUrl,
          sourceDigest: request.items[0].sourceDigest,
          support: "supported",
          supportingExcerpt: "Fact A.",
        },
        {
          id: request.items[0].id,
          claim: request.items[0].claim,
          sourceUrl: request.items[0].sourceUrl,
          sourceDigest: request.items[0].sourceDigest,
          support: "supported",
          supportingExcerpt: "Fact A.",
        },
      ],
      actualCostUsd: 0,
      attempts: 1,
    }));

    await expect(assessOriginClaimsAgainstSourcesBatch(items, duplicate))
      .resolves.toEqual({
        ok: false,
        code: "BATCH_CLAIM_ASSESSMENT_RECORD_MISMATCH",
      });
  });

  it("rejects secret-bearing claims, duplicates, more than eight items and paid output", async () => {
    const safe = {
      id: "claim-1",
      claim: "A safe claim.",
      source: source("https://example.com/a", "a", "A safe claim."),
    };

    const assessor = vi.fn();

    await expect(assessOriginClaimsAgainstSourcesBatch(
      [{ ...safe, claim: "Authorization: Bearer synthetic_secret_token_123456" }],
      assessor,
    )).resolves.toEqual({
      ok: false,
      code: "INVALID_BATCH_CLAIM_ASSESSMENT_REQUEST",
    });

    await expect(assessOriginClaimsAgainstSourcesBatch(
      [safe, { ...safe }],
      assessor,
    )).resolves.toEqual({
      ok: false,
      code: "INVALID_BATCH_CLAIM_ASSESSMENT_REQUEST",
    });

    await expect(assessOriginClaimsAgainstSourcesBatch(
      Array.from({ length: 9 }, (_, index) => ({
        ...safe,
        id: `claim-${index + 1}`,
      })),
      assessor,
    )).resolves.toEqual({
      ok: false,
      code: "INVALID_BATCH_CLAIM_ASSESSMENT_REQUEST",
    });

    const paid = vi.fn(async (request) => ({
      items: request.items.map((item) => ({
        id: item.id,
        claim: item.claim,
        sourceUrl: item.sourceUrl,
        sourceDigest: item.sourceDigest,
        support: "supported",
        supportingExcerpt: "safe claim",
      })),
      actualCostUsd: 0.01,
      attempts: 1,
    }));

    await expect(assessOriginClaimsAgainstSourcesBatch([safe], paid))
      .resolves.toEqual({
        ok: false,
        code: "BATCH_CLAIM_ASSESSMENT_COST_UNVERIFIED",
      });
  });
});
