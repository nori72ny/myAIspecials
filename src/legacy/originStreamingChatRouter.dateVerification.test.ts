import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { type OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring test for the date/weekday verification gate (streaming
// direct path), using the real H-07 case from the fixed-100 round-4
// measurement: shadow mode delivers the stream unchanged and logs the
// detection; enforce mode buffers a date-bearing question's stream
// and delivers the corrected text; enforce mode leaves a question
// without date material streaming (detection-logged only).

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

function appWith(streamExecute: OriginProviderStreamExecutor, env: Record<string, string>) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env,
    streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-date-verification-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

function streamerWith(text: string): OriginProviderStreamExecutor {
  return vi.fn(async (_providerRequest, handlers) => {
    // Emit in two chunks so buffering behaviour is observable.
    const half = Math.ceil(text.length / 2);
    handlers.onDelta(text.slice(0, half));
    handlers.onDelta(text.slice(half));
    return result(text);
  }) as unknown as OriginProviderStreamExecutor;
}

const H07_QUESTION = "2026年11月7日の45日後は、何月何日で何曜日ですか？";
const H07_ANSWER =
  "2026年12月23日（火曜日）が45日後です。  \n\n**ポイント**  \n- 2026年11月7日から23日で11月30日まで。  \n- 残り22日で12月23日になる。  \n- 2026年11月7日は土曜日。45日後は3日後 → 火曜日。";
const H07_CORRECTED =
  "2026年12月22日（火曜日）が45日後です。  \n\n**ポイント**  \n- 2026年11月7日から23日で11月30日まで。  \n- 残り22日で12月22日になる。  \n- 2026年11月7日は土曜日。45日後は3日後 → 火曜日。";

function gateCall(infoSpy: ReturnType<typeof vi.spyOn>, marker: string) {
  return infoSpy.mock.calls.find(([message]) => String(message).includes(marker));
}

describe("date/weekday verification gate (streaming router)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shadow mode (default) delivers the stream unchanged and logs the detection", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWith(streamerWith(H07_ANSWER), { OPENROUTER_API_KEY: "synthetic-key" }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: H07_QUESTION }] });

    expect(response.status).toBe(200);
    expect(response.text).toContain("2026年12月23日（火曜日）が45日後です");
    const call = gateCall(infoSpy, "date weekday verification (shadow)");
    expect(call).toBeDefined();
    const fields = call?.[1] as Record<string, unknown>;
    expect(fields.dateVerificationRelativeMismatchCount).toBe(1);
    expect(fields.dateVerificationWeekdayMismatchCount).toBe(1);
    expect(fields.dateVerificationCorrectedCount).toBe(0);
    expect(JSON.stringify(fields)).not.toContain("12月23日");
  });

  it("enforce mode buffers a date-bearing question and delivers the corrected text", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request(appWith(streamerWith(H07_ANSWER), {
      OPENROUTER_API_KEY: "synthetic-key",
      ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE: "enforce",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: H07_QUESTION }] });

    expect(response.status).toBe(200);
    expect(response.text).toContain("2026年12月22日（火曜日）が45日後です");
    expect(response.text).not.toContain("12月23日");
    const call = gateCall(infoSpy, "date weekday verification (enforce)");
    expect(call).toBeDefined();
    const fields = call?.[1] as Record<string, unknown>;
    expect(fields.dateVerificationCorrectedCount).toBe(2);
  });

  it("enforce mode leaves a non-date question streaming and only logs the detection", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const answer = "例として、2026年12月23日（火曜日）のような書き方をします。";
    const response = await request(appWith(streamerWith(answer), {
      OPENROUTER_API_KEY: "synthetic-key",
      ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE: "enforce",
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "手紙の書き出しの例を教えてください。" }] });

    expect(response.status).toBe(200);
    // Not buffered, not rewritten: the wrong weekday streams as-is,
    // in the two raw chunks the executor produced (no single
    // consolidated delta, and no corrected weekday anywhere).
    expect(response.text).toContain("2026年12月23日（");
    expect(response.text).toContain("火曜日）のような書き方をします。");
    expect(response.text).not.toContain("水曜日");
    // …but the shadow hook still records the mismatch.
    const call = gateCall(infoSpy, "date weekday verification (shadow)");
    expect(call).toBeDefined();
    const fields = call?.[1] as Record<string, unknown>;
    expect(fields.dateVerificationWeekdayMismatchCount).toBe(1);
    expect(fields.dateVerificationCorrectedCount).toBe(0);
  });
});
