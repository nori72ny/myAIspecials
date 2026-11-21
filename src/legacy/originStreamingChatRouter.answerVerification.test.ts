import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import type { OriginAnswerVerificationResult } from "./originAnswerVerification";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import type { OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

// Wiring tests for answer verification V-PR-3 (streaming router,
// shadow): mode off reproduces the pre-feature stream exactly; shadow
// verifies targeted answers through the injected seam after the
// stream completes, never changes the delivered delta bytes, carries
// the metadata block on the completion event only, arms the class-A
// core into the buffered set (the same progressive-display trade-off
// the existing gates make), and fails open when verification breaks.

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;

const PLAIN_QUESTION = "富士山の高さはどれくらいですか。";
const PLAIN_ANSWER = "富士山の標高は3,776メートルです。";
const REVIEW_QUESTION = "二重確認してください。手紙の書き出しの例を教えてください。";
const REVIEW_ANSWER = "拝啓　時下ますますご清栄のこととお慶び申し上げます。";
const FABRICATED_LAW_ANSWER = "デジタル資産保護法は2021年4月1日から施行されました。登録手数料は16,000円です。";
const DECK_PROMPT = "営業部向けに、業務効率化ツールの導入を提案する提案資料を作ってください。スライド形式でお願いします。";

const CLOUDFLARE_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const GROQ_MODEL = "openai/gpt-oss-120b";

type VerifyStub = (input: unknown, options: unknown) => Promise<OriginAnswerVerificationResult>;

function resultWith(text: string, servedModel: string, provider: string, attempt: number): OriginProviderExecutionResult {
  return {
    text,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: {
      requestedModel: servedModel,
      servedModel,
      strategy: "verified-free-failover",
      provider,
      attempt,
      fallbackUsed: true,
    },
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costUsd: 0 },
  };
}

const cloudflareServed = (text: string) => resultWith(text, CLOUDFLARE_MODEL, "Cloudflare", 2);
const groqServed = (text: string) => resultWith(text, GROQ_MODEL, "Groq", 3);

function completedVerdicts(
  overrides: Partial<Extract<OriginAnswerVerificationResult, { status: "completed" }>> = {},
): OriginAnswerVerificationResult {
  return {
    status: "completed",
    servedRoute: "cloudflare",
    verifierRoute: "groq",
    servedModel: CLOUDFLARE_MODEL,
    verifierModel: GROQ_MODEL,
    claims: [{ index: 1, verdict: "supported" }],
    unjudgedClaimCount: 0,
    verdictCounts: { supported: 1, unsupported: 0, contradicted: 0, uncertain: 0 },
    answerTruncated: false,
    durationMs: 100,
    transportRequestCount: 1,
    ...overrides,
  };
}

function groqServedVerdicts(): OriginAnswerVerificationResult {
  return completedVerdicts({
    servedRoute: "groq",
    verifierRoute: "cloudflare",
    servedModel: GROQ_MODEL,
    verifierModel: CLOUDFLARE_MODEL,
    transportRequestCount: 2,
    neurons: 35,
  });
}

function appWith(options: {
  streamExecute: OriginProviderStreamExecutor;
  env?: NodeJS.ProcessEnv;
  verify?: VerifyStub;
  readDailyNeuronsUsed?: () => Promise<number | null>;
  now?: () => number;
}) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env: options.env ?? { OPENROUTER_API_KEY: "synthetic-key" },
    streamExecute: options.streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-answer-verification-test",
    ...(options.now ? { now: options.now } : {}),
    ...(options.verify
      ? {
          answerVerification: {
            verify: options.verify as never,
            readDailyNeuronsUsed: options.readDailyNeuronsUsed ?? (async () => null),
          },
        }
      : {}),
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

