import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { ORIGIN_BUSINESS_PLANNING_MEASURED_ANSWERS } from "../lib/orchestration/OriginBusinessPlanningAudit.fixtures";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { type OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring test for the numeric audit gate's shadow mode: a planning
// answer delivered over SSE is audited and logged, and the delivered
// stream stays byte-identical to the model answer.

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

function appWith(streamExecute: OriginProviderStreamExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-key" },
    streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-audit-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

describe("numeric audit gate shadow mode (streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the audit outcome for a planning answer and delivers the text unchanged", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta(bp7.answerText);
      return result(bp7.answerText);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: bp7.prompt }] });

    expect(response.status).toBe(200);
    // The delivered stream carries the model answer verbatim.
    expect(response.text).toContain("必要な成約件数");
    expect(response.text).toContain("年間360件");
    // The shadow audit logged the round-2 BP-7 breakdown defect.
    const auditCall = infoSpy.mock.calls.find(([message]) => String(message).includes("business planning audit (shadow)"));
    expect(auditCall).toBeDefined();
    const fields = auditCall?.[1] as { kind?: string; violationCodes?: string[] };
    expect(fields.kind).toBe("campaign-plan");
    expect(fields.violationCodes).toContain("BREAKDOWN_SUM_MISMATCH");
  });

  it("does not log an audit line for a non-planning answer", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta("短い回答です。");
      return result("短い回答です。");
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "短い案内文を作ってください" }] });

    expect(response.status).toBe(200);
    const auditCall = infoSpy.mock.calls.find(([message]) => String(message).includes("business planning audit"));
    expect(auditCall).toBeUndefined();
  });
});
