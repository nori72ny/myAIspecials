import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { buildGroundedResearchAbstainAnswer } from "../research/groundedResearchOutcome";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import { isRefinementOfPreviousAnswer } from "./originChatValidation";
import type { OriginChatMessage } from "./originProviderClient";
import type { OriginProviderExecutionResult } from "./originProviderClient";
import { createOriginResearchRouter } from "./originResearchRouter";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// P1 regression suite (WEEKLY_INSPECTION_P1_DIAGNOSIS_2026-11-23),
// replacing the temporary diagnosis reproduction. Two countermeasures
// are pinned end to end:
//  1. No landing (research failure / no sources / publication-gate
//     hold) ever echoes the refinement instruction text — or any long
//     query — into the answer body.
//  2. A send carrying the explicit refinementOfPreviousAnswer marker
//     (with a previous answer present) is excluded from the text-scan
//     route classification on every router, so the refinement reaches
//     the direct path and transforms the previous answer. A marker
//     without a previous answer is ignored.

// The refinement prompts exactly as built by
// src/components/personal/OriginAnswerMarkdown.tsx refinementPrompt().
const PROMPTS = {
  depthJa: "直前の回答を、実務でそのまま判断・実行に使える深さまで引き上げてください。結論は明確に保ちつつ、不足している判断基準、根拠、適用条件、比較、トレードオフ、リスク、具体手順、検証方法、未確認点を補ってください。依頼の種類に合わせ、調査なら出典・条件・比較理由、開発なら使える変更内容・組込み方・テスト・制約、計画なら成果物・依存関係・担当・完了条件を含めてください。文字数を増やすための一般論や、未確認の事実の創作はしないでください。",
  exampleJa: "直前の回答に、私の依頼に直接使える具体例を追加し、その例が結論や提案にどうつながるかまで示してください。仮定や例示は明示し、重要な条件を落とさず、架空の事例を実績として扱わないでください。",
  planJa: "直前の回答を、実際に進められる実行プランに変換してください。結論と制約を維持し、実施順、依存関係、判断ポイント、各重要工程の検証方法、明確な完了条件まで示してください。開発作業なら変更対象のファイルやコンポーネント、完了を証明するテストやチェックも具体化してください。未実施の作業を完了済みとは書かないでください。",
  summaryJa: "直前の回答を、意思決定に必要な結論と次の行動がすぐ分かる形に圧縮してください。重要な条件、リスク、不確実性は残し、必要情報ではなく重複を削ってください。",
  depthEn: "Upgrade your previous answer to professional working depth. Keep the direct conclusion, then fill the material gaps with decision criteria, evidence or reasoning, relevant conditions, trade-offs, risks, concrete steps, verification, and explicit unknowns. Adapt the structure to the task: research needs sources/conditions/comparison logic; coding needs usable changes, integration, tests, and limitations; planning needs deliverables, dependencies, ownership, and completion criteria. Do not add filler or invent facts.",
} as const;

const QUESTION = { role: "user", content: "コーヒーを美味しく淹れるコツを3つ教えて" };
const ANSWER = { role: "assistant", content: "コツは3つあります。第一に水温、第二に粉の量、第三に抽出時間です。" };
const DIRECT_TEXT = "安全な確認結果です。";

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const executionResult = {
  text: DIRECT_TEXT,
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

function failingResearch() {
  return vi.fn().mockResolvedValue({
    ok: false,
    sources: [],
    failure: { stage: "web-search", code: "NETWORK_FAILURE" },
  }) as unknown as OriginResearchExecutor & ReturnType<typeof vi.fn>;
}

function noSourcesResearch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    searchProvider: "Tavily",
    sources: [],
    groundingFailure: "no-sources",
  }) as unknown as OriginResearchExecutor & ReturnType<typeof vi.fn>;
}

