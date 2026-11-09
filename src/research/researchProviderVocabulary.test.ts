import { describe, expect, it } from "vitest";
import {
  originSearchGroundingToResearchResult,
  type OriginSearchGroundingOutcome,
} from "../search/originSearchGrounding.js";
import type { OriginSearchProviderId } from "../search/originSearchProviderCatalog.js";
import {
  isResearchProviderName,
  RESEARCH_PROVIDER_NAMES,
} from "./researchProviderVocabulary.js";

type GroundedOutcome = Extract<OriginSearchGroundingOutcome, { kind: "grounded" }>;

function groundedOutcome(providersUsed: OriginSearchProviderId[]): GroundedOutcome {
  return {
    kind: "grounded",
    questionType: "stable",
    sources: [{
      title: "Example evidence",
      url: "https://example.com/evidence",
      excerpt: "evidence excerpt",
      providerId: providersUsed[0],
      domain: "example.com",
      authorityTier: "general",
      evidenceLevel: "snippet",
      dateVerified: false,
    }],
    providersUsed,
    retrievedAt: "2026-11-09T00:00:00.000Z",
    freshness: {
      verifiedFreshCount: 0,
      unknownDateCount: 1,
      droppedStaleCount: 0,
      droppedUndatedCount: 0,
    },
    freshnessVerified: false,
  };
}

describe("research provider vocabulary", () => {
  it("pins the exact provider set the research API may return", () => {
    expect([...RESEARCH_PROVIDER_NAMES]).toEqual([
      "DuckDuckGo",
      "Bing",
      "Wikipedia",
      "Tavily",
      "GDELT",
      "Open-Meteo",
      "Stooq",
      "SearchGrounding",
    ]);
  });

  it.each([
    ["tavily", "Tavily"],
    ["gdelt", "GDELT"],
    ["wikipedia", "Wikipedia"],
    ["open-meteo", "Open-Meteo"],
    ["stooq", "Stooq"],
  ] as const)("accepts the label the grounding adapter emits for %s", (providerId, label) => {
    const result = originSearchGroundingToResearchResult(groundedOutcome([providerId]));
    expect(result.searchProvider).toBe(label);
    expect(isResearchProviderName(result.searchProvider)).toBe(true);
  });

  it("accepts the composite label emitted when several providers are used", () => {
    const result = originSearchGroundingToResearchResult(groundedOutcome(["tavily", "gdelt"]));
    expect(result.searchProvider).toBe("SearchGrounding");
    expect(isResearchProviderName(result.searchProvider)).toBe(true);
  });

  it("rejects provider names outside the vocabulary (fail-closed)", () => {
    expect(isResearchProviderName("OpenAI")).toBe(false);
    expect(isResearchProviderName("Bing-Clone")).toBe(false);
    expect(isResearchProviderName("")).toBe(false);
    expect(isResearchProviderName(undefined)).toBe(false);
    expect(isResearchProviderName(null)).toBe(false);
    expect(isResearchProviderName(42)).toBe(false);
  });
});
