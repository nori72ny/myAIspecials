import express from "express";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { type OriginProviderExecutionRequest, type OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring test for the intent premise guard PR2 additions
// (streaming direct path — the path the I-1 measurement runner
// uses): the ledger block injection (design section 3.2) and the
// arming decision joining the buffer-armed set (section 3.3).
// Buffering is observed directly: a two-part stream whose executor
// finishes only after a pause must reach the client incrementally
// when nothing arms it (mode off), and only after the executor has
// finished when the premise guard arms the turn (shadow). The
// delivered bytes are identical either way — shadow never alters
// the text; intervention is PR3.

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;
/** Inside the stable-fact registry's evidence window. */
const guardNow = () => Date.parse("2026-11-22T00:00:00.000Z");

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

function appWith(streamExecute: OriginProviderStreamExecutor, env: Record<string, string>) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env,
    streamExecute,
    catalogNow,
    now: guardNow,
    createRequestId: () => "origin-stream-premise-guard-pr2-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

function streamerWith(text: string, seen?: OriginProviderExecutionRequest[]): OriginProviderStreamExecutor {
  return vi.fn(async (providerRequest: OriginProviderExecutionRequest, handlers) => {
    seen?.push(providerRequest);
    const half = Math.ceil(text.length / 2);
    handlers.onDelta(text.slice(0, half));
    handlers.onDelta(text.slice(half));
    return result(text);
  }) as unknown as OriginProviderStreamExecutor;
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
const FP02_ANSWER =
  "承知いたしました。消費税率15%で計算します。\n\n- 税抜価格：8,000円\n- 消費税額：8,000円 × 0.15 = 1,200円\n- 税込価格：9,200円\n\n〔出典: 日本の消費税計算方法（税率15%）〕";

const BLOCK_LINE = "- 参加者：30人（50人から訂正済み）";

describe("intent premise guard PR2 injection + arming (streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shadow mode appends the ledger block to all three route instructions and logs the plan", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const seen: OriginProviderExecutionRequest[] = [];
    const response = await request(appWith(streamerWith(REP02_ANSWER, seen), {
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: REP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(response.text).toContain("参加者 50 名 → 50 脚");
    expect(seen).toHaveLength(1);
    for (const instruction of [
      seen[0].systemInstruction,
      seen[0].cloudflareSystemInstruction,
      seen[0].groqSystemInstruction,
    ]) {
      expect(instruction!.endsWith(BLOCK_LINE)).toBe(true);
      expect(instruction!.split("確定前提").length - 1).toBe(1);
    }
    const fields = guardCall(infoSpy)?.[1] as Record<string, unknown>;
    expect(fields.premiseGuardBlockInjected).toBe(true);
    expect(fields.premiseGuardArmed).toBe(true);
    expect(fields.premiseGuardArmingReasons).toEqual(["ledger-correction"]);
    expect(fields.violationOldValueReuse).toBe(1);
  });

  it("mode off appends nothing and runs no guard", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const seen: OriginProviderExecutionRequest[] = [];
    const response = await request(appWith(streamerWith(REP02_ANSWER, seen), {
      OPENROUTER_API_KEY: "test-openrouter-key",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: REP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(seen[0].systemInstruction).not.toContain("確定前提");
    expect(seen[0].groqSystemInstruction).not.toContain("確定前提");
    expect(guardCall(infoSpy)).toBeUndefined();
  });

  it("shadow mode arms on a registry-concept assertion even when no block exists (FP-02)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const seen: OriginProviderExecutionRequest[] = [];
    const response = await request(appWith(streamerWith(FP02_ANSWER, seen), {
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: FP02_MESSAGES });

    expect(response.status).toBe(200);
    expect(seen[0].systemInstruction).not.toContain("確定前提");
    const fields = guardCall(infoSpy)?.[1] as Record<string, unknown>;
    expect(fields.premiseGuardBlockInjected).toBe(false);
    expect(fields.premiseGuardArmed).toBe(true);
    expect(fields.premiseGuardArmingReasons).toEqual(["registry-concept-assertion"]);
    expect(fields.violationStableFactAppliedValue).toBe(1);
  });

  it("an armed turn is buffered until the executor finishes; the same turn streams incrementally with mode off", async () => {
    const run = async (env: Record<string, string>) => {
      const state = { finished: false, sawDataBeforeFinish: false };
      const streamExecute = vi.fn(async (_providerRequest: OriginProviderExecutionRequest, handlers) => {
        handlers.onDelta("前半の回答です。");
        await new Promise((resolve) => setTimeout(resolve, 30));
        handlers.onDelta("後半の回答です。");
        state.finished = true;
        return result("前半の回答です。後半の回答です。");
      }) as unknown as OriginProviderStreamExecutor;
      const server = appWith(streamExecute, env).listen(0);
      try {
        const port = (server.address() as AddressInfo).port;
        const body = await new Promise<string>((resolve, reject) => {
          const req = http.request(
            {
              host: "127.0.0.1",
              port,
              path: "/api/chat",
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            },
            (res) => {
              let text = "";
              res.on("data", (chunk: Buffer) => {
                if (!state.finished) state.sawDataBeforeFinish = true;
                text += chunk.toString("utf8");
              });
              res.on("end", () => resolve(text));
            },
          );
          req.on("error", reject);
          req.end(JSON.stringify({ messages: REP02_MESSAGES }));
        });
        return { state, body };
      } finally {
        server.close();
      }
    };

    const armed = await run({
      OPENROUTER_API_KEY: "test-openrouter-key",
      ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
    });
    expect(armed.state.finished).toBe(true);
    expect(armed.state.sawDataBeforeFinish).toBe(false);
    expect(armed.body).toContain("前半の回答です。");
    expect(armed.body).toContain("後半の回答です。");

    const unarmed = await run({ OPENROUTER_API_KEY: "test-openrouter-key" });
    expect(unarmed.state.finished).toBe(true);
    expect(unarmed.state.sawDataBeforeFinish).toBe(true);
    expect(unarmed.body).toContain("前半の回答です。");
    expect(unarmed.body).toContain("後半の回答です。");
  });
});
