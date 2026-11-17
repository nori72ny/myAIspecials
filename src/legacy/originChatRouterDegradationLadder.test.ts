import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import {
  buildGroundedResearchAbstainAnswer,
  ensureGroundedResearchTerminalBody,
  hasSubstantiveResearchUnit,
  researchAbstainReasonForResearchResult,
  researchLandingForAbstain,
  researchLandingForAdopted,
  researchLandingForPartialAnswer,
  type OriginResearchAbstainReason,
} from "../research/groundedResearchOutcome";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import type { OriginResearchSource } from "./originResearchSource";

// N-1 degradation ladder (CONSULT_ADOPTION_DESIGN_2026-11-17 §1): the
// ladder T0 -> T3 -> T4 is formalized, every research landing carries
// the three-valued outcome (ANSWERED / PARTIAL / ABSTAIN) in routing
// metadata, the tier-T4 hold text states the concrete reason instead of
// the former fixed template, and the final assembly structurally
// cannot emit an empty or shell-only body (failure type T-8 / F-12).
// Tier T1 is reserved (its firing conditions wait on the R-0 route
// attribution) and tier T2 is an attempt inside T0, never a landing.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const executionResult = {
  text: "安全な確認結果です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

const ladderSources: OriginResearchSource[] = [
  {
    title: "内閣総理大臣 高市 早苗 - 首相官邸ホームページ",
    url: "https://www.kantei.go.jp/jp/104/actions/index.html",
    excerpt: "抜粋マーカー1 ナビゲーション ホーム 政策 広告バナー",
    sourceType: "web-search",
    domain: "kantei.go.jp",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "高市総理大臣 記者会見の概要",
    url: "https://www.nhk.or.jp/politics/articles/1.html",
    excerpt: "抜粋マーカー2 サイドバー おすすめ記事 フッター案内",
    sourceType: "web-search",
    domain: "nhk.or.jp",
    rank: 2,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
];

function createChatApp(research: OriginResearchExecutor, researchSynthesis: OriginChatExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor,
    research,
    researchSynthesis,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-degradation-ladder",
  }));
  return app;
}

describe("N-1 ladder: tier T0 adoption reports ANSWERED", () => {
  it("marks a citation-validated synthesis as T0 / ANSWERED with no abstain reason", async () => {
    const research = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "Tavily",
      sources: ladderSources,
    }) as unknown as OriginResearchExecutor;
    const citedText = "内閣総理大臣は高市早苗氏です [S1](https://www.kantei.go.jp/jp/104/actions/index.html)\n記者会見も行われました [S2](https://www.nhk.or.jp/politics/articles/1.html)";
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: citedText }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(research, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.researchTier).toBe("T0");
    expect(response.body.routing.researchOutcome).toBe("ANSWERED");
    expect(response.body.routing.researchAbstainReason).toBeUndefined();
    expect(response.body.content).toBe(citedText);
  });
});

