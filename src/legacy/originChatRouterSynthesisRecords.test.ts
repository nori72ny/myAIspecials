import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const { researchMock } = vi.hoisted(() => ({ researchMock: vi.fn() }));
vi.mock("./originResearchSource.js", () => ({ researchCurrentInformation: researchMock }));

import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { buildGroundedResearchPartialAnswer } from "../research/groundedResearchV11";
import {
  buildGroundedResearchRecordsInstruction,
  buildGroundedResearchSelectionInstruction,
  groundedResearchRecordsSalvageNote,
} from "../research/groundedResearchRecordsV13";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import { createOriginResearchRouter, type OriginResearchSynthesisExecutor } from "./originResearchRouter";
import type { OriginResearchSource } from "./originResearchSource";

// Records path, router level (SYNTHESIS_RECORDS_DESIGN_2026-11-14
// §14.1 R-PR-3 / §14.3): both routers offer the synthesis to the shared
// records helper (executeGroundedResearchRecordsSynthesis in the V13
// module) behind the ORIGIN_SYNTHESIS_RECORDS_ENABLED kill switch
// (default OFF). These tests pin: OFF leaves the V12 text path byte-for-
// byte in charge; ON adopts rendered records, fails closed to the
// existing fallback without ever running the text path, and keeps
// output-form requests (§7.4) on the text path.

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

const PM_UNIT_1 = "高市早苗は、第105代内閣総理大臣に指名された。";
const PM2_UNIT_1 = "2026年11月現在、内閣総理大臣は高市早苗氏である。";

const recordsSources: OriginResearchSource[] = [
  {
    title: "内閣総理大臣の指名について",
    url: "https://www.kantei.go.jp/jp/104/actions/index.html",
    excerpt: `${PM_UNIT_1}内閣総理大臣は国会の議決により指名される。`,
    sourceType: "web-search",
    domain: "kantei.go.jp",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "首相ニュース",
    url: "https://www.nhk.or.jp/politics/articles/1.html",
    excerpt: `${PM2_UNIT_1}高市氏は自由民主党の総裁を務めている。`,
    sourceType: "web-search",
    domain: "nhk.or.jp",
    rank: 2,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
  },
];

const RECORDS_JSON = JSON.stringify({
  records: [
    { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" },
    { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" },
  ],
});

const EXPECTED_RENDER = [
  "- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
  "- 2026年11月時点でも内閣総理大臣は高市早苗氏です。 [S2](https://www.nhk.or.jp/politics/articles/1.html)",
  "",
  "## 出典",
  "- S1: 内閣総理大臣の指名について（kantei.go.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
  "- S2: 首相ニュース（nhk.or.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S2](https://www.nhk.or.jp/politics/articles/1.html)",
].join("\n");

const VALID_TEXT = [
  "首相官邸のページでは高市早苗が内閣総理大臣として示されています [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
  "記者会見も行われました [S2](https://www.nhk.or.jp/politics/articles/1.html)",
].join("\n");

function createChatApp(researchSynthesis: OriginChatExecutor, env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: "synthetic-test-key" }) {
  const research = vi.fn().mockResolvedValue({
    ok: true,
    searchProvider: "Tavily",
    sources: recordsSources,
  }) as unknown as OriginResearchExecutor;
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env,
    execute: vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor,
    research,
    researchSynthesis,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-records-trace",
  }));
  return app;
}

const RECORDS_ON_ENV: NodeJS.ProcessEnv = {
  OPENROUTER_API_KEY: "synthetic-test-key",
  ORIGIN_SYNTHESIS_RECORDS_ENABLED: "true",
};

