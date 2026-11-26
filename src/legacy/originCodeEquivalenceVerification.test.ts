import { describe, expect, it, vi } from "vitest";
import {
  ORIGIN_CLOUDFLARE_FREE_MODEL,
} from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import {
  ORIGIN_GROQ_FREE_MODEL_ID,
} from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import type { OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient.js";
import type { OriginCloudflareExecutionOptions } from "./originCloudflareProviderClient.js";
import type { OriginGroqExecutionOptions } from "./originGroqProviderClient.js";
import {
  buildOriginCodeEquivalenceVerificationPayload,
  classifyOriginCodeEquivalenceTarget,
  extractOriginCodeFences,
  parseOriginCodeEquivalenceVerdict,
  resolveOriginCodeEquivalenceVerificationEffectiveMode,
  resolveOriginCodeEquivalenceVerificationMode,
  runOriginCodeEquivalenceVerificationShadow,
  verifyOriginCodeEquivalenceCrossRoute,
  type OriginCodeEquivalenceVerificationResult,
} from "./originCodeEquivalenceVerification.js";

// Unit tests for the B-1 code-equivalence verification module
// (CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27 sections 4.3/6): mode
// resolution, the deterministic target classifier, payload caps,
// the verdict protocol (including the non-equivalent downgrade),
// the cross-route call over injected executors, and the shadow
// runner's metadata contract. The E-05 shape — an outer-join
// original, an inner-join main replacement, and a same-result
// claim — is the canonical targeted fixture.

const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");

const E05_MESSAGE = [
  "次のSQLコードをレビューして、問題があれば修正してください。",
  "",
  "```sql",
  "SELECT o.id, COALESCE(SUM(i.price * i.qty), 0) AS total",
  "FROM orders o",
  "LEFT JOIN items i ON i.order_id = o.id",
  "GROUP BY o.id",
  "```",
].join("\n");

const E05_ANSWER = [
  "主コードはこちらです。",
  "",
  "```sql",
  "SELECT o.id, SUM(i.price * i.qty) AS total",
  "FROM orders o",
  "JOIN items i ON i.order_id = o.id",
  "GROUP BY o.id",
  "```",
  "",
  "結果は同じです。",
].join("\n");

function sourcePlanStub(): OriginExecutionPlan {
  return {
    taskType: "chat",
    capabilityDecision: { capability: "chat" },
    timeoutMs: 20_000,
  } as unknown as OriginExecutionPlan;
}

function generationResult(servedModel: string): OriginProviderExecutionResult {
  return {
    text: "生成された回答です。",
    transportRequestCount: 1,
    actualCostUsd: 0,
    routingEvidence: {
      requestedModel: servedModel,
      servedModel,
      strategy: "verified-free-failover",
      provider: "test",
      attempt: 2,
      fallbackUsed: true,
    },
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, costUsd: 0 },
  } as unknown as OriginProviderExecutionResult;
}

function verifierResult(text: string, servedModel: string): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 3,
    actualCostUsd: 0,
    routingEvidence: {
      requestedModel: servedModel,
      servedModel,
      strategy: "verified-free-failover",
      provider: "test",
      attempt: 2,
      fallbackUsed: true,
    },
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, costUsd: 0 },
  } as unknown as OriginProviderExecutionResult;
}

type CloudflareExecutor = (
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginCloudflareExecutionOptions,
) => Promise<OriginProviderExecutionResult>;

type GroqExecutor = (
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
  fetchImpl: OriginFetch,
  options: OriginGroqExecutionOptions,
) => Promise<OriginProviderExecutionResult>;

const NON_EQUIVALENT_JSON = JSON.stringify({
  verdict: "non-equivalent",
  mainBlock: 1,
  differingCases: ["明細行のない注文が結果から落ち、合計が返らない"],
  sameResultClaimed: true,
});