function createChatApp(research: OriginResearchExecutor, options?: { env?: NodeJS.ProcessEnv; execute?: OriginChatExecutor }) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: options?.env ?? { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: options?.execute ?? (vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor),
    research,
    researchSynthesis: vi.fn() as unknown as OriginChatExecutor,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-p1-regression",
  }));
  return app;
}

function executorWith(text: string): OriginChatExecutor {
  return vi.fn(async () => ({ ...executionResult, text })) as unknown as OriginChatExecutor;
}

function expectNoPromptEcho(content: string, prompt: string) {
  expect(content).not.toContain(prompt.slice(0, 40));
  expect(content).not.toContain(prompt.slice(40, 80));
  expect(content).not.toContain(prompt.slice(-40));
}

describe("P1 leak regression: unmarked refinement sends never echo the instruction", () => {
  it("depth (ja) + research provider failure lands on the generic hold, not the leaked one", async () => {
    const research = failingResearch();
    const response = await request(createChatApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: PROMPTS.depthJa }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.researchTier).toBe("T4");
    expect(response.body.content).toBe(buildGroundedResearchAbstainAnswer({ query: "", language: "ja", reason: "provider-error" }));
    expectNoPromptEcho(response.body.content, PROMPTS.depthJa);
  });

  it("depth (en) + research provider failure lands on the generic hold", async () => {
    const research = failingResearch();
    const response = await request(createChatApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: PROMPTS.depthEn }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.researchTier).toBe("T4");
    expect(response.body.content).toBe(buildGroundedResearchAbstainAnswer({ query: "", language: "en", reason: "provider-error" }));
    expectNoPromptEcho(response.body.content, PROMPTS.depthEn);
  });

  it("depth (ja) + search with no sources lands on the generic hold", async () => {
    const research = noSourcesResearch();
    const response = await request(createChatApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: PROMPTS.depthJa }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.researchTier).toBe("T4");
    expect(response.body.routing.researchAbstainReason).toBe("no-sources");
    expect(response.body.content).toBe(buildGroundedResearchAbstainAnswer({ query: "", language: "ja", reason: "no-sources" }));
    expectNoPromptEcho(response.body.content, PROMPTS.depthJa);
  });

  it("example (ja) + publication-gate hold lands on the generic hold", async () => {
    const staleCapacityAnswer = "衆議院は465名、参議院は245名です。";
    const research = failingResearch();
    const response = await request(createChatApp(research, {
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_PUBLICATION_GATE_MODE: "enforce" },
      execute: executorWith(staleCapacityAnswer),
    }))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: PROMPTS.exampleJa }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.publicationGateAction).toBe("held");
    expect(response.body.content).toBe(buildGroundedResearchAbstainAnswer({
      query: "",
      language: "ja",
      reason: "high-risk-insufficient-sources",
      searched: false,
    }));
    expectNoPromptEcho(response.body.content, PROMPTS.exampleJa);
    // The example refinement never required research in the first
    // place (routing unchanged for the non-depth pills).
    expect(research).not.toHaveBeenCalled();
  });

  it.each([
    ["example", PROMPTS.exampleJa],
    ["plan", PROMPTS.planJa],
    ["summary", PROMPTS.summaryJa],
  ])("%s (ja) unmarked keeps its existing direct routing", async (_kind, prompt) => {
    const research = failingResearch();
    const response = await request(createChatApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: prompt }] });
    expect(response.status).toBe(200);
    expect(research).not.toHaveBeenCalled();
    expect(response.body.content).toBe(DIRECT_TEXT);
  });
});

