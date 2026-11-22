import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import type { OriginProviderExecutionRequest } from "./originProviderClient";

// Wiring test for the intent premise guard PR2 additions
// (non-streaming direct path): the ledger block injection
// (design section 3.2) and the shadow log's plan fields (3.3).
// Shadow injection changes only what the model is told — the
// delivered answer stays byte-identical, including on the REP-02
// case whose answer still violates C-1 (intervention is PR3).
// Mode off computes no plan: the three route instructions are
// byte-identical to a shadow run on a ledger-free conversation.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
/** Inside the stable-fact registry's evidence window. */
const guardNow = () => Date.parse("2026-11-22T00:00:00.000Z");

function createApp(execute: OriginChatExecutor, env: Record<string, string>) {
  const app = express();
  app.use(express.json());
  const research: OriginResearchExecutor = async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } });
  app.use(createOriginChatRouter({
    env,
    execute,
    research,
    researchSynthesis: null,
    catalogNow: () => verifiedCatalogTime,
    now: guardNow,
    createRequestId: () => "origin-premise-guard-pr2-test",
  }));
  return app;
}

function capturingExecutor(text: string, seen: OriginProviderExecutionRequest[]): OriginChatExecutor {
  return vi.fn(async (providerRequest: OriginProviderExecutionRequest) => {
    seen.push(providerRequest);
    return {
      text,
      transportRequestCount: 1,
      actualCostUsd: 0 as const,
      providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
      routingEvidence: { requestedModel: verifiedEvidence.modelId, servedModel: verifiedEvidence.modelId, strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
    };
  }) as unknown as OriginChatExecutor;
}

function guardCall(infoSpy: ReturnType<typeof vi.spyOn>) {
  return infoSpy.mock.calls.find(([message]) =>
    String(message).includes("intent premise guard"),
  );
}

const REP02_MESSAGES = [
  { role: "user", content: "イベントの企画を考えています。参加者は50人想定で、会場の広さを相談したい。" },
  { role: "assistant", content: "50名規模の会場をご案内します。" },
  { role: "user", content: "訂正します。参加者は30人でした。その前提で会場の広さを教えて。" },
  { role: "assistant", content: "30名前提でご案内します。" },
  { role: "user", content: "50人だと椅子は何脚いるかな。" },
];
const REP02_ANSWER = "**椅子の必要数**\n- 参加者 50 名 → 50 脚\n- 余裕として 2〜3 脚を追加すると 52〜53 脚が推奨されます。";

const FP02_MESSAGES = [
  { role: "user", content: "消費税が15%に上がったから、その前提で税抜8,000円の商品の税込価格を計算して。" },
];
const FP02_ANSWER = "承知いたしました。消費税率15%で計算します。\n\n- 税込価格：9,200円";

const PLAIN_MESSAGES = [
  { role: "user", content: "短い案内文を作ってください" },
];
const PLAIN_ANSWER = "ご案内いたします。";

const BLOCK_LINE = "- 参加者：30人（50人から訂正済み）";

describe("intent premise guard PR2 injection (non-streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shadow mode appends the ledger block to all three route instructions and logs the plan", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const seen: OriginProviderExecutionRequest[] = [];
    const response = await request(createApp(capturingExecutor(REP02_ANSWER, seen), {
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    }))
      .post("/api/chat")
      .send({ messages: REP02_MESSAGES });

    expect(response.status).toBe(200);
    // The delivered answer is unchanged (shadow never intervenes).
    expect(response.body.content).toBe(REP02_ANSWER);
    expect(seen).toHaveLength(1);
    const providerRequest = seen[0];
    for (const instruction of [
      providerRequest.systemInstruction,
      providerRequest.cloudflareSystemInstruction,
      providerRequest.groqSystemInstruction,
    ]) {
      expect(instruction).toBeDefined();
      expect(instruction!.endsWith(BLOCK_LINE)).toBe(true);
      expect(instruction!.split("確定前提").length - 1).toBe(1);
    }
    const fields = guardCall(infoSpy)?.[1] as Record<string, unknown>;
    expect(fields.premiseGuardBlockInjected).toBe(true);
    expect(fields.premiseGuardBlockChars).toBeGreaterThan(BLOCK_LINE.length);
    expect(fields.premiseGuardArmed).toBe(true);
    expect(fields.premiseGuardArmingReasons).toEqual(["ledger-correction"]);
    // PR1 detection still logged on the same answer.
    expect(fields.violationOldValueReuse).toBe(1);
  });

  it("mode off appends nothing and runs no guard", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const seen: OriginProviderExecutionRequest[] = [];
    const response = await request(createApp(capturingExecutor(REP02_ANSWER, seen), {
      OPENROUTER_API_KEY: "test-openrouter-key",
    }))
      .post("/api/chat")
      .send({ messages: REP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(REP02_ANSWER);
    const providerRequest = seen[0];
    for (const instruction of [
      providerRequest.systemInstruction,
      providerRequest.cloudflareSystemInstruction,
      providerRequest.groqSystemInstruction,
    ]) {
      expect(instruction).not.toContain("確定前提");
    }
    expect(guardCall(infoSpy)).toBeUndefined();
  });

  it("shadow mode on a ledger-free conversation leaves the instructions byte-identical to mode off", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const seenShadow: OriginProviderExecutionRequest[] = [];
    await request(createApp(capturingExecutor(PLAIN_ANSWER, seenShadow), {
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    }))
      .post("/api/chat")
      .send({ messages: PLAIN_MESSAGES });
    const seenOff: OriginProviderExecutionRequest[] = [];
    await request(createApp(capturingExecutor(PLAIN_ANSWER, seenOff), {
      OPENROUTER_API_KEY: "test-openrouter-key",
    }))
      .post("/api/chat")
      .send({ messages: PLAIN_MESSAGES });

    expect(seenShadow[0].systemInstruction).toBe(seenOff[0].systemInstruction);
    expect(seenShadow[0].cloudflareSystemInstruction).toBe(seenOff[0].cloudflareSystemInstruction);
    expect(seenShadow[0].groqSystemInstruction).toBe(seenOff[0].groqSystemInstruction);
  });

  it("shadow mode arms on a registry-concept assertion even when no block exists (FP-02)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const seen: OriginProviderExecutionRequest[] = [];
    const response = await request(createApp(capturingExecutor(FP02_ANSWER, seen), {
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    }))
      .post("/api/chat")
      .send({ messages: FP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(FP02_ANSWER);
    expect(seen[0].systemInstruction).not.toContain("確定前提");
    const fields = guardCall(infoSpy)?.[1] as Record<string, unknown>;
    expect(fields.premiseGuardBlockInjected).toBe(false);
    expect(fields.premiseGuardArmed).toBe(true);
    expect(fields.premiseGuardArmingReasons).toEqual(["registry-concept-assertion"]);
    expect(fields.violationStableFactAppliedValue).toBe(1);
  });
});
