import { describe, expect, it } from "vitest";
import type { OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  adoptGroundedResearchSynthesis,
  executeGroundedResearchSynthesisWithRetry,
  scrubGroundedResearchSynthesisRedactionRemnants,
  validateGroundedResearchSynthesis,
} from "./groundedResearchSynthesisV12";

// Regression tests for the 2026-11-17 re-measurement defect A-02: the
// pre-egress sanitizer masked a token inside the evidence packet as
// "[[REDACTED_SECRET])" (bracket punctuation preserved), the synthesis
// model copied the fragment into its answer next to real citations,
// and the adoption gate — which validates citations, URLs, coverage,
// and numeric support but had no rule against the marker — shipped
// the broken text to the user three times in one answer.
const sources: OriginResearchSource[] = [
  {
    title: "退職の申し出時期（出典1）",
    url: "https://example.com/resignation-law",
    excerpt: "民法第627条により、雇用は解約の申入れの日から二週間を経過することによって終了します。",
    sourceType: "web-search",
    domain: "example.com",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-17T00:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "official-domain-match",
  },
  {
    title: "退職の申し出時期（出典2）",
    url: "https://example.org/resignation-guide",
    excerpt: "多くの企業の就業規則では退職の申し出時期を1〜3ヶ月前と定めていますが、法律上は2週間前で十分です。",
    sourceType: "web-search",
    domain: "example.org",
    rank: 2,
    evidenceLevel: "snippet",
    retrievedAt: "2026-11-17T00:00:00.000Z",
    freshness: "unknown",
    sourceAuthority: "secondary-reference",
  },
];

// The A-02 shape, reduced: every remnant sits at the end of a complete
// sentence, immediately before the citation token — the sentence is
// verifiably intact without the debris.
const a02ShapedText = [
  "## 結論",
  "法律上、退職の意思は退職希望日の2週間前までに申し出れば問題ありません。[[REDACTED_SECRET]) [S1](https://example.com/resignation-law) [S2](https://example.org/resignation-guide)",
  "",
  "## 根拠",
  "民法第627条により、雇用は解約の申入れの日から二週間を経過することによって終了します。[[REDACTED_SECRET]) [S1](https://example.com/resignation-law)",
  "多くの企業の就業規則では退職の申し出時期を1〜3ヶ月前と定めていますが、法律上は2週間前で十分です。[[REDACTED_SECRET]) [S2](https://example.org/resignation-guide)",
  "",
  "## 出典",
  "example.com・公開日不明 [S1](https://example.com/resignation-law)",
  "example.org・公開日不明 [S2](https://example.org/resignation-guide)",
].join("\n");

