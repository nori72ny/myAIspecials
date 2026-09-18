import { describe, expect, it, vi } from "vitest";

import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import { verifyOriginAnswerSourcesBatch } from "./OriginBatchAnswerSourceVerification";

const citation = (
  label: string,
  claim: string,
  sourceUrl: string,
): OriginAnswerEvidenceItem => ({
  label,
  claim,
  sourceUrl,
  claimBinding: "explicit-inline-citation",
  evidenceLevel: "provided",
  checks: {
    safeUrl: "passed",
    content: "not-run",
    freshness: "not-run",
    claimSupport: "not-run",
  },
});

describe("OriginBatchAnswerSourceVerification", () => {
  it("fetches multiple public sources and verifies them in one assessor execution", async () => {
    const evidence = [
      citation("Source A", "Fact A.", "https://a.example.com/doc"),
      citation("Source B", "Fact B.", "https://b.example.com/doc"),
    ];

    const bodies = new Map([
      ["https://a.example.com/doc", "Fact A."],
      ["https://b.example.com/doc", "Fact B."],
    ]);

    const assessor = vi.fn(async (request) => ({
      items: request.items.map((item) => ({
        id: item.id,
        claim: item.claim,
        sourceUrl: item.sourceUrl,
        sourceDigest: item.sourceDigest,
        support: "supported",
        supportingExcerpt: item.claim,
      })),
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await verifyOriginAnswerSourcesBatch(evidence, {
      assessor,
      resolver: vi.fn(async (hostname) => [{
        address: hostname.startsWith("a.") ? "93.184.216.34" : "93.184.216.35",
        family: 4 as const,
      }]),
      transport: vi.fn(async (url) => {
        const body = Buffer.from(bodies.get(url) ?? "");
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body,
        };
      }),
      now: () => Date.parse("2026-09-18T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      attempted: 2,
      fetched: 2,
      verified: 2,
      failed: 0,
      assessorExecutions: 1,
    });
    expect(assessor).toHaveBeenCalledTimes(1);
    expect(result.evidence.every((item) =>
      item.evidenceLevel === "source-checked"
      && item.checks.freshness === "not-applicable"
    )).toBe(true);
  });

  it("keeps fetch failures unverified while still verifying fetched sources", async () => {
    const evidence = [
      citation("Source A", "Fact A.", "https://a.example.com/doc"),
      citation("Source B", "Fact B.", "https://b.example.com/doc"),
    ];

    const assessor = vi.fn(async (request) => ({
      items: request.items.map((item) => ({
        id: item.id,
        claim: item.claim,
        sourceUrl: item.sourceUrl,
        sourceDigest: item.sourceDigest,
        support: "supported",
        supportingExcerpt: item.claim,
      })),
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await verifyOriginAnswerSourcesBatch(evidence, {
      assessor,
      resolver: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      transport: vi.fn(async (url) => {
        if (url.includes("b.example.com")) {
          throw new Error("synthetic fetch failure");
        }
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: Buffer.from("Fact A."),
        };
      }),
    });

    expect(result).toMatchObject({
      attempted: 2,
      fetched: 1,
      verified: 1,
      failed: 1,
      assessorExecutions: 1,
    });
    expect(result.evidence[0].evidenceLevel).toBe("source-checked");
    expect(result.evidence[1].evidenceLevel).toBe("provided");
  });

  it("promotes nothing when the batch assessor rejects any fetched claim", async () => {
    const evidence = [
      citation("Source A", "Fact A.", "https://a.example.com/doc"),
      citation("Source B", "Fact B.", "https://b.example.com/doc"),
    ];

    const assessor = vi.fn(async (request) => ({
      items: request.items.map((item, index) => ({
        id: item.id,
        claim: item.claim,
        sourceUrl: item.sourceUrl,
        sourceDigest: item.sourceDigest,
        support: index === 0 ? "supported" : "conflicting",
        supportingExcerpt: item.claim,
      })),
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await verifyOriginAnswerSourcesBatch(evidence, {
      assessor,
      resolver: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      transport: vi.fn(async (url) => ({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from(url.includes("a.") ? "Fact A." : "Fact B."),
      })),
    });

    expect(result.verified).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.evidence.every((item) => item.evidenceLevel === "provided")).toBe(true);
  });

  it("does not exceed eight verification candidates", async () => {
    const evidence = Array.from({ length: 10 }, (_, index) =>
      citation(
        `Source ${index + 1}`,
        `Fact ${index + 1}.`,
        `https://example.com/${index + 1}`,
      )
    );

    const assessor = vi.fn(async (request) => ({
      items: request.items.map((item) => ({
        id: item.id,
        claim: item.claim,
        sourceUrl: item.sourceUrl,
        sourceDigest: item.sourceDigest,
        support: "supported",
        supportingExcerpt: item.claim,
      })),
      actualCostUsd: 0,
      attempts: 1,
    }));

    const result = await verifyOriginAnswerSourcesBatch(evidence, {
      assessor,
      resolver: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
      transport: vi.fn(async (url) => {
        const fact = `Fact ${url.split("/").at(-1)}.`;
        return {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: Buffer.from(fact),
        };
      }),
    });

    expect(result.attempted).toBe(8);
    expect(result.verified).toBe(8);
    expect(result.evidence[8].evidenceLevel).toBe("provided");
    expect(result.evidence[9].evidenceLevel).toBe("provided");
    expect(assessor).toHaveBeenCalledTimes(1);
  });
});
