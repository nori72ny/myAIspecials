import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { buildGroundedResearchPartialAnswer } from "../research/groundedResearchV11";
import type { OriginResearchSource } from "./originResearchSource";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

// Synthesis-hygiene (2026-11-14): when the bounded synthesis stage's
// answer is discarded by citation validation, the user-facing fallback
// must have ONE hygienic shape regardless of the discard code — an
// honest lead and a confirmed-scope section of source cards. The
// internal cross-check section (照合メモ) must never appear in the
// answer body.
// R-1 revision (RESEARCH_FLOOR_DESIGN_2026-11-17 §3): the cards now
// carry each top source's excerpt as a bounded, neutralized verbatim
// quote on the source's own card, so page text appears ONLY in that
// quoted form — never as the answer's own statements, and never for
// sources beyond the top three cards.
// Sources-display redesign (SOURCES_DISPLAY_REDESIGN_2026-11-20):
// the attribution boilerplate and the separate source list were
// replaced by the card layout (domain heading, linked title, quote),
// with the retrieval dates collected into a single line.

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

const hygieneSources: OriginResearchSource[] = [
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
  {
    title: "内閣総理大臣の一覧",
    url: "https://ja.wikipedia.org/wiki/pm-list",
    excerpt: "抜粋マーカー3 目次 編集リンク",
    sourceType: "encyclopedia",
    domain: "ja.wikipedia.org",
    rank: 3,
    evidenceLevel: "snippet",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "首相動静",
    url: "https://www.jiji.com/jc/article?k=1",
    excerpt: "抜粋マーカー4 会員登録のご案内",
    sourceType: "web-search",
    domain: "jiji.com",
    rank: 4,
    evidenceLevel: "snippet",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
];

function createApp(researchSynthesis: OriginChatExecutor) {
  const research = vi.fn().mockResolvedValue({
    ok: true,
    searchProvider: "Tavily",
    sources: hygieneSources,
  }) as unknown as OriginResearchExecutor;
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor,
    research,
    researchSynthesis,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-hygiene-trace",
  }));
  return app;
}

function synthesisReturning(text: string): OriginChatExecutor {
  return vi.fn().mockResolvedValue({ ...executionResult, text }) as unknown as OriginChatExecutor;
}

function expectHygienicFallback(body: { content: string; routing: Record<string, unknown> }, failureCode: string) {
  expect(body.routing.synthesisStatus).toBe("citation-validation-failed");
  expect(body.routing.synthesisFailureCode).toBe(failureCode);
  const content = body.content;
  // Honest lead and the confirmed-scope section of source cards.
  expect(content).toContain("要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします");
  expect(content).toContain("## 確認できた範囲");
  expect(content).not.toContain("## 出典");
  expect(content).not.toContain("と示されています");
  expect(content).toContain("### S1 · kantei.go.jp");
  expect(content).toContain("[内閣総理大臣 高市 早苗 - 首相官邸ホームページ](https://www.kantei.go.jp/jp/104/actions/index.html)");
  // The retrieval date is collected into a single line (all four
  // sources share it), not repeated per card.
  expect(content.match(/取得日/g)).toHaveLength(1);
  expect(content).toContain("取得日：2026年11月14日");
  // Quotes ride on at most the top three cards; the fourth source is
  // still present as a card with its linked title.
  expect(content.match(/『/g)).toHaveLength(3);
  expect(content).toContain("### S4 · jiji.com");
  expect(content).toContain("[首相動静](https://www.jiji.com/jc/article?k=1)");
  // R-1: each of the top cards carries its source's excerpt as a
  // verbatim quote; the fourth source's excerpt never appears
  // (quotes stop at three), and no internal cross-check section
  // appears anywhere.
  expect(content).toContain("『抜粋マーカー1 ナビゲーション ホーム 政策 広告バナー』");
  expect(content).toContain("『抜粋マーカー2 サイドバー おすすめ記事 フッター案内』");
  expect(content).toContain("『抜粋マーカー3 目次 編集リンク』");
  expect(content).not.toContain("抜粋マーカー4");
  expect(content).not.toContain("照合メモ");
  expect(content).not.toContain("Cross-check");
}