describe("redaction-remnant scrub (2026-11-17 measurement, defect A-02)", () => {
  it("removes citation-adjacent remnants and adopts the intact text (A-02 shape)", () => {
    // The gate alone would have shipped the remnants: they are neither
    // citation tokens nor URLs, so the raw text validates as-is.
    expect(validateGroundedResearchSynthesis(a02ShapedText, sources).ok).toBe(true);

    const adoption = adoptGroundedResearchSynthesis(a02ShapedText, sources);
    expect(adoption.adopted).toBe(true);
    if (adoption.adopted) {
      expect(adoption.text).not.toContain("REDACTED");
      expect(adoption.text).toContain("問題ありません。 [S1](https://example.com/resignation-law)");
      expect(adoption.text).toContain("終了します。 [S1](https://example.com/resignation-law)");
      expect(adoption.salvaged).toBe(false);
      expect(adoption.removedUnits).toBe(0);
      expect(adoption.redactionRemnantsRemoved).toBe(3);
      expect(adoption.redactionUnitsDropped).toBe(0);
    }
  });

  it("drops a unit whose marker tore content out of the middle of a sentence", () => {
    const tornText = [
      "## 結論",
      "民法第627条により、雇用は[REDACTED_SECRET]の日から二週間を経過することによって終了します。[S1](https://example.com/resignation-law) [S2](https://example.org/resignation-guide)",
      "",
      "## 根拠",
      "民法第627条により、雇用は解約の申入れの日から二週間を経過することによって終了します。[S1](https://example.com/resignation-law)",
      "多くの企業の就業規則では退職の申し出時期を1〜3ヶ月前と定めていますが、法律上は2週間前で十分です。[S2](https://example.org/resignation-guide)",
      "",
      "## 出典",
      "example.com・公開日不明 [S1](https://example.com/resignation-law)",
      "example.org・公開日不明 [S2](https://example.org/resignation-guide)",
    ].join("\n");

    const adoption = adoptGroundedResearchSynthesis(tornText, sources);
    expect(adoption.adopted).toBe(true);
    if (adoption.adopted) {
      expect(adoption.text).not.toContain("REDACTED");
      // The torn sentence is gone as a whole unit, and the heading its
      // removal emptied went with it — no broken sentence is delivered.
      expect(adoption.text).not.toContain("雇用はの日から");
      expect(adoption.text).not.toContain("## 結論");
      expect(adoption.salvaged).toBe(true);
      expect(adoption.removedUnits).toBe(1);
      expect(adoption.redactionRemnantsRemoved).toBe(1);
      expect(adoption.redactionUnitsDropped).toBe(1);
    }
  });

  it("drops a unit that is only a remnant plus a citation (no claim left)", () => {
    const shellText = [
      "## 結論",
      "法律上、退職の意思は退職希望日の2週間前までに申し出れば問題ありません。[S1](https://example.com/resignation-law) [S2](https://example.org/resignation-guide)",
      "",
      "## 根拠",
      "[[REDACTED_SECRET]) [S1](https://example.com/resignation-law)",
      "民法第627条により、雇用は解約の申入れの日から二週間を経過することによって終了します。[S1](https://example.com/resignation-law)",
      "",
      "## 出典",
      "example.com・公開日不明 [S1](https://example.com/resignation-law)",
      "example.org・公開日不明 [S2](https://example.org/resignation-guide)",
    ].join("\n");

    const adoption = adoptGroundedResearchSynthesis(shellText, sources);
    expect(adoption.adopted).toBe(true);
    if (adoption.adopted) {
      expect(adoption.text).not.toContain("REDACTED");
      expect(adoption.redactionUnitsDropped).toBe(1);
      expect(adoption.salvaged).toBe(true);
    }
  });

  it("does not weaken the gate: a scrubbed text that still fails coverage is not adopted", () => {
    const oneSourceOnly = a02ShapedText.replaceAll("[S2](https://example.org/resignation-guide)", "");
    const adoption = adoptGroundedResearchSynthesis(oneSourceOnly, sources);
    expect(adoption.adopted).toBe(false);
    if (adoption.adopted === false) {
      expect(adoption.failureCode).toBe("INSUFFICIENT_SOURCE_COVERAGE");
      expect(adoption.redactionRemnantsRemoved).toBe(3);
    }
  });

  it("leaves marker-free text byte-identical and reports no scrub fields", () => {
    const cleanText = a02ShapedText.replaceAll("[[REDACTED_SECRET]) ", "");
    const scrub = scrubGroundedResearchSynthesisRedactionRemnants(cleanText);
    expect(scrub.text).toBe(cleanText);
    expect(scrub.markersRemoved).toBe(0);
    expect(scrub.unitsDropped).toBe(0);

    const adoption = adoptGroundedResearchSynthesis(cleanText, sources);
    expect(adoption.adopted).toBe(true);
    if (adoption.adopted) {
      expect(adoption.text).toBe(cleanText);
      expect(adoption.redactionRemnantsRemoved).toBeUndefined();
      expect(adoption.redactionUnitsDropped).toBeUndefined();
    }
  });

  it("scrubs the parenthesised and plain marker variants as well", () => {
    const scrub = scrubGroundedResearchSynthesisRedactionRemnants(
      "値は([REDACTED_SECRET])ではなく確定です。[S1](https://example.com/resignation-law)\n根拠は末尾の出典です。[REDACTED] [S1](https://example.com/resignation-law)",
    );
    // First line: the marker sat mid-sentence (followed by ではなく),
    // so the whole unit is dropped rather than delivering a sentence
    // with a hole in it. Second line: the plain [REDACTED] variant at
    // a citation-adjacent site is removed and the line survives.
    expect(scrub.unitsDropped).toBe(1);
    expect(scrub.markersRemoved).toBe(2);
    expect(scrub.text).not.toContain("REDACTED");
    expect(scrub.text).toContain("根拠は末尾の出典です。 [S1](https://example.com/resignation-law)");
  });

  it("covers the retry path: a remnant-bearing initial result is adopted without a retry", async () => {
    const initialAdoption = adoptGroundedResearchSynthesis(a02ShapedText, sources);
    expect(initialAdoption.adopted).toBe(true);
    const initialResult: OriginProviderExecutionResult = {
      text: a02ShapedText,
      transportRequestCount: 1,
      actualCostUsd: 0,
      providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
      routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
    };
    const initialRequest: OriginProviderExecutionRequest = {
      plan: { providerLabel: "ORIGIN 無料AI", modelId: "google/gemma-4-31b-it:free" } as unknown as OriginExecutionPlan,
      messages: [{ role: "user", content: "prompt" }],
      systemInstruction: "instruction",
    };
    const outcome = await executeGroundedResearchSynthesisWithRetry(
      async () => {
        throw new Error("the retry executor must not be called");
      },
      {
        initialRequest,
        initialResult,
        initialAdoption,
        sources,
        language: "ja",
        elapsedMs: 0,
        enabled: true,
        assertZeroCost: () => undefined,
      },
    );
    expect(outcome.retried).toBe(false);
    expect(outcome.adoption.adopted).toBe(true);
    if (outcome.adoption.adopted) {
      expect(outcome.adoption.text).not.toContain("REDACTED");
    }
  });
});
