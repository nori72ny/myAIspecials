import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS } from "../lib/orchestration/OriginBusinessPlanningAudit.fixtures";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { type OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring test for the numeric audit gate's enforcement mode on the
// SSE path: with ORIGIN_BUSINESS_PLANNING_AUDIT_MODE=enforce, a
// planning answer is buffered until completion, its misstated formula
// result is corrected deterministically, and the corrected text — not
// the raw stream — is what the client receives.

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;
const result = (text: string): OriginProviderExecutionResult => ({
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

const bp7 = ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS.find((entry) => entry.round === "round2" && entry.id === "BP-7");
if (!bp7) throw new Error("round2 BP-7 fixture missing");

const ANSWER_WITH_FORMULA_SLIP = "必要な商談数：60件（120件 ÷ 20%）\n必要な成約件数：120件";

function appWith(streamExecute: OriginProviderStreamExecutor, env: NodeJS.ProcessEnv) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env,
    streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-audit-enforce-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

function streamingExecutor(): OriginProviderStreamExecutor {
  return vi.fn(async (_providerRequest, handlers) => {
    handlers.onDelta("必要な商談数：60件（120件 ÷ ");
    handlers.onDelta("20%）\n必要な成約件数：120件");
    return result(ANSWER_WITH_FORMULA_SLIP);
  }) as unknown as OriginProviderStreamExecutor;
}

describe("numeric audit gate enforcement mode (streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers the corrected text and logs the enforce outcome", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWith(streamingExecutor(), {
      OPENROUTER_API_KEY: "synthetic-key",
      ORIGIN_BUSINESS_PLANNING_AUDIT_MODE: "enforce",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: bp7.prompt }] });

    expect(response.status).toBe(200);
    // The raw misstated figure never reaches the client; the corrected
    // figure and the fix disclosure do.
    expect(response.text).toContain("必要な商談数：600件");
    expect(response.text).not.toContain("必要な商談数：60件");
    expect(response.text).toContain("数値の一部を、回答に記載された計算式に合わせて修正しました。");
    const enforceCall = infoSpy.mock.calls.find(([message]) => String(message).includes("business planning audit (enforce)"));
    expect(enforceCall).toBeDefined();
    const fields = enforceCall?.[1] as { fixedCount?: number };
    expect(fields.fixedCount).toBe(1);
    // The shadow line is not emitted for the same answer (no double count).
    const shadowCall = infoSpy.mock.calls.find(([message]) => String(message).includes("business planning audit (shadow)"));
    expect(shadowCall).toBeUndefined();
  });

  it("without the env switch the same answer streams unchanged (shadow default)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWith(streamingExecutor(), { OPENROUTER_API_KEY: "synthetic-key" }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: bp7.prompt }] });

    expect(response.status).toBe(200);
    expect(response.text).toContain("必要な商談数：60件");
    expect(response.text).not.toContain("自動チェックで気づいた点");
  });
});
