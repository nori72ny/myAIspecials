import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { withAlterEgoMode } from "../lib/orchestration/alterEgoRequestStore";
import { originGroqRouteSystemInstruction } from "./originChatResponsePolicy";
import { buildGroundedResearchSynthesisInstruction } from "../research/groundedResearchSynthesisV12";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import type { OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Diagnosis reproduction (2026-11-28): alter-ego mode does not surface
// in production answers. These tests drive the REAL production entry
// shape — an HTTP POST to the streaming chat router with the client
// bridge's `alterEgoMode: true` marker — and inspect the exact system
// instructions the router hands to the provider layer, one per route.
// The persona marker is the head of buildAlterEgoInstruction().

const PERSONA_MARKER = "Alter-ego mode";

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

type CapturedRequest = {
  systemInstruction?: string;
  cloudflareSystemInstruction?: string;
  groqSystemInstruction?: string;
};

function appWith(streamExecute: OriginProviderStreamExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-key" },
    streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-alter-ego-diagnosis",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

async function captureProviderRequest(body: Record<string, unknown>): Promise<CapturedRequest> {
  let seen: CapturedRequest | undefined;
  const streamExecute = vi.fn(async (providerRequest, handlers) => {
    seen = providerRequest as CapturedRequest;
    handlers.onDelta("回答");
    return result("回答");
  }) as unknown as OriginProviderStreamExecutor;
  const response = await request(appWith(streamExecute))
    .post("/api/chat")
    .set("Accept", "text/event-stream")
    .send(body);
  expect(response.status).toBe(200);
  expect(streamExecute).toHaveBeenCalledTimes(1);
  if (!seen) throw new Error("provider request was not captured");
  return seen;
}

// A plain direct-path request (the router's own tests use the same
// text): it stays on the streaming chat path instead of being
// delegated to the research route, which is what this file isolates.
const casualMessage = { messages: [{ role: "user", content: "短い案内文を作ってください" }] };

describe("alter-ego mode through the production streaming chat path", () => {
  it("propagates the client marker into the full instruction (enterWith path)", async () => {
    const seen = await captureProviderRequest({ ...casualMessage, alterEgoMode: true });
    expect(seen.systemInstruction).toContain(PERSONA_MARKER);
  });

  it("carries the persona into the Cloudflare (route-2) instruction", async () => {
    const seen = await captureProviderRequest({ ...casualMessage, alterEgoMode: true });
    expect(seen.cloudflareSystemInstruction).toContain(PERSONA_MARKER);
  });

  it("carries the persona into the Groq (route-3) instruction", async () => {
    const seen = await captureProviderRequest({ ...casualMessage, alterEgoMode: true });
    expect(seen.groqSystemInstruction).toContain(PERSONA_MARKER);
  });

  it("keeps every route instruction persona-free while the mode is off", async () => {
    const seen = await captureProviderRequest({ ...casualMessage });
    expect(seen.systemInstruction).not.toContain(PERSONA_MARKER);
    expect(seen.cloudflareSystemInstruction).not.toContain(PERSONA_MARKER);
    expect(seen.groqSystemInstruction).not.toContain(PERSONA_MARKER);
  });
});

describe("route-3 instruction contract for alter-ego mode (diagnosis §8)", () => {
  it("carries the compact persona within the 6,700-character cap, without the polite-register default", () => {
    const on = originGroqRouteSystemInstruction(undefined, { alterEgo: true });
    expect(on).toContain(PERSONA_MARKER);
    expect(on.length).toBeLessThanOrEqual(6_700);
    expect(on).not.toContain("use the polite desu/masu register by default");
  });

  it("is byte-identical to the pre-fix output while the mode is off", () => {
    const off = originGroqRouteSystemInstruction();
    expect(originGroqRouteSystemInstruction(undefined, { alterEgo: false })).toBe(off);
    expect(originGroqRouteSystemInstruction(undefined, {})).toBe(off);
    expect(off).toContain("in Japanese, use the polite desu/masu register by default");
    expect(off).not.toContain(PERSONA_MARKER);
  });
});

describe("alter-ego mode on the grounded-research synthesis path", () => {
  it("carries the persona into the research synthesis instruction while the mode is on", () => {
    const instruction = withAlterEgoMode(true, () => buildGroundedResearchSynthesisInstruction("ja", []));
    expect(instruction).toContain(PERSONA_MARKER);
  });
});