describe("synthesis-discard fallback hygiene", () => {
  it("uses the hygienic partial answer when synthesis is empty (EMPTY_SYNTHESIS)", async () => {
    const response = await request(createApp(synthesisReturning("")))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expectHygienicFallback(response.body, "EMPTY_SYNTHESIS");
  });

  it("uses the hygienic partial answer when only one source is cited (INSUFFICIENT_SOURCE_COVERAGE, production PM shape)", async () => {
    const response = await request(createApp(synthesisReturning(
      "内閣総理大臣は高市早苗氏です [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
    ))).post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expectHygienicFallback(response.body, "INSUFFICIENT_SOURCE_COVERAGE");
  });

  it("adopts the salvaged synthesis when a single factual line lacks a citation (UNCITED_FACTUAL_UNIT, salvageable shape)", async () => {
    // Salvage adjudication (SYNTHESIS_SALVAGE_DESIGN_2026-11-14 §3): this
    // shape — two cited units and one uncited unit — meets the salvage
    // conditions exactly, so the uncited line is removed and the rest is
    // adopted as citation-validated instead of falling back. The UNCITED
    // fallback shape itself is still covered by the abort case in
    // originChatRouterSynthesisSalvage.test.ts (S15) and by the other
    // discard cases in this file.
    const citedLines = "内閣総理大臣は高市早苗氏です [S1](https://www.kantei.go.jp/jp/104/actions/index.html)\n記者会見も行われました [S2](https://www.nhk.or.jp/politics/articles/1.html)";
    const response = await request(createApp(synthesisReturning(
      citedLines + "\nこれは引用のない補足文です",
    ))).post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(citedLines);
    expect(response.body.content).not.toContain("これは引用のない補足文です");
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.synthesisSalvaged).toBe(true);
    expect(response.body.routing.synthesisSalvageRemovedUnits).toBe(1);
  });

  it("uses the hygienic partial answer when unsupported numbers exceed what the salvage may remove (UNSUPPORTED_NUMERIC_TOKEN)", async () => {
    // Generalized salvage (2026-11-16): a single unsupported-number line is
    // now removed and the verified remainder adopted (see the salvage test
    // file). Three of four units carrying unsupported numbers exceed the
    // removal caps, so this shape still discards to the partial answer,
    // with the FIRST validation code preserved.
    const response = await request(createApp(synthesisReturning([
      "内閣総理大臣は高市早苗氏です [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
      "内閣支持率は99%です [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
      "内閣支持率は98%です [S2](https://www.nhk.or.jp/politics/articles/1.html)",
      "内閣支持率は97%です [S1](https://www.kantei.go.jp/jp/104/actions/index.html) [S2](https://www.nhk.or.jp/politics/articles/1.html)",
    ].join("\n")))).post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });
    expect(response.status).toBe(200);
    expectHygienicFallback(response.body, "UNSUPPORTED_NUMERIC_TOKEN");
  });
});

