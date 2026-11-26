import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

// Wiring test for the publication gate's shadow mode (non-streaming
// direct path): the JSON response body is exactly the model answer,
// and the gate logs kinds and counts only — never answer text.
// The second describe block covers the enforcement mode (N-5b): a
// firing answer is delivered as the tier-T4 hold with the landing in
// the routing metadata, and an amount-only answer passes unchanged.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const FABRICATED_LAW_ANSWER = "デジタル資産保護法は2021年4月1日から施行されました。登録手数料は16,000円です。";

function createApp(execute: OriginChatExecutor) {
  const app = express();
  app.use(express.json());
  const research: OriginResearchExecutor = async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } });
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute,
    research,
    researchSynthesis: null,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-publication-gate-test",
  }));
  return app;
}

function executorWith(text: string): OriginChatExecutor {
  return vi.fn(async () => ({
    text,
    transportRequestCount: 1,
    actualCostUsd: 0 as const,
    providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
    routingEvidence: { requestedModel: verifiedEvidence.modelId, servedModel: verifiedEvidence.modelId, strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
  })) as unknown as OriginChatExecutor;
}

describe("publication gate shadow mode (non-streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs detections for a direct answer and returns the body unchanged", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(createApp(executorWith(FABRICATED_LAW_ANSWER)))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "手紙の書き出しの例を教えてください。" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(FABRICATED_LAW_ANSWER);
    const gateCall = infoSpy.mock.calls.find(([message]) => String(message).includes("publication gate (shadow)"));
    expect(gateCall).toBeDefined();
    const fields = gateCall?.[1] as Record<string, unknown>;
    expect(fields.requestId).toBe("origin-publication-gate-test");
    expect(fields.publicationGateLawNameCount).toBe(1);
    expect(fields.publicationGateLawEnforcementCount).toBe(1);
    expect(fields.publicationGateAmountFeeCount).toBe(1);
    expect(fields.lawNameUnverifiedCount).toBe(1);
    expect(JSON.stringify(fields)).not.toContain("デジタル資産保護法");
  });
});

const STALE_CAPACITY_ANSWER = "衆議院は465名、参議院は245名です。";
const STALE_CAPACITY_QUESTION = "国会の衆議院と参議院の議員定数はそれぞれ何人ですか？";
const CALCULATION_QUESTION = "税抜12,800円の商品を3個買うと、消費税10%込みでいくらになりますか？";
const CALCULATION_ANSWER = "税込みで42,240円です。";

function createAppWithEnv(execute: OriginChatExecutor, env: NodeJS.ProcessEnv) {
  const app = express();
  app.use(express.json());
  const research: OriginResearchExecutor = async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } });
  app.use(createOriginChatRouter({
    env,
    execute,
    research,
    researchSynthesis: null,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-publication-gate-test",
  }));
  return app;
}

describe("publication gate enforcement mode (non-streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds a stale-capacity answer and reports the tier-T4 landing", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(createAppWithEnv(executorWith(STALE_CAPACITY_ANSWER), {
      OPENROUTER_API_KEY: "synthetic-test-key",
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
    })).post("/api/chat").send({ messages: [{ role: "user", content: STALE_CAPACITY_QUESTION }] });

    expect(response.status).toBe(200);
    // The stale figure never reaches the client; the app-generated
    // hold text does, without claiming a search that never happened.
    expect(response.body.content).not.toContain("245名");
    expect(response.body.content).toContain("確認できた情報がないため、推測で回答しません");
    expect(response.body.content).not.toContain("調べましたが");
    expect(response.body.routing.publicationGateMode).toBe("enforce");
    expect(response.body.routing.publicationGateAction).toBe("held");
    expect(response.body.routing.researchTier).toBe("T4");
    expect(response.body.routing.researchOutcome).toBe("ABSTAIN");
    expect(response.body.routing.researchAbstainReason).toBe("high-risk-insufficient-sources");
    const enforceCall = infoSpy.mock.calls.find(([message]) => String(message).includes("publication gate (enforce)"));
    expect(enforceCall).toBeDefined();
    const fields = enforceCall?.[1] as Record<string, unknown>;
    expect(fields.publicationGateHeld).toBe(true);
    expect(JSON.stringify(fields)).not.toContain("245名");
    // No shadow line for the same answer (no double counting).
    const shadowCall = infoSpy.mock.calls.find(([message]) => String(message).includes("publication gate (shadow)"));
    expect(shadowCall).toBeUndefined();
  });

  it("holds a fabricated-statute answer in enforce mode", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(createAppWithEnv(executorWith(FABRICATED_LAW_ANSWER), {
      OPENROUTER_API_KEY: "synthetic-test-key",
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
    })).post("/api/chat").send({ messages: [{ role: "user", content: "2021年に施行された「デジタル資産保護法」の主な内容を教えてください。" }] });

    expect(response.status).toBe(200);
    expect(response.body.content).not.toContain("登録手数料は16,000円です");
    expect(response.body.content).toContain("推測で回答しません");
    expect(response.body.routing.researchTier).toBe("T4");
    expect(response.body.routing.researchOutcome).toBe("ABSTAIN");
  });

  it("delivers an amount-only calculation answer unchanged in enforce mode", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(createAppWithEnv(executorWith(CALCULATION_ANSWER), {
      OPENROUTER_API_KEY: "synthetic-test-key",
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
    })).post("/api/chat").send({ messages: [{ role: "user", content: CALCULATION_QUESTION }] });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(CALCULATION_ANSWER);
    expect(response.body.routing.publicationGateAction).toBeUndefined();
    expect(response.body.routing.researchTier).toBeUndefined();
  });
});