describe("P1 countermeasure 2: the explicit refinement marker", () => {
  it.each([
    ["depth (ja)", PROMPTS.depthJa],
    ["example (ja)", PROMPTS.exampleJa],
    ["plan (ja)", PROMPTS.planJa],
    ["summary (ja)", PROMPTS.summaryJa],
    ["depth (en)", PROMPTS.depthEn],
  ])("%s marked: the research route is never consulted and the direct path answers", async (_kind, prompt) => {
    const research = failingResearch();
    const response = await request(createChatApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: prompt }], refinementOfPreviousAnswer: true });
    expect(response.status).toBe(200);
    expect(research).not.toHaveBeenCalled();
    expect(response.body.content).toBe(DIRECT_TEXT);
  });

  it("a marker without a previous answer is ignored (treated as a normal send)", async () => {
    const research = failingResearch();
    const response = await request(createChatApp(research))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: PROMPTS.depthJa }], refinementOfPreviousAnswer: true });
    expect(response.status).toBe(200);
    expect(research).toHaveBeenCalled();
    expect(response.body.routing.researchTier).toBe("T4");
    expectNoPromptEcho(response.body.content, PROMPTS.depthJa);
  });

  it("a marker whose previous message is another user message is ignored", async () => {
    const research = failingResearch();
    const response = await request(createChatApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, { role: "user", content: PROMPTS.depthJa }], refinementOfPreviousAnswer: true });
    expect(response.status).toBe(200);
    expect(research).toHaveBeenCalled();
    expect(response.body.routing.researchTier).toBe("T4");
  });

  it("a non-boolean marker value is ignored", async () => {
    const research = failingResearch();
    const response = await request(createChatApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: PROMPTS.depthJa }], refinementOfPreviousAnswer: "true" });
    expect(response.status).toBe(200);
    expect(research).toHaveBeenCalled();
    expect(response.body.routing.researchTier).toBe("T4");
  });
});