describe("resolveOriginCodeEquivalenceVerificationMode", () => {
  it("defaults to off for unset and unknown values", () => {
    expect(resolveOriginCodeEquivalenceVerificationMode({})).toBe("off");
    expect(resolveOriginCodeEquivalenceVerificationMode(undefined)).toBe("off");
    expect(resolveOriginCodeEquivalenceVerificationMode({ ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "true" })).toBe("off");
    expect(resolveOriginCodeEquivalenceVerificationMode({ ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "SHADOW" })).toBe("off");
  });

  it("resolves shadow and enforce; the effective mode maps enforce to shadow", () => {
    expect(resolveOriginCodeEquivalenceVerificationMode({ ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginCodeEquivalenceVerificationMode({ ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "enforce" })).toBe("enforce");
    expect(resolveOriginCodeEquivalenceVerificationEffectiveMode({ ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "enforce" })).toBe("shadow");
    expect(resolveOriginCodeEquivalenceVerificationEffectiveMode({ ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginCodeEquivalenceVerificationEffectiveMode({})).toBe("off");
  });
});

describe("extractOriginCodeFences", () => {
  it("extracts complete fence pairs and leaves the prose", () => {
    const { blocks, prose } = extractOriginCodeFences("前\n```js\nconst a = 1;\n```\n後");
    expect(blocks).toEqual(["const a = 1;\n"]);
    expect(prose).toContain("前");
    expect(prose).toContain("後");
    expect(prose).not.toContain("const a = 1;");
  });

  it("treats an unclosed fence as prose, never as a block", () => {
    const { blocks } = extractOriginCodeFences("```js\nconst a = 1;");
    expect(blocks).toEqual([]);
  });
});

describe("classifyOriginCodeEquivalenceTarget", () => {
  it("targets the E-05 shape: fenced original, review/fix request, fenced replacement", () => {
    expect(classifyOriginCodeEquivalenceTarget({
      message: E05_MESSAGE,
      answerText: E05_ANSWER,
      publicationGateHeld: false,
    })).toEqual({ targeted: true });
  });

  it("excludes a gate-held answer before anything else", () => {
    expect(classifyOriginCodeEquivalenceTarget({
      message: E05_MESSAGE,
      answerText: E05_ANSWER,
      publicationGateHeld: true,
    })).toEqual({ targeted: false, reason: "gate-held" });
  });

  it("excludes a message without fenced original code", () => {
    expect(classifyOriginCodeEquivalenceTarget({
      message: "コードをレビューして修正してください。",
      answerText: E05_ANSWER,
      publicationGateHeld: false,
    })).toEqual({ targeted: false, reason: "no-original-code" });
  });

  it("excludes explanation-only requests: no main replacement exists to compare", () => {
    const explainMessage = [
      "次のコードを説明してください。",
      "",
      "```js",
      "const total = items.reduce((sum, item) => sum + item.price, 0);",
      "```",
    ].join("\n");
    expect(classifyOriginCodeEquivalenceTarget({
      message: explainMessage,
      answerText: E05_ANSWER,
      publicationGateHeld: false,
    })).toEqual({ targeted: false, reason: "not-review-rewrite" });
  });

  it("excludes a review request whose prose never references the supplied code", () => {
    const noReferenceMessage = [
      "直して。",
      "",
      "```js",
      "const a = 1;",
      "```",
    ].join("\n");
    expect(classifyOriginCodeEquivalenceTarget({
      message: noReferenceMessage,
      answerText: E05_ANSWER,
      publicationGateHeld: false,
    })).toEqual({ targeted: false, reason: "not-self-contained" });
  });

  it("excludes an answer without a fenced replacement", () => {
    expect(classifyOriginCodeEquivalenceTarget({
      message: E05_MESSAGE,
      answerText: "問題は結合の種類です。LEFT JOINに変えてください。",
      publicationGateHeld: false,
    })).toEqual({ targeted: false, reason: "no-replacement-code" });
  });
});

describe("buildOriginCodeEquivalenceVerificationPayload", () => {
  it("numbers the answer blocks and carries the original and the prose", () => {
    const payload = buildOriginCodeEquivalenceVerificationPayload({
      message: E05_MESSAGE,
      answerText: E05_ANSWER,
    });
    expect(payload.answerBlockCount).toBe(1);
    expect(payload.includedBlockCount).toBe(1);
    expect(payload.originalTruncated).toBe(false);
    expect(payload.blocksTruncated).toBe(false);
    expect(payload.text).toContain("LEFT JOIN items");
    expect(payload.text).toContain("[ブロック1]");
    expect(payload.text).toContain("JOIN items i ON i.order_id = o.id");
    expect(payload.text).toContain("結果は同じです。");
  });

  it("caps the original code and flags the truncation", () => {
    const bigOriginal = "x".repeat(5_000);
    const payload = buildOriginCodeEquivalenceVerificationPayload({
      message: "次のコードを修正してください。\n```\n" + bigOriginal + "\n```",
      answerText: E05_ANSWER,
    });
    expect(payload.originalTruncated).toBe(true);
    expect(payload.text).not.toContain("x".repeat(3_501));
  });

  it("caps the block count at six and flags the truncation", () => {
    const manyBlocks = Array.from({ length: 8 }, (_, i) => "```\nconst v" + i + " = 1;\n```").join("\n");
    const payload = buildOriginCodeEquivalenceVerificationPayload({
      message: E05_MESSAGE,
      answerText: manyBlocks,
    });
    expect(payload.answerBlockCount).toBe(8);
    expect(payload.includedBlockCount).toBe(6);
    expect(payload.blocksTruncated).toBe(true);
  });
});

describe("parseOriginCodeEquivalenceVerdict", () => {
  it("parses a plain verdict object", () => {
    expect(parseOriginCodeEquivalenceVerdict(NON_EQUIVALENT_JSON)).toEqual({
      ok: true,
      verdict: "non-equivalent",
      mainBlockIndex: 1,
      differingCases: ["明細行のない注文が結果から落ち、合計が返らない"],
      sameResultClaimed: true,
    });
  });

  it("parses a verdict wrapped in a code fence and prose", () => {
    const wrapped = "判定結果は次のとおりです。\n```json\n" + NON_EQUIVALENT_JSON + "\n```";
    const parsed = parseOriginCodeEquivalenceVerdict(wrapped);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.verdict).toBe("non-equivalent");
  });

  it("downgrades a non-equivalent verdict that names no differing case to uncertain", () => {
    const parsed = parseOriginCodeEquivalenceVerdict(JSON.stringify({
      verdict: "non-equivalent",
      mainBlock: 1,
      differingCases: [],
      sameResultClaimed: false,
    }));
    expect(parsed).toEqual({
      ok: true,
      verdict: "uncertain",
      mainBlockIndex: 1,
      differingCases: [],
      sameResultClaimed: false,
    });
  });

  it("caps differing cases at five and nulls an invalid mainBlock", () => {
    const parsed = parseOriginCodeEquivalenceVerdict(JSON.stringify({
      verdict: "non-equivalent",
      mainBlock: 0,
      differingCases: ["a", "b", "c", "d", "e", "f", "g"],
      sameResultClaimed: "yes",
    }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.differingCases).toEqual(["a", "b", "c", "d", "e"]);
      expect(parsed.mainBlockIndex).toBeNull();
      expect(parsed.sameResultClaimed).toBe(false);
    }
  });

  it("fails closed on empty and non-protocol output", () => {
    expect(parseOriginCodeEquivalenceVerdict("")).toEqual({ ok: false, reason: "empty-response" });
    expect(parseOriginCodeEquivalenceVerdict("判定できませんでした")).toEqual({ ok: false, reason: "verdict-parse-failure" });
    expect(parseOriginCodeEquivalenceVerdict(JSON.stringify({ verdict: "same" }))).toEqual({ ok: false, reason: "verdict-parse-failure" });
  });
});

describe("verifyOriginCodeEquivalenceCrossRoute", () => {
  it("verifies a Groq-served answer on the Cloudflare route and returns the parsed verdict", async () => {
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () =>
      verifierResult(NON_EQUIVALENT_JSON, ORIGIN_CLOUDFLARE_FREE_MODEL));
    const groqExecute = vi.fn<GroqExecutor>(async () => {
      throw new Error("the serving route must never verify itself");
    });
    const result = await verifyOriginCodeEquivalenceCrossRoute(
      {
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
        sourcePlan: sourcePlanStub(),
      },
      { nowMs: NOW_MS, cloudflareExecute, groqExecute },
    );
    expect(cloudflareExecute).toHaveBeenCalledTimes(1);
    expect(groqExecute).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.servedRoute).toBe("groq");
      expect(result.verifierRoute).toBe("cloudflare");
      expect(result.verdict).toBe("non-equivalent");
      expect(result.mainBlockIndex).toBe(1);
      expect(result.differingCases).toHaveLength(1);
      expect(result.sameResultClaimed).toBe(true);
      expect(result.transportRequestCount).toBe(3);
    }
    // The verifier receives the original, the numbered main block,
    // and the same-result claim in the answer's prose.
    const request = cloudflareExecute.mock.calls[0][0];
    expect(request.messages[0].content).toContain("LEFT JOIN items");
    expect(request.messages[0].content).toContain("[ブロック1]");
    expect(request.messages[0].content).toContain("結果は同じです。");
    expect(request.systemInstruction).toContain("主たる置き換え");
  });

  it("verifies a Cloudflare-served answer on the Groq route", async () => {
    const groqExecute = vi.fn<GroqExecutor>(async () =>
      verifierResult(JSON.stringify({ verdict: "equivalent", mainBlock: 1, differingCases: [], sameResultClaimed: true }), ORIGIN_GROQ_FREE_MODEL_ID));
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () => {
      throw new Error("the serving route must never verify itself");
    });
    const result = await verifyOriginCodeEquivalenceCrossRoute(
      {
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL),
        sourcePlan: sourcePlanStub(),
      },
      { nowMs: NOW_MS, cloudflareExecute, groqExecute },
    );
    expect(groqExecute).toHaveBeenCalledTimes(1);
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.verdict).toBe("equivalent");
      expect(result.verifierRoute).toBe("groq");
    }
  });

  it("returns unknown-served-route without calling either executor for an unidentifiable model", async () => {
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () =>
      verifierResult(NON_EQUIVALENT_JSON, ORIGIN_CLOUDFLARE_FREE_MODEL));
    const groqExecute = vi.fn<GroqExecutor>(async () =>
      verifierResult(NON_EQUIVALENT_JSON, ORIGIN_GROQ_FREE_MODEL_ID));
    const result = await verifyOriginCodeEquivalenceCrossRoute(
      {
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult("some/unknown-model"),
        sourcePlan: sourcePlanStub(),
      },
      { nowMs: NOW_MS, cloudflareExecute, groqExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "unknown-served-route" });
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(groqExecute).not.toHaveBeenCalled();
  });

  it("maps a verifier 429 to rate-limited and never throws", async () => {
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () => {
      throw new OriginProviderError("PROVIDER_RATE_LIMITED", "rate limited", 429, true);
    });
    const result = await verifyOriginCodeEquivalenceCrossRoute(
      {
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
        sourcePlan: sourcePlanStub(),
      },
      { nowMs: NOW_MS, cloudflareExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "rate-limited" });
  });

  it("maps an empty verifier body to empty-response", async () => {
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () =>
      verifierResult("   ", ORIGIN_CLOUDFLARE_FREE_MODEL));
    const result = await verifyOriginCodeEquivalenceCrossRoute(
      {
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
        sourcePlan: sourcePlanStub(),
      },
      { nowMs: NOW_MS, cloudflareExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "empty-response" });
  });

  it("maps non-protocol verifier output to verdict-parse-failure", async () => {
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () =>
      verifierResult("等価だと思います。", ORIGIN_CLOUDFLARE_FREE_MODEL));
    const result = await verifyOriginCodeEquivalenceCrossRoute(
      {
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
        sourcePlan: sourcePlanStub(),
      },
      { nowMs: NOW_MS, cloudflareExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "verdict-parse-failure" });
  });
});