function streamOf(deltas: readonly string[], result: OriginProviderExecutionResult): OriginProviderStreamExecutor {
  return vi.fn(async (_providerRequest, handlers) => {
    for (const delta of deltas) handlers.onDelta(delta);
    return result;
  }) as unknown as OriginProviderStreamExecutor;
}

function deltaLines(body: string): string[] {
  return body.split("\n").filter((line) => line.startsWith('data: {"type":"delta"'));
}

function deltaText(body: string): string {
  return deltaLines(body)
    .map((line) => (JSON.parse(line.slice("data: ".length)) as { text: string }).text)
    .join("");
}

function completeEvent(body: string): Record<string, unknown> {
  const line = body.split("\n").find((entry) => entry.startsWith('data: {"type":"complete"'));
  expect(line).toBeDefined();
  return JSON.parse((line as string).slice("data: ".length)) as Record<string, unknown>;
}

function verificationLogFields(infoSpy: ReturnType<typeof vi.spyOn>): Record<string, unknown> | undefined {
  const call = infoSpy.mock.calls.find(([message]) => String(message).includes("answer verification"));
  return call?.[1] as Record<string, unknown> | undefined;
}

const SHADOW_ENV = { OPENROUTER_API_KEY: "synthetic-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" };

describe("answer verification shadow wiring — streaming path (V-PR-3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mode off (default): the seam is never called and the stream is the pre-feature stream", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(appWith({
      streamExecute: streamOf(["富士山の標高は", "3,776メートルです。"], cloudflareServed(PLAIN_ANSWER)),
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });

    expect(response.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    expect(response.text).not.toContain("answerVerification");
    expect(deltaText(response.text)).toBe(PLAIN_ANSWER);
    expect(response.text).toContain(`data: {"type":"complete","modelId":"${evidence.modelId}","servedModel":"${CLOUDFLARE_MODEL}","costEvidenceStatus":"NOT_MEASURED","fallbackUsed":true}`);
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
  });

  it("shadow class B: verification fires on the delivered text and the delta bytes are identical to mode off", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const seenInputs: unknown[] = [];
    const verify = vi.fn(async (input: unknown) => {
      seenInputs.push(input);
      return completedVerdicts();
    });
    const deltas = ["富士山の標高は", "3,776メートルです。"];

    const offResponse = await request(appWith({
      streamExecute: streamOf(deltas, cloudflareServed(PLAIN_ANSWER)),
      verify: vi.fn(async () => completedVerdicts()),
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });
    expect(offResponse.status).toBe(200);

    const shadowResponse = await request(appWith({
      streamExecute: streamOf(deltas, cloudflareServed(PLAIN_ANSWER)),
      env: SHADOW_ENV,
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });
    expect(shadowResponse.status).toBe(200);

    // The delivered answer bytes are the mode-off bytes, delta for delta.
    expect(deltaLines(shadowResponse.text)).toEqual(deltaLines(offResponse.text));
    expect(deltaText(shadowResponse.text)).toBe(PLAIN_ANSWER);
    // The check ran once, on the exact delivered text.
    expect(verify).toHaveBeenCalledTimes(1);
    expect(seenInputs[0]).toMatchObject({ question: PLAIN_QUESTION, answerText: PLAIN_ANSWER });
    // The metadata block rides the completion event (and only there).
    expect(completeEvent(shadowResponse.text).answerVerification).toMatchObject({
      verificationMode: "shadow",
      verificationConfiguredMode: "shadow",
      verificationClass: "B",
      verificationPath: "direct",
      verificationStatus: "completed",
      servedRoute: "cloudflare",
      verifierRoute: "groq",
      verdictSupported: 1,
      wouldBeAction: "none",
      appliedAction: "none",
    });
    expect(completeEvent(offResponse.text).answerVerification).toBeUndefined();
    // The structured log carries the same fields and never the answer text.
    const fields = verificationLogFields(infoSpy);
    expect(fields).toBeDefined();
    expect(fields?.verificationStatus).toBe("completed");
    expect(JSON.stringify(fields)).not.toContain(PLAIN_ANSWER);
  });

  it("shadow class A: a review-required answer is verified as class A, bytes unchanged", async () => {
    const verify = vi.fn(async () => groqServedVerdicts());
    const response = await request(appWith({
      streamExecute: streamOf(["拝啓　時下ますます", "ご清栄のこととお慶び申し上げます。"], groqServed(REVIEW_ANSWER)),
      env: SHADOW_ENV,
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: REVIEW_QUESTION }] });

    expect(response.status).toBe(200);
    expect(deltaText(response.text)).toBe(REVIEW_ANSWER);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(completeEvent(response.text).answerVerification).toMatchObject({
      verificationClass: "A",
      verificationStatus: "completed",
      servedRoute: "groq",
      verifierRoute: "cloudflare",
    });
  });

  it("shadow class A arming: a review-required answer is buffered like a gated one; mode off streams it incrementally", async () => {
    // Fake clock: the executor advances time between deltas, so the
    // completion log's firstDeltaMs shows whether the first delta was
    // released during generation (incremental) or only at completion
    // (buffered — the trade-off the existing gates make).
    const run = async (env: NodeJS.ProcessEnv) => {
      let t = 1_000;
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      try {
        const streamExecute = vi.fn(async (_providerRequest, handlers) => {
          handlers.onDelta("拝啓　時下ますます");
          t += 500;
          handlers.onDelta("ご清栄のこととお慶び申し上げます。");
          t += 500;
          return groqServed(REVIEW_ANSWER);
        }) as unknown as OriginProviderStreamExecutor;
        const response = await request(appWith({
          streamExecute,
          env,
          verify: vi.fn(async () => groqServedVerdicts()),
          now: () => t,
        }))
          .post("/api/chat")
          .set("Accept", "text/event-stream")
          .send({ messages: [{ role: "user", content: REVIEW_QUESTION }] });
        expect(response.status).toBe(200);
        expect(deltaText(response.text)).toBe(REVIEW_ANSWER);
        const completed = infoSpy.mock.calls
          .filter((call) => call[0] === "[origin-chat] upstream stream completed")
          .map((call) => call[1] as Record<string, unknown>);
        expect(completed).toHaveLength(1);
        return completed[0];
      } finally {
        infoSpy.mockRestore();
      }
    };

    const off = await run({ OPENROUTER_API_KEY: "synthetic-key" });
    expect(off.firstDeltaMs).toBe(0);
    expect(off.durationMs).toBe(1_000);
    expect(off.answerVerification).toBeUndefined();

    const shadow = await run(SHADOW_ENV);
    expect(shadow.firstDeltaMs).toBe(1_000);
    expect(shadow.answerVerification).toMatchObject({ verificationClass: "A" });
  });

  it("shadow class A: a publication-gate firing answer is a target even without a review requirement", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(appWith({
      streamExecute: streamOf([FABRICATED_LAW_ANSWER], cloudflareServed(FABRICATED_LAW_ANSWER)),
      env: SHADOW_ENV,
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "手紙の書き出しの例を教えてください。" }] });

    expect(response.status).toBe(200);
    // The gate is in shadow here, so the answer itself is delivered as-is.
    expect(deltaText(response.text)).toBe(FABRICATED_LAW_ANSWER);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(completeEvent(response.text).answerVerification).toMatchObject({ verificationClass: "A" });
  });

  it("a held answer (publication gate enforce) is not a verification target", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(appWith({
      streamExecute: streamOf(["衆議院は465名、参議院は245名です。"], cloudflareServed("衆議院は465名、参議院は245名です。")),
      env: { ...SHADOW_ENV, ORIGIN_PUBLICATION_GATE_MODE: "enforce" },
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "国会の衆議院と参議院の議員定数はそれぞれ何人ですか？" }] });

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("245名");
    expect(verify).not.toHaveBeenCalled();
    expect(completeEvent(response.text).answerVerification).toBeUndefined();
  });

  it("enforce value behaves as shadow in V-PR-3 (configured mode recorded, nothing applied)", async () => {
    const verify = vi.fn(async () => completedVerdicts({
      claims: [{ index: 1, verdict: "contradicted", corrected: "富士山の標高は3,776メートルです。" }],
      verdictCounts: { supported: 0, unsupported: 0, contradicted: 1, uncertain: 0 },
    }));
    const response = await request(appWith({
      streamExecute: streamOf([PLAIN_ANSWER], cloudflareServed(PLAIN_ANSWER)),
      env: { OPENROUTER_API_KEY: "synthetic-key", ORIGIN_ANSWER_VERIFICATION_MODE: "enforce" },
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });

    expect(response.status).toBe(200);
    expect(deltaText(response.text)).toBe(PLAIN_ANSWER);
    expect(completeEvent(response.text).answerVerification).toMatchObject({
      verificationMode: "shadow",
      verificationConfiguredMode: "enforce",
      appliedAction: "none",
    });
  });

  it("fails open when the verification seam throws: the stream completes and the not-run is recorded", async () => {
    const verify = vi.fn(async () => { throw new Error("seam failure"); });
    const response = await request(appWith({
      streamExecute: streamOf([PLAIN_ANSWER], cloudflareServed(PLAIN_ANSWER)),
      env: SHADOW_ENV,
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });

    expect(response.status).toBe(200);
    expect(deltaText(response.text)).toBe(PLAIN_ANSWER);
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
    expect(completeEvent(response.text).answerVerification).toMatchObject({
      verificationStatus: "not-run",
      verificationFailureKind: "provider-error",
    });
  });

  it("fails open on a not-run verdict (rate limited): the answer is delivered unchanged and the kind is recorded", async () => {
    const verify = vi.fn(async () => ({
      status: "not-run",
      failureKind: "rate-limited",
      servedRoute: "cloudflare",
      verifierRoute: "groq",
      durationMs: 30,
    }) as OriginAnswerVerificationResult);
    const response = await request(appWith({
      streamExecute: streamOf([PLAIN_ANSWER], cloudflareServed(PLAIN_ANSWER)),
      env: SHADOW_ENV,
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });

    expect(response.status).toBe(200);
    expect(deltaText(response.text)).toBe(PLAIN_ANSWER);
    expect(completeEvent(response.text).answerVerification).toMatchObject({
      verificationStatus: "not-run",
      verificationFailureKind: "rate-limited",
    });
  });

  it("ledger counting: a Cloudflare-verified check is counted from the usage counter delta, not the reported figure", async () => {
    const readings = [1_000, 1_042];
    const readDailyNeuronsUsed = vi.fn(async () => readings.shift() ?? null);
    const verify = vi.fn(async () => groqServedVerdicts());
    const response = await request(appWith({
      streamExecute: streamOf([PLAIN_ANSWER], groqServed(PLAIN_ANSWER)),
      env: SHADOW_ENV,
      verify,
      readDailyNeuronsUsed,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });

    expect(response.status).toBe(200);
    expect(readDailyNeuronsUsed).toHaveBeenCalledTimes(2);
    // The counter moved 42 (the call's reported 35 is inside it); the
    // delta is the count, per the W-1 discipline.
    expect(completeEvent(response.text).answerVerification).toMatchObject({
      neuronsDelta: 42,
      neuronsCountSource: "counter-delta",
    });
  });

  it("deck paths stay out of scope: a proposal-deck request is never verified", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(appWith({
      streamExecute: streamOf(["提案の本文です。"], cloudflareServed("提案の本文です。")),
      env: SHADOW_ENV,
      verify,
    }))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: DECK_PROMPT }] });

    expect(response.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    expect(completeEvent(response.text).answerVerification).toBeUndefined();
  });
});