describe("K-04: the marker also excludes the weather and capability text-scan routes", () => {
  it("marked: a weather-shaped text stays on the direct path (no weather route)", async () => {
    const research = failingResearch();
    const execute = vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor & ReturnType<typeof vi.fn>;
    const response = await request(createChatApp(research, { execute }))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: "東京の天気を教えてください" }], refinementOfPreviousAnswer: true });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(DIRECT_TEXT);
    expect(response.body.routing?.answerMode).not.toBe("weather");
    expect(execute).toHaveBeenCalled();
    expect(research).not.toHaveBeenCalled();
  });

  it("marked: a capability-shaped text stays on the direct path (no capability guide)", async () => {
    const research = failingResearch();
    const execute = vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor & ReturnType<typeof vi.fn>;
    const response = await request(createChatApp(research, { execute }))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: "あなたは何ができますか？" }], refinementOfPreviousAnswer: true });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(DIRECT_TEXT);
    expect(execute).toHaveBeenCalled();
  });

  it("unmarked: the same capability-shaped text still takes the capability guide route", async () => {
    const research = failingResearch();
    const execute = vi.fn().mockResolvedValue(executionResult) as unknown as OriginChatExecutor & ReturnType<typeof vi.fn>;
    const response = await request(createChatApp(research, { execute }))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: "あなたは何ができますか？" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain("Grounded Research");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("isRefinementOfPreviousAnswer", () => {
  const asMessages = (entries: Array<[string, string]>): OriginChatMessage[] =>
    entries.map(([role, content]) => ({ role: role as OriginChatMessage["role"], content }));

  it("accepts only boolean true with an assistant answer immediately before the final user message", () => {
    const conversation = asMessages([["user", "質問"], ["assistant", "回答"], ["user", "直前の回答を詳しく"]]);
    expect(isRefinementOfPreviousAnswer({ refinementOfPreviousAnswer: true }, conversation)).toBe(true);
    expect(isRefinementOfPreviousAnswer({ refinementOfPreviousAnswer: "true" }, conversation)).toBe(false);
    expect(isRefinementOfPreviousAnswer({ refinementOfPreviousAnswer: 1 }, conversation)).toBe(false);
    expect(isRefinementOfPreviousAnswer({}, conversation)).toBe(false);
    expect(isRefinementOfPreviousAnswer({ refinementOfPreviousAnswer: true }, asMessages([["user", "直前の回答を詳しく"]]))).toBe(false);
    expect(isRefinementOfPreviousAnswer({ refinementOfPreviousAnswer: true }, asMessages([["user", "質問"], ["user", "直前の回答を詳しく"]]))).toBe(false);
    expect(isRefinementOfPreviousAnswer({ refinementOfPreviousAnswer: true }, asMessages([["user", "質問"], ["assistant", "回答"]]))).toBe(false);
  });
});

describe("P1 countermeasure 2: streaming router delegation", () => {
  const streamResult = (text: string): OriginProviderExecutionResult => ({
    text,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: {
      requestedModel: verifiedEvidence.modelId,
      servedModel: verifiedEvidence.modelId,
      strategy: "adaptive-primary",
      provider: "OpenRouter",
      attempt: 1,
      fallbackUsed: false,
    },
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costUsd: 0 },
  });

  function createStreamApp(streamExecute: OriginProviderStreamExecutor) {
    const app = express();
    app.use(express.json());
    app.use(createOriginStreamingChatRouter({
      env: { OPENROUTER_API_KEY: "synthetic-key" },
      streamExecute,
      catalogNow: () => verifiedCatalogTime,
      createRequestId: () => "origin-p1-stream",
    }));
    app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
    return app;
  }

  function streamExecutor() {
    return vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta("調整した回答です。");
      return streamResult("調整した回答です。");
    }) as unknown as OriginProviderStreamExecutor & ReturnType<typeof vi.fn>;
  }

  it("a marked depth refinement is streamed directly instead of delegated to research routing", async () => {
    const streamExecute = streamExecutor();
    const response = await request(createStreamApp(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: PROMPTS.depthJa }], refinementOfPreviousAnswer: true });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(streamExecute).toHaveBeenCalledTimes(1);
    expect(response.text).toContain("調整した回答です。");
  });

  it("the same depth refinement unmarked is delegated (research routing unchanged)", async () => {
    const streamExecute = streamExecutor();
    const response = await request(createStreamApp(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: PROMPTS.depthJa }] });
    expect(response.status).toBe(418);
    expect(response.body).toEqual({ delegated: true });
    expect(streamExecute).not.toHaveBeenCalled();
  });

  it("a marked capability-shaped text is streamed directly instead of delegated (K-04)", async () => {
    const streamExecute = streamExecutor();
    const response = await request(createStreamApp(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: "あなたは何ができますか？" }], refinementOfPreviousAnswer: true });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(streamExecute).toHaveBeenCalledTimes(1);
  });

  it("the same capability-shaped text unmarked is delegated (routing unchanged)", async () => {
    const streamExecute = streamExecutor();
    const response = await request(createStreamApp(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: "あなたは何ができますか？" }] });
    expect(response.status).toBe(418);
    expect(response.body).toEqual({ delegated: true });
    expect(streamExecute).not.toHaveBeenCalled();
  });
});

describe("P1 countermeasure 2: research router passthrough", () => {
  function createResearchApp(research: ReturnType<typeof vi.fn>) {
    const app = express();
    app.use(express.json());
    app.use(createOriginResearchRouter({ research: research as never }));
    app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
    return app;
  }

  const freshnessText = "最新の情報を教えてください";

  it("a marked send passes through even when its text matches the freshness scan", async () => {
    const research = vi.fn().mockResolvedValue({ ok: false, sources: [], failure: { stage: "web-search", code: "NETWORK_FAILURE" } });
    const response = await request(createResearchApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: freshnessText }], refinementOfPreviousAnswer: true });
    expect(response.status).toBe(418);
    expect(response.body).toEqual({ delegated: true });
    expect(research).not.toHaveBeenCalled();
  });

  it("the same text unmarked is still intercepted", async () => {
    const research = vi.fn().mockResolvedValue({ ok: false, sources: [], failure: { stage: "web-search", code: "NETWORK_FAILURE" } });
    const response = await request(createResearchApp(research))
      .post("/api/chat")
      .send({ messages: [QUESTION, ANSWER, { role: "user", content: freshnessText }] });
    expect(research).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
  });
});