describe("runOriginCodeEquivalenceVerificationShadow", () => {
  const completedResult: OriginCodeEquivalenceVerificationResult = {
    status: "completed",
    servedRoute: "groq",
    verifierRoute: "cloudflare",
    servedModel: "openai/gpt-oss-120b",
    verifierModel: "@cf/google/gemma-4-26b-a4b-it",
    verdict: "non-equivalent",
    mainBlockIndex: 1,
    differingCases: ["明細行のない注文が結果から落ち、合計が返らない"],
    sameResultClaimed: true,
    originalTruncated: false,
    blocksTruncated: false,
    answerBlockCount: 1,
    includedBlockCount: 1,
    durationMs: 120,
    transportRequestCount: 2,
    neurons: 42,
  };

  it("records the verdict as kinds and counts only — never the case text or the code", async () => {
    const logged: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const outcome = await runOriginCodeEquivalenceVerificationShadow(
      {
        requestId: "req-b1-test",
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
        sourcePlan: sourcePlanStub(),
      },
      {
        env: { ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "shadow" },
        verify: async () => completedResult,
        logger: (message, fields) => { logged.push({ message, fields }); },
      },
    );
    expect(outcome.status).toBe("completed");
    expect(outcome.metadata).toMatchObject({
      verificationMode: "shadow",
      verificationConfiguredMode: "shadow",
      verificationStatus: "completed",
      servedRoute: "groq",
      verifierRoute: "cloudflare",
      verdict: "non-equivalent",
      mainBlockIndex: 1,
      differingCaseCount: 1,
      sameResultClaimed: true,
      answerBlockCount: 1,
      appliedAction: "none",
      verifierNeurons: 42,
      verifierTransportRequests: 2,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toBe("[origin-chat] code equivalence verification");
    expect(logged[0].fields.requestId).toBe("req-b1-test");
    const serialized = JSON.stringify(logged[0].fields) + JSON.stringify(outcome.metadata);
    expect(serialized).not.toContain("明細行のない注文");
    expect(serialized).not.toContain("LEFT JOIN");
    expect(serialized).not.toContain("SELECT");
  });

  it("records a not-run outcome with its failure kind", async () => {
    const outcome = await runOriginCodeEquivalenceVerificationShadow(
      {
        requestId: "req-b1-test",
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
        sourcePlan: sourcePlanStub(),
      },
      {
        env: { ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "shadow" },
        verify: async () => ({
          status: "not-run",
          failureKind: "rate-limited",
          servedRoute: "groq",
          verifierRoute: "cloudflare",
          durationMs: 30,
        }),
        logger: () => {},
      },
    );
    expect(outcome.status).toBe("not-run");
    expect(outcome.failureKind).toBe("rate-limited");
    expect(outcome.metadata).toMatchObject({
      verificationStatus: "not-run",
      verificationFailureKind: "rate-limited",
      appliedAction: "none",
    });
  });

  it("never throws when the verification seam itself throws", async () => {
    const outcome = await runOriginCodeEquivalenceVerificationShadow(
      {
        requestId: "req-b1-test",
        message: E05_MESSAGE,
        answerText: E05_ANSWER,
        generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
        sourcePlan: sourcePlanStub(),
      },
      {
        env: { ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "shadow" },
        verify: async () => { throw new Error("seam failure"); },
        logger: () => {},
      },
    );
    expect(outcome.status).toBe("not-run");
    expect(outcome.failureKind).toBe("provider-error");
  });
});