describe("buildGroundedResearchPartialAnswer", () => {
  it("builds the confirmed scope as source cards with excerpt quotes, capped at three quotes", () => {
    const text = buildGroundedResearchPartialAnswer(hygieneSources, "ja");
    expect(text).toContain("## 確認できた範囲");
    expect(text).not.toContain("と示されています");
    expect(text).toContain("### S2 · nhk.or.jp");
    expect(text).toContain("[高市総理大臣 記者会見の概要](https://www.nhk.or.jp/politics/articles/1.html)");
    expect(text.match(/『/g)).toHaveLength(3);
    // R-1: the excerpt rides on its own source's card.
    const s1Block = text.split("### S2")[0];
    expect(s1Block).toContain("[内閣総理大臣 高市 早苗 - 首相官邸ホームページ](https://www.kantei.go.jp/jp/104/actions/index.html)");
    expect(s1Block).toContain("『抜粋マーカー1 ナビゲーション ホーム 政策 広告バナー』");
    expect(text).not.toContain("抜粋マーカー4");
    expect(text).not.toContain("照合メモ");
  });

  it("omits the retrieval date when it is unknown", () => {
    const undated = hygieneSources.map((source) => ({ ...source, retrievedAt: "" }));
    const text = buildGroundedResearchPartialAnswer(undated, "ja");
    expect(text).not.toContain("取得日");
    expect(text).toContain("### S1 · kantei.go.jp");
  });

  it("returns an empty string when there are no sources", () => {
    expect(buildGroundedResearchPartialAnswer([], "ja")).toBe("");
    expect(buildGroundedResearchPartialAnswer([], "en")).toBe("");
  });

  it("builds the English shape with quoted excerpts on cards and no internal sections", () => {
    const text = buildGroundedResearchPartialAnswer(hygieneSources, "en");
    expect(text).toContain("## What could be confirmed");
    expect(text).toContain("[内閣総理大臣 高市 早苗 - 首相官邸ホームページ](https://www.kantei.go.jp/jp/104/actions/index.html)");
    expect(text).toContain("\"抜粋マーカー1 ナビゲーション ホーム 政策 広告バナー\"");
    expect(text).toContain("Retrieved: 2026-11-14");
    expect(text).not.toContain("## Sources");
    expect(text).not.toContain("Cross-check");
    expect(text).not.toContain("抜粋マーカー4");
  });

  it("R-1: neutralizes quote marks, heading markers, and link syntax inside the excerpt quote", () => {
    const hostile: OriginResearchSource[] = [{
      title: "案内ページ",
      url: "https://example.com/source",
      excerpt: "『重要』 # 見出し [案内ラベル](https://example.org/page) https://example.org/other の内容です。",
      sourceType: "web-search",
      domain: "example.com",
      rank: 1,
      evidenceLevel: "snippet",
      retrievedAt: "2026-11-14T03:00:00.000Z",
      freshness: "recent",
    }];
    const text = buildGroundedResearchPartialAnswer(hostile, "ja");
    // The quote survives as flattened data: label text and heading words
    // remain, but no quote marks, heading markers, link syntax, or bare
    // URLs from the excerpt do. (The "#" check is scoped to the quote
    // itself — the card headings legitimately use "###".)
    // N-2b note: the quote is now the excerpt span covering the card's
    // selected claim sentences (N2_N5_IMPLEMENTATION_DESIGN_2026-11-17
    // §1.4), not the excerpt head. Since the remeasure measure 1-1
    // (ANSWER_STATISTICS_REMEASURE_DIAGNOSIS_2026-11-26) the shared
    // sentence splitter is the packet's protected one, so the periods
    // inside this excerpt's URLs no longer cut it into fragments:
    // the excerpt is a single sentence and rides the quote whole,
    // trailing clause included. (This expectation previously pinned
    // the unprotected splitter's cut — the same defect that split
    // "1.19倍" into "1." + "19倍…" in production.) Every
    // neutralization property above is unchanged.
    expect(text).toContain("『重要 見出し 案内ラベル の内容です。』");
    expect(text).not.toContain("example.org/page");
    expect(text).not.toContain("example.org/other");
    const quote = text.match(/『([^』]*)』/)?.[1] ?? "";
    expect(quote).not.toContain("#");
    expect(quote).not.toContain("](");
  });

  it("R-1: bounds the excerpt quote at 120 characters", () => {
    const long: OriginResearchSource[] = [{
      title: "長い抜粋",
      url: "https://example.com/long",
      excerpt: "あ".repeat(300),
      sourceType: "web-search",
      domain: "example.com",
      rank: 1,
      evidenceLevel: "snippet",
      retrievedAt: "2026-11-14T03:00:00.000Z",
      freshness: "recent",
    }];
    const text = buildGroundedResearchPartialAnswer(long, "ja");
    // Sources-display redesign (2026-11-20): the bound dropped from
    // 240 to 120 characters, with the mid-sentence cut marked by an
    // ellipsis.
    expect(text).toContain(`『${"あ".repeat(120)}…』`);
    expect(text).not.toContain("あ".repeat(121));
  });

  it("R-1: keeps the title-only card when a source has no quotable excerpt", () => {
    const bare: OriginResearchSource[] = [{
      title: "抜粋なし資料",
      url: "https://example.com/bare",
      excerpt: "",
      sourceType: "web-search",
      domain: "example.com",
      rank: 1,
      evidenceLevel: "snippet",
      retrievedAt: "2026-11-14T03:00:00.000Z",
      freshness: "recent",
    }];
    const text = buildGroundedResearchPartialAnswer(bare, "ja");
    expect(text).toContain("### S1 · example.com");
    expect(text).toContain("[抜粋なし資料](https://example.com/bare)");
    expect(text).toContain("取得日：2026年11月14日");
  });
});