describe("N-1 ladder: tier T4 abstain reasons reach routing and body", () => {
  it("lands monthly-cap-reached as ABSTAIN with the cap named in the body", async () => {
    const research = vi.fn().mockResolvedValue({
      ok: false,
      sources: [],
      groundingFailure: "monthly-cap-reached",
    }) as unknown as OriginResearchExecutor;
    const synthesis = vi.fn() as unknown as OriginChatExecutor;
    const response = await request(createChatApp(research, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain("今月の検索利用の上限に達しているため、今回は検索を実行できませんでした");
    expect(response.body.routing.researchTier).toBe("T4");
    expect(response.body.routing.researchOutcome).toBe("ABSTAIN");
    expect(response.body.routing.researchAbstainReason).toBe("monthly-cap-reached");
    expect(synthesis).not.toHaveBeenCalled();
  });

  it("produces the English hold text with the concrete reason for an English query", async () => {
    const research = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "Tavily",
      sources: [],
      groundingFailure: "no-sources",
    }) as unknown as OriginResearchExecutor;
    const synthesis = vi.fn() as unknown as OriginChatExecutor;
    const response = await request(createChatApp(research, synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "Tell me the latest news about Japan today" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(buildGroundedResearchAbstainAnswer({
      query: "Tell me the latest news about Japan today",
      language: "en",
      reason: "no-sources",
    }));
    expect(response.body.content).toContain("I searched for relevant public sources, but none met the conditions");
    expect(response.body.routing.researchOutcome).toBe("ABSTAIN");
    expect(response.body.routing.researchAbstainReason).toBe("no-sources");
  });
});

describe("N-1 tier-T4 hold text builder", () => {
  const reasons: Array<[OriginResearchAbstainReason, string]> = [
    ["no-sources", "条件に合う出典が見つからず"],
    ["no-fresh-sources", "古い情報を現在の情報として示すことはしませんでした"],
    ["provider-error", "情報源を取得する処理で問題が発生し"],
    ["monthly-cap-reached", "今月の検索利用の上限に達しているため"],
    ["budget-exhausted", "制限時間内に裏付けの確認を終えることができませんでした"],
    ["high-risk-insufficient-sources", "複数の独立した出典による裏付けが必要ですが"],
  ];

  it.each(reasons)("reason %s produces a concrete, non-template hold text", (reason, phrase) => {
    const text = buildGroundedResearchAbstainAnswer({ query: "最新の物価を教えてください", language: "ja", reason });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("最新の物価を教えてください");
    expect(text).toContain("推測で回答しません");
    expect(text).toContain(phrase);
    // The former fixed template is gone, and no internal vocabulary
    // (reason codes, tier labels, route or error names) leaks into the
    // user-facing text.
    expect(text).not.toContain("信頼できる裏付けが取れませんでした");
    expect(text).not.toContain(reason);
    expect(text).not.toContain("ABSTAIN");
    expect(text).not.toContain("T4");
    expect(text).not.toMatch(/PROVIDER|grounding|tier/i);
  });

  it("omits the topic clause when the query is empty (terminal-guard form)", () => {
    const text = buildGroundedResearchAbstainAnswer({ query: "", language: "ja", reason: "provider-error" });
    expect(text.startsWith("公開情報を調べましたが")).toBe(true);
    expect(text).toContain("出典を確認できませんでした");
  });
});

describe("N-1 abstain reason mapping and landing helpers", () => {
  it("prefers the grounding failure vocabulary, then executor failure, then no-sources", () => {
    expect(researchAbstainReasonForResearchResult({ groundingFailure: "no-fresh-sources" })).toBe("no-fresh-sources");
    expect(researchAbstainReasonForResearchResult({ groundingFailure: "monthly-cap-reached" })).toBe("monthly-cap-reached");
    expect(researchAbstainReasonForResearchResult({ failure: { stage: "web-search", code: "NETWORK_FAILURE" } })).toBe("provider-error");
    expect(researchAbstainReasonForResearchResult({})).toBe("no-sources");
  });

  it("fixes the landing of each tier", () => {
    expect(researchLandingForAdopted(false)).toEqual({ tier: "T0", outcome: "ANSWERED" });
    expect(researchLandingForAdopted(true)).toEqual({ tier: "T0", outcome: "PARTIAL" });
    expect(researchLandingForPartialAnswer()).toEqual({ tier: "T3", outcome: "PARTIAL" });
    expect(researchLandingForAbstain("no-sources")).toEqual({ tier: "T4", outcome: "ABSTAIN", abstainReason: "no-sources" });
  });
});

describe("N-1 terminal guarantee: no empty or shell-only body leaves final assembly", () => {
  it("detects substantive units and rejects citation shells", () => {
    expect(hasSubstantiveResearchUnit("")).toBe(false);
    expect(hasSubstantiveResearchUnit("  \n\n  ")).toBe(false);
    expect(hasSubstantiveResearchUnit("[S1](https://example.com/one)")).toBe(false);
    expect(hasSubstantiveResearchUnit("## 出典\n- https://example.com/one")).toBe(false);
    expect(hasSubstantiveResearchUnit("確認できた範囲をお伝えします。")).toBe(true);
    expect(hasSubstantiveResearchUnit("- S1（example.com）では『タイトル』と示されています。")).toBe(true);
  });

  it("passes a substantive body through unchanged and replaces an empty one", () => {
    const fallback = () => buildGroundedResearchAbstainAnswer({ query: "質問", language: "ja", reason: "provider-error" });
    const kept = ensureGroundedResearchTerminalBody("実質のある回答本文です。", fallback);
    expect(kept.guardFired).toBe(false);
    expect(kept.content).toBe("実質のある回答本文です。");
    const replaced = ensureGroundedResearchTerminalBody("", fallback);
    expect(replaced.guardFired).toBe(true);
    expect(replaced.content.length).toBeGreaterThan(0);
    expect(hasSubstantiveResearchUnit(replaced.content)).toBe(true);
    const shell = ensureGroundedResearchTerminalBody("[S1](https://example.com/one)", fallback);
    expect(shell.guardFired).toBe(true);
    expect(shell.content).toBe(replaced.content);
  });
});