describe("chat router records path", () => {
  it("adopts rendered records when the kill switch is ON", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: RECORDS_JSON }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis, RECORDS_ON_ENV))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(EXPECTED_RENDER);
    expect(response.body.routing.synthesisStatus).toBe("records-validated");
    expect(response.body.routing.synthesisPath).toBe("records");
    expect(response.body.routing.synthesisSourceCount).toBe(2);
    expect(response.body.supervisor.status).toBe("not-required");
    // Exactly one execution: no salvage, no feedback retry on this path.
    expect(synthesis).toHaveBeenCalledTimes(1);
    // The request is the records request: records instruction, E-ID
    // packet, and no packet URL or citation token shown to the model.
    const calls = (synthesis as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0].systemInstruction).toBe(buildGroundedResearchRecordsInstruction("ja"));
    expect(calls[0]?.[0].messages[0].content).toContain("[E1_1]");
    expect(calls[0]?.[0].messages[0].content).not.toContain("/jp/104/actions/index.html");
    expect(calls[0]?.[0].messages[0].content).not.toContain("citation_token");
  });

  it("fails closed to the partial answer when no record is adopted (no text-path second chance)", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: "よく分かりませんでした。" }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis, RECORDS_ON_ENV))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(buildGroundedResearchPartialAnswer(recordsSources, "ja"));
    expect(response.body.routing.synthesisStatus).toBe("records-validation-failed");
    expect(response.body.routing.synthesisFailureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(response.body.routing.synthesisPath).toBeUndefined();
    // Two executions: the records execution, then the select-only
    // selection layer (§8) inside the records path. The second call is
    // NOT a fall back into the text path (which would have retried) —
    // the text path never runs for a records-selected request.
    expect(synthesis).toHaveBeenCalledTimes(2);
  });

  it("delivers verified single-source records as a marked partial answer (improvement #2)", async () => {
    const singleRecordJson = JSON.stringify({
      records: [{ evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" }],
    });
    // Sequenced by instruction: the records execution returns one
    // S1 record (coverage fails), the selection execution selects
    // nothing. Before improvement #2 this fell back to the
    // source-list-only partial answer; the salvage stage now
    // delivers the verified record as a partial answer.
    const synthesis = vi.fn(async (request: { systemInstruction: string }) => {
      if (request.systemInstruction === buildGroundedResearchRecordsInstruction("ja")) {
        return { ...executionResult, text: singleRecordJson };
      }
      if (request.systemInstruction === buildGroundedResearchSelectionInstruction("ja")) {
        return { ...executionResult, text: "{\"select\":[]}" };
      }
      throw new Error("unexpected instruction");
    }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis, RECORDS_ON_ENV))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe([
      groundedResearchRecordsSalvageNote("ja"),
      "",
      "- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
      "",
      "## 出典",
      "- S1: 内閣総理大臣の指名について（kantei.go.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S1](https://www.kantei.go.jp/jp/104/actions/index.html)",
      "- S2: 首相ニュース（nhk.or.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S2](https://www.nhk.or.jp/politics/articles/1.html)",
    ].join("\n"));
    expect(response.body.routing.synthesisStatus).toBe("records-validated");
    expect(response.body.routing.synthesisPath).toBe("records");
    expect(response.body.routing.synthesisPartial).toBe(true);
    expect(response.body.routing.synthesisSourceCount).toBe(1);
    expect(response.body.answer.limitations).toContain("この回答は確認できた範囲のみを示しており、確認できなかった部分は含めていません。");
    // Records-path envelope wording carries no internal bundle term:
    // the verification summary and the base limitation speak of the
    // retrieved source information in plain words.
    expect(response.body.answer.limitations).toContain("回答の各主張は、取得した出典情報と逐語照合した引用で裏付けられていますが、主張の真偽・網羅性・媒体の権威性は独立検証していません。");
    expect(response.body.answer.verification.summary).toContain("取得した出典情報に対して逐語検証を通ったレコードだけから");
    expect(JSON.stringify(response.body.answer)).not.toContain("パケット");
    expect(synthesis).toHaveBeenCalledTimes(2);
  });

  it("leaves the text path fully in charge when the kill switch is OFF (default)", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: VALID_TEXT }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(VALID_TEXT);
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.routing.synthesisPath).toBeUndefined();
    expect(synthesis).toHaveBeenCalledTimes(1);
    // The request is the V12 text request, unchanged.
    const calls = (synthesis as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0].systemInstruction).toContain("## 出典");
    expect(calls[0]?.[0].messages[0].content).toContain("citation_token");
  });

  it("does not take the records path when an output form was requested (§7.4), even with the switch ON", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: RECORDS_JSON }) as unknown as OriginChatExecutor;
    const response = await request(createChatApp(synthesis, RECORDS_ON_ENV))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "今日の公開情報を調査して、スライドにしてください" }] });

    expect(response.status).toBe(200);
    expect(response.body.routing.synthesisStatus).not.toBe("records-validated");
    expect(response.body.routing.synthesisPath).toBeUndefined();
    expect(response.body.content).not.toBe(EXPECTED_RENDER);
    // The synthesis request is the V12 text request (presentation
    // output contract included), not the records request.
    const calls = (synthesis as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0].systemInstruction).toContain("## 出典");
    expect(calls[0]?.[0].messages[0].content).toContain("citation_token");
  });
});

