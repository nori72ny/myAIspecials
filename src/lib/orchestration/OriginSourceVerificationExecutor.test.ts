import { describe, expect, it, vi } from "vitest";

import { createOriginSourceVerificationExecutor } from "./OriginSourceVerificationExecutor";
import type { OriginSourceVerificationRecord } from "./OriginSourceVerification";

describe("OriginSourceVerificationExecutor", () => {
  it("combines pinned public fetch and claim support assessment into a verification record", async () => {
    const assessor = vi.fn().mockResolvedValue({
      claim: "The service has a free tier.",
      sourceUrl: "https://example.com/docs",
      sourceDigest: `sha256:${"a".repeat(64)}`,
      support: "supported",
      supportingExcerpt: "free tier",
      actualCostUsd: 0,
      attempts: 1,
    });

    const executor = createOriginSourceVerificationExecutor({
      assessor,
      resolver: vi.fn().mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
      ]),
      transport: vi.fn().mockResolvedValue({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("This service includes a free tier for eligible users."),
      }),
      now: () => Date.parse("2026-09-18T10:30:00.000Z"),
      freshness: "passed",
    });

    const result = await executor({
      verificationId: "verify-1",
      claim: "The service has a free tier.",
      sourceUrl: "https://example.com/docs",
      executionPolicy: {
        maxCostUsd: 0,
        maxAttempts: 1,
        allowRedirects: false,
        publicNetworkOnly: true,
      },
    });

    const record = result as OriginSourceVerificationRecord;
    expect(record).toMatchObject({
      verificationId: "verify-1",
      sourceUrl: "https://example.com/docs",
      finalUrl: "https://example.com/docs",
      claim: "The service has a free tier.",
      externalFetchPerformed: true,
      actualCostUsd: 0,
      checks: {
        content: "passed",
        freshness: "passed",
        claimSupport: "passed",
      },
    });
    expect(record.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(assessor).toHaveBeenCalledTimes(1);
  });

  it("fails closed before assessment when public fetch fails", async () => {
    const assessor = vi.fn();
    const executor = createOriginSourceVerificationExecutor({
      assessor,
      resolver: vi.fn().mockResolvedValue([
        { address: "127.0.0.1", family: 4 },
      ]),
    });

    await expect(executor({
      verificationId: "verify-2",
      claim: "A claim.",
      sourceUrl: "https://example.com/docs",
      executionPolicy: {
        maxCostUsd: 0,
        maxAttempts: 1,
        allowRedirects: false,
        publicNetworkOnly: true,
      },
    })).rejects.toThrow("PUBLIC_SOURCE_NETWORK_REJECTED");
    expect(assessor).not.toHaveBeenCalled();
  });

  it("fails closed when the fetched source does not support the claim", async () => {
    const assessor = vi.fn().mockResolvedValue({
      claim: "The service has a free tier.",
      sourceUrl: "https://example.com/docs",
      sourceDigest: `sha256:${"a".repeat(64)}`,
      support: "not-supported",
      actualCostUsd: 0,
      attempts: 1,
    });

    const executor = createOriginSourceVerificationExecutor({
      assessor,
      resolver: vi.fn().mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
      ]),
      transport: vi.fn().mockResolvedValue({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("This page says nothing about pricing."),
      }),
    });

    await expect(executor({
      verificationId: "verify-3",
      claim: "The service has a free tier.",
      sourceUrl: "https://example.com/docs",
      executionPolicy: {
        maxCostUsd: 0,
        maxAttempts: 1,
        allowRedirects: false,
        publicNetworkOnly: true,
      },
    })).rejects.toThrow("CLAIM_NOT_SUPPORTED");
  });
});
