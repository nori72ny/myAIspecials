import { describe, expect, it } from "vitest";

import type { OriginResearchSource } from "../legacy/originResearchSource";
import { projectResearchSourcesToAnswerEvidence } from "./OriginResearchEvidenceAdapter";

const source: OriginResearchSource = {
  title: "Official documentation",
  url: "https://example.com/docs",
  excerpt: "Verified page content.",
  sourceType: "web-search",
  domain: "example.com",
  rank: 1,
  evidenceLevel: "page-verified",
  retrievedAt: "2026-09-18T10:00:00.000Z",
  freshness: "recent",
};

describe("OriginResearchEvidenceAdapter", () => {
  it("never promotes retrieval/page verification to claim verification", () => {
    const result = projectResearchSourcesToAnswerEvidence([source]);

    expect(result).toEqual([
      {
        label: "Official documentation",
        sourceUrl: "https://example.com/docs",
        evidenceLevel: "provided",
        checks: {
          safeUrl: "passed",
          content: "not-run",
          freshness: "not-run",
          claimSupport: "not-run",
        },
      },
    ]);
  });

  it("keeps snippets and page-verified sources equivalent until claim verification runs", () => {
    const result = projectResearchSourcesToAnswerEvidence([
      source,
      {
        ...source,
        title: "Search result",
        url: "https://example.org/result",
        evidenceLevel: "snippet",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.evidenceLevel === "provided")).toBe(true);
    expect(result.every((item) => item.checks.claimSupport === "not-run")).toBe(true);
  });

  it("drops unsafe URLs and bounds evidence count", () => {
    const result = projectResearchSourcesToAnswerEvidence([
      { ...source, url: "http://example.com/unsafe" },
      ...Array.from({ length: 10 }, (_, index) => ({
        ...source,
        title: `Source ${index + 1}`,
        url: `https://example.com/source-${index + 1}`,
      })),
    ]);

    expect(result.length).toBeLessThanOrEqual(8);
    expect(result.every((item) => item.sourceUrl?.startsWith("https://"))).toBe(true);
  });
});