describe("research router records path", () => {
  const iphoneSources = [
    { title: "iPhone 18 Pro 発表 - Apple Newsroom", url: "https://www.apple.com/jp/newsroom/iphone18", excerpt: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。", domain: "apple.com", rank: 1, sourceType: "web-search" as const, evidenceLevel: "page-verified" as const, retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "recent" as const, revisionTimestamp: "2026-09-10T00:00:00.000Z" },
    { title: "iPhone価格まとめ", url: "https://example.jp/iphone", excerpt: "iPhone 18 Proの価格は219,800円と報じられています。", domain: "example.jp", rank: 2, sourceType: "web-search" as const, evidenceLevel: "snippet" as const, retrievedAt: "2026-11-07T00:00:00.000Z", freshness: "unknown" as const },
  ];
  const iphoneQuery = "iPhone の最新モデルの、日本での価格と発売日を教えてください";
  const IPHONE_RECORDS_JSON = JSON.stringify({
    records: [
      { evidence: ["E1_1"], quote: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。", text: "iPhone 18 Proの価格は219,800円です。" },
      { evidence: ["E2_1"], quote: "iPhone 18 Proの価格は219,800円と報じられています。", text: "iPhone 18 Proの価格は219,800円と報じられています。" },
    ],
  });
  // R-PR-9e: the two records state the same claim (price 219,800円)
  // in two phrasings (〜です / 〜と報じられています), so the semantic
  // duplicate layer of the rendering dedup renders ONE bullet with
  // both citations merged. Before 9e this expectation pinned the two
  // bullets separately — that was exactly the paraphrase duplication
  // R9-E removes (the A-02 / B-01 shape of the R-PR-8 measurement).
  const EXPECTED_IPHONE_RENDER = [
    "- iPhone 18 Proの価格は219,800円です。 [S1](https://www.apple.com/jp/newsroom/iphone18) [S2](https://example.jp/iphone)",
    "",
    "## 出典",
    "- S1: iPhone 18 Pro 発表 - Apple Newsroom（apple.com）／公開日: 2026年9月10日／取得日: 2026年11月7日 [S1](https://www.apple.com/jp/newsroom/iphone18)",
    "- S2: iPhone価格まとめ（example.jp）／公開日: 公開日不明／取得日: 2026年11月7日 [S2](https://example.jp/iphone)",
  ].join("\n");

  function createResearchApp(researchSynthesis: OriginResearchSynthesisExecutor, env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: "synthetic-test-key" }) {
    researchMock.mockReset();
    researchMock.mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: iphoneSources });
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({
      env,
      researchSynthesis,
      catalogNow: () => verifiedCatalogTime,
    }));
    return app;
  }

  it("adopts rendered records when the kill switch is ON", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: IPHONE_RECORDS_JSON }) as unknown as OriginResearchSynthesisExecutor;
    const response = await request(createResearchApp(synthesis, RECORDS_ON_ENV)).post("/api/chat")
      .send({ messages: [{ role: "user", content: iphoneQuery }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(EXPECTED_IPHONE_RENDER);
    expect(response.body.routing.synthesisStatus).toBe("records-validated");
    expect(response.body.routing.synthesisPath).toBe("records");
    expect(response.body.research.synthesis).toEqual({ status: "records-validated", path: "records", sourceCount: 2 });
    expect(synthesis).toHaveBeenCalledTimes(1);
  });

  it("reports a salvaged single-source answer as a partial records synthesis (improvement #2)", async () => {
    const singleRecordJson = JSON.stringify({
      records: [{
        evidence: ["E1_1"],
        quote: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。",
        text: "iPhone 18 Proの価格は219,800円です。",
      }],
    });
    const synthesis = vi.fn(async (request: { systemInstruction: string }) => {
      if (request.systemInstruction === buildGroundedResearchRecordsInstruction("ja")) {
        return { ...executionResult, text: singleRecordJson };
      }
      if (request.systemInstruction === buildGroundedResearchSelectionInstruction("ja")) {
        return { ...executionResult, text: "{\"select\":[]}" };
      }
      throw new Error("unexpected instruction");
    }) as unknown as OriginResearchSynthesisExecutor;
    const response = await request(createResearchApp(synthesis, RECORDS_ON_ENV)).post("/api/chat")
      .send({ messages: [{ role: "user", content: iphoneQuery }] });

    expect(response.status).toBe(200);
    expect(response.body.content.startsWith(groundedResearchRecordsSalvageNote("ja"))).toBe(true);
    expect(response.body.content).toContain("- iPhone 18 Proの価格は219,800円です。 [S1](https://www.apple.com/jp/newsroom/iphone18)");
    expect(response.body.content).not.toBe(buildGroundedResearchPartialAnswer(iphoneSources, "ja"));
    expect(response.body.research.synthesis).toEqual({
      status: "records-validated",
      path: "records",
      sourceCount: 1,
      partial: true,
    });
    expect(response.body.routing.synthesisPartial).toBe(true);
    expect(synthesis).toHaveBeenCalledTimes(2);
  });

  it("degrades to the partial answer, not the extractive dump, when no record is adopted (R-PR-9a)", async () => {
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: "よく分かりませんでした。" }) as unknown as OriginResearchSynthesisExecutor;
    const response = await request(createResearchApp(synthesis, RECORDS_ON_ENV)).post("/api/chat")
      .send({ messages: [{ role: "user", content: iphoneQuery }] });

    expect(response.status).toBe(200);
    // R-PR-9a: the records-validation failure body on this router is
    // the same deterministic partial answer the chat router falls
    // back to; the extractive dump (report + full-excerpt
    // concatenation) no longer appears as the answer body.
    expect(response.body.content).toBe(buildGroundedResearchPartialAnswer(iphoneSources, "ja"));
    expect(response.body.content).not.toContain("出典付き調査レポート（抽出方式）");
    expect(response.body.research.synthesis).toEqual({ status: "records-validation-failed", failureCode: "NO_ACCEPTED_RECORDS" });
    // Two executions: records, then the selection layer (§8) inside
    // the records path — not a fall back into the text path.
    expect(synthesis).toHaveBeenCalledTimes(2);
  });

  it("leaves the text path fully in charge when the kill switch is OFF (default)", async () => {
    const validText = [
      "価格は219,800円です。[S1](https://www.apple.com/jp/newsroom/iphone18)",
      "発売日は2026年9月18日です。[S1](https://www.apple.com/jp/newsroom/iphone18) [S2](https://example.jp/iphone)",
    ].join("\n");
    const synthesis = vi.fn().mockResolvedValue({ ...executionResult, text: validText }) as unknown as OriginResearchSynthesisExecutor;
    const response = await request(createResearchApp(synthesis)).post("/api/chat")
      .send({ messages: [{ role: "user", content: iphoneQuery }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(validText);
    expect(response.body.routing.synthesisStatus).toBe("citation-validated");
    expect(response.body.research.synthesis).toEqual({ status: "citation-validated", sourceCount: 2 });
    expect(synthesis).toHaveBeenCalledTimes(1);
  });
});

describe("shared helper wiring", () => {
  it("both routers import the same records helper from the V13 module", () => {
    const chatRouter = readFileSync(resolve(process.cwd(), "src/legacy/originChatRouter.ts"), "utf8");
    const researchRouter = readFileSync(resolve(process.cwd(), "src/legacy/originResearchRouter.ts"), "utf8");
    for (const routerSource of [chatRouter, researchRouter]) {
      expect(routerSource).toContain("executeGroundedResearchRecordsSynthesis");
      expect(routerSource).toContain("isGroundedResearchRecordsEnabled");
      expect(routerSource).toContain("../research/groundedResearchRecordsV13.js");
    }
  });
});
