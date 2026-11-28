import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createVercelHandler } from "../../api/index";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import {
  createOriginChatRouter,
  type OriginChatExecutor,
  type OriginResearchExecutor,
} from "./originChatRouter";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import type { OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Register isolation pins (diagnosis 2026-11-28, defect 2).
//
// The successor's production probe (normal mode, alter-ego OFF)
// observed exactly ONE refusal in plain form — the nonexistent-law
// trap's hold: "推測では答えない" / "出して" — while the other
// refusals in the same conversation were polite. Those plain strings
// exist in exactly one place in the codebase: the alter-ego variants
// of buildGroundedResearchAbstainAnswer (groundedResearchOutcome.ts),
// selected by the ambient AsyncLocalStorage flag in
// alterEgoRequestStore. The flag is written with enterWith — ambient
// for the current async context, never scoped with storage.run — and
// production serves every request from ONE warm Express app instance
// (api/index.ts caches the app promise), so a leak across requests
// on a reused instance/context is the structural suspect.
//
// These tests drive the REAL routers on ONE shared app instance,
// alternating mode ON and OFF requests through both refusal
// producers (the grounded-research T4 abstain and the publication
// gate's enforce hold), sequentially, concurrently, on the SSE
// surface, and through the Vercel handler's warm app cache. The
// contract they pin: with the mode OFF, only the polite fixed texts
// can ever be emitted; with the mode ON, the plain variants are
// emitted — and neither bleeds into the other direction.
const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const POLITE_LEAD = "推測で回答しません";
const PLAIN_LEAD = "推測では答えない";
const PLAIN_CLOSING = "確認したい公開情報源があれば出して";

const FABRICATED_LAW_ANSWER = "デジタル資産保護法は2021年4月1日から施行されました。登録手数料は16,000円です。";
const LAW_QUESTION = "デジタル資産保護法の施行日と登録手数料を教えてください。";
const NEWS_QUESTION = "今日の東京のニュースを教えてください。";

function executorReturning(text: string, delayMs = 0) {
  return vi.fn(async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      text,
      transportRequestCount: 1,
      actualCostUsd: 0 as const,
      providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
      routingEvidence: { requestedModel: verifiedEvidence.modelId, servedModel: verifiedEvidence.modelId, strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
    };
  }) as unknown as OriginChatExecutor & ReturnType<typeof vi.fn>;
}

const failingResearch = () => vi.fn().mockResolvedValue({
  ok: false,
  sources: [],
  failure: { stage: "web-search", code: "NETWORK_FAILURE" },
}) as unknown as OriginResearchExecutor;

function createGateApp(execute: OriginChatExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_PUBLICATION_GATE_MODE: "enforce" },
    execute,
    research: failingResearch(),
    researchSynthesis: vi.fn() as unknown as OriginChatExecutor,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-register-isolation-test",
  }));
  return app;
}

function post(app: express.Express, content: string, alterEgoMode?: boolean) {
  return request(app)
    .post("/api/chat")
    .send({ messages: [{ role: "user", content }], ...(alterEgoMode ? { alterEgoMode: true } : {}) });
}

function expectPoliteHold(body: { content?: string }) {
  expect(body.content).toContain(POLITE_LEAD);
  expect(body.content).not.toContain(PLAIN_LEAD);
  expect(body.content).not.toContain(PLAIN_CLOSING);
}

function expectPlainHold(body: { content?: string }) {
  expect(body.content).toContain(PLAIN_LEAD);
  expect(body.content).toContain(PLAIN_CLOSING);
  expect(body.content).not.toContain(POLITE_LEAD);
}

describe("alter-ego register isolation on one warm app instance (publication-gate hold)", () => {
  it("keeps the polite hold for mode OFF after a mode-ON request (ON → OFF)", async () => {
    const app = createGateApp(executorReturning(FABRICATED_LAW_ANSWER));
    expectPlainHold((await post(app, LAW_QUESTION, true)).body);
    expectPoliteHold((await post(app, LAW_QUESTION)).body);
  });

  it("keeps the registers apart in the OFF → ON → OFF order", async () => {
    const app = createGateApp(executorReturning(FABRICATED_LAW_ANSWER));
    expectPoliteHold((await post(app, LAW_QUESTION)).body);
    expectPlainHold((await post(app, LAW_QUESTION, true)).body);
    expectPoliteHold((await post(app, LAW_QUESTION)).body);
  });

  it("keeps the registers apart for concurrent ON and OFF requests", async () => {
    const app = createGateApp(executorReturning(FABRICATED_LAW_ANSWER, 40));
    const [onResponse, offResponse] = await Promise.all([
      post(app, LAW_QUESTION, true),
      post(app, LAW_QUESTION),
    ]);
    expectPlainHold(onResponse.body);
    expectPoliteHold(offResponse.body);
  });
});

describe("alter-ego register isolation on one warm app instance (research abstain)", () => {
  it("keeps the T4 abstain polite for mode OFF after a mode-ON request", async () => {
    const app = createGateApp(executorReturning("モデル回答です。"));
    expectPlainHold((await post(app, NEWS_QUESTION, true)).body);
    expectPoliteHold((await post(app, NEWS_QUESTION)).body);
    expectPlainHold((await post(app, NEWS_QUESTION, true)).body);
    expectPoliteHold((await post(app, NEWS_QUESTION)).body);
  });
});

describe("alter-ego register isolation through the Vercel handler's warm app cache", () => {
  it("keeps the polite hold for mode OFF after a mode-ON request", async () => {
    const handler = createVercelHandler(async () => createGateApp(executorReturning(FABRICATED_LAW_ANSWER)));
    const onResponse = await request(handler)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: LAW_QUESTION }], alterEgoMode: true });
    expectPlainHold(onResponse.body);
    const offResponse = await request(handler)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: LAW_QUESTION }] });
    expectPoliteHold(offResponse.body);
  });
});

describe("alter-ego register isolation on the SSE surface (publication-gate hold)", () => {
  const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
  const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;
  const streamResult = (text: string): OriginProviderExecutionResult => ({
    text,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: {
      requestedModel: evidence.modelId,
      servedModel: evidence.modelId,
      strategy: "adaptive-primary",
      provider: "OpenRouter",
      attempt: 1,
      fallbackUsed: false,
    },
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costUsd: 0 },
  });

  function createStreamApp() {
    const app = express();
    app.use(express.json());
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta(FABRICATED_LAW_ANSWER);
      return streamResult(FABRICATED_LAW_ANSWER);
    }) as unknown as OriginProviderStreamExecutor;
    app.use(createOriginStreamingChatRouter({
      env: { OPENROUTER_API_KEY: "synthetic-key", ORIGIN_PUBLICATION_GATE_MODE: "enforce" },
      streamExecute,
      catalogNow,
      createRequestId: () => "origin-register-isolation-stream-test",
    }));
    app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
    return app;
  }

  function postStream(app: express.Express, alterEgoMode?: boolean) {
    return request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: LAW_QUESTION }], ...(alterEgoMode ? { alterEgoMode: true } : {}) });
  }

  it("keeps the polite hold for mode OFF after a mode-ON request", async () => {
    const app = createStreamApp();
    const onResponse = await postStream(app, true);
    expect(onResponse.status).toBe(200);
    expect(onResponse.text).toContain(PLAIN_LEAD);
    const offResponse = await postStream(app);
    expect(offResponse.status).toBe(200);
    expect(offResponse.text).toContain(POLITE_LEAD);
    expect(offResponse.text).not.toContain(PLAIN_LEAD);
    expect(offResponse.text).not.toContain(PLAIN_CLOSING);
  });
});
