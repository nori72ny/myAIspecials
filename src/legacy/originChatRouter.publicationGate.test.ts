import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

// Wiring test for the publication gate's shadow mode (non-streaming
// direct path): the JSON response body is exactly the model answer,
// and the gate logs kinds and counts only — never answer text.

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
