import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { withAlterEgoMode } from "../lib/orchestration/alterEgoRequestStore";
import { buildGroundedResearchAbstainAnswer } from "../research/groundedResearchOutcome";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

// Reproduction (2026-11-28, production check after PR #1570): with
// alter-ego mode ON, a research request whose source retrieval fails
// still landed on the POLITE tier-T4 hold text in production, while
// the generated synthesis answers spoke plainly. The builder itself
// switches register off the request-scoped store, so these tests
// drive the real chat-router path — an HTTP POST carrying the client
// bridge's `alterEgoMode: true` marker, with the research executor
// forced into the production failure shape — instead of setting the
// store around the builder directly.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const PRODUCTION_QUERY = "今日の主なニュースを3つ教えて";

const failingResearch = vi.fn().mockResolvedValue({
  ok: false,
  sources: [],
  failure: { stage: "web-search", code: "NETWORK_FAILURE" },
}) as unknown as OriginResearchExecutor;

function createChatApp(research: OriginResearchExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: vi.fn() as unknown as OriginChatExecutor,
    research,
    researchSynthesis: vi.fn() as unknown as OriginChatExecutor,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-alter-ego-abstain",
  }));
  return app;
}

function expectedAbstain(mode: boolean): string {
  return withAlterEgoMode(mode, () => buildGroundedResearchAbstainAnswer({
    query: PRODUCTION_QUERY,
    language: "ja",
    reason: "provider-error",
  }));
}

describe("alter-ego mode on the grounded-research hold (chat router path)", () => {
  it("lands on the plain-register hold when source retrieval fails with the mode on", async () => {
    const response = await request(createChatApp(failingResearch))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: PRODUCTION_QUERY }], alterEgoMode: true });
    expect(response.status).toBe(200);
    expect(response.body.routing.researchOutcome).toBe("ABSTAIN");
    expect(response.body.routing.researchAbstainReason).toBe("provider-error");
    expect(response.body.content).toBe(expectedAbstain(true));
    expect(response.body.content).toContain("推測では答えない");
    expect(response.body.content).toContain("出典を確認できなかった");
    expect(response.body.content).not.toContain("推測で回答しません");
    expect(response.body.content).not.toContain("出典を確認できませんでした");
    expect(response.body.content).not.toContain("ご確認ください");
  });

  it("keeps the polite hold byte-identical while the mode is off", async () => {
    const response = await request(createChatApp(failingResearch))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: PRODUCTION_QUERY }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.researchOutcome).toBe("ABSTAIN");
    expect(response.body.content).toBe(expectedAbstain(false));
    expect(response.body.content).toContain("推測で回答しません");
    expect(response.body.content).toContain("出典を確認できませんでした");
  });

  it("streams the plain-register hold on the phased SSE path with the mode on", async () => {
    const response = await request(createChatApp(failingResearch))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PRODUCTION_QUERY }], alterEgoMode: true });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    let text = "";
    let completeSeen = false;
    for (const block of response.text.split("\n\n")) {
      const line = block.trim();
      if (!line.startsWith("data:")) continue;
      const raw = line.slice("data:".length).trim();
      if (raw === "[DONE]") continue;
      const event = JSON.parse(raw) as { type: string; text?: string };
      if (event.type === "delta" && typeof event.text === "string") text += event.text;
      if (event.type === "complete") completeSeen = true;
    }
    expect(completeSeen).toBe(true);
    expect(text).toBe(expectedAbstain(true));
    expect(text).not.toContain("推測で回答しません");
  });
});
