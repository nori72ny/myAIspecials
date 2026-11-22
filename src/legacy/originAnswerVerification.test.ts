import { describe, expect, it, vi } from "vitest";
import {
  ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID,
  ORIGIN_CLOUDFLARE_FREE_MODEL,
} from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import {
  ORIGIN_GROQ_FREE_MODEL_ID,
  ORIGIN_GROQ_FREE_ROTATION_MODEL_ID,
  ORIGIN_GROQ_QWEN_MODEL_ID,
} from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import type { OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionRequest,
  type OriginProviderExecutionResult,
} from "./originProviderClient.js";
import {
  OriginCloudflarePreflightError,
  type OriginCloudflareExecutionOptions,
} from "./originCloudflareProviderClient.js";
import {
  OriginGroqPreflightError,
  type OriginGroqExecutionOptions,
} from "./originGroqProviderClient.js";
import {
  buildOriginAnswerVerificationInstruction,
  buildOriginAnswerVerificationPayload,
  decideOriginAnswerCorrection,
  identifyOriginAnswerServedRoute,
  isOriginAnswerCorrectionMachineCheckable,
  originAnswerVerifierRouteFor,
  parseOriginAnswerVerificationVerdicts,
  verifyOriginAnswerCrossRoute,
  type OriginAnswerClaimVerdict,
  type OriginAnswerVerificationSource,
} from "./originAnswerVerification.js";

const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");

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

const VERDICTS_JSON = JSON.stringify({
  claims: [
    { index: 1, verdict: "supported", sourceRef: 1 },
    {
      index: 2,
      verdict: "contradicted",
      corrected: "児童手当の支給額は月額15,000円です。",
      sourceRef: 1,
      note: "旧制度の額が述べられている",
    },
    { index: 3, verdict: "uncertain" },
  ],
  unjudged: 1,
});

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

const SOURCES: OriginAnswerVerificationSource[] = [
  {
    title: "児童手当制度のご案内",
    domain: "www.city.example.jp",
    retrievedAt: "2026-11-20",
    excerpt: "児童手当の支給額は、3歳未満は月額15000円、3歳以上は月額10000円です。",
  },
];

describe("identifyOriginAnswerServedRoute / originAnswerVerifierRouteFor", () => {
  it("identifies the Cloudflare route from its served models", () => {
    expect(identifyOriginAnswerServedRoute(ORIGIN_CLOUDFLARE_FREE_MODEL)).toBe("cloudflare");
    expect(identifyOriginAnswerServedRoute(ORIGIN_CLOUDFLARE_FREE_LIGHT_MODEL_ID)).toBe("cloudflare");
  });

  it("identifies the Groq route from its primary and rotation served models", () => {
    expect(identifyOriginAnswerServedRoute(ORIGIN_GROQ_FREE_MODEL_ID)).toBe("groq");
    expect(identifyOriginAnswerServedRoute(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID)).toBe("groq");
    expect(identifyOriginAnswerServedRoute(ORIGIN_GROQ_QWEN_MODEL_ID)).toBe("groq");
  });

  it("returns null for the stopped primary route and unknown models", () => {
    expect(identifyOriginAnswerServedRoute("google/gemma-4-31b-it:free")).toBeNull();
    expect(identifyOriginAnswerServedRoute("some/unknown-model")).toBeNull();
    expect(identifyOriginAnswerServedRoute("")).toBeNull();
    expect(identifyOriginAnswerServedRoute(undefined)).toBeNull();
  });

  it("always picks the other route as verifier", () => {
    expect(originAnswerVerifierRouteFor("cloudflare")).toBe("groq");
    expect(originAnswerVerifierRouteFor("groq")).toBe("cloudflare");
  });
});

describe("parseOriginAnswerVerificationVerdicts", () => {
  it("parses a well-formed verdict object", () => {
    const parsed = parseOriginAnswerVerificationVerdicts(VERDICTS_JSON);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.claims).toHaveLength(3);
    expect(parsed.claims[0]).toMatchObject({ index: 1, verdict: "supported", sourceRef: 1 });
    expect(parsed.claims[1]).toMatchObject({
      index: 2,
      verdict: "contradicted",
      corrected: "児童手当の支給額は月額15,000円です。",
      sourceRef: 1,
    });
    expect(parsed.claims[2]).toMatchObject({ index: 3, verdict: "uncertain" });
    expect(parsed.unjudgedClaimCount).toBe(1);
  });

  it("accepts a bare claims array and code-fenced JSON", () => {
    const bare = parseOriginAnswerVerificationVerdicts(
      JSON.stringify([{ index: 1, verdict: "supported" }]),
    );
    expect(bare.ok).toBe(true);
    const fenced = parseOriginAnswerVerificationVerdicts("```json\n" + VERDICTS_JSON + "\n```");
    expect(fenced.ok).toBe(true);
    if (fenced.ok) expect(fenced.claims).toHaveLength(3);
  });

  it("rejects malformed output as a parse failure", () => {
    expect(parseOriginAnswerVerificationVerdicts("判定できませんでした")).toEqual({
      ok: false,
      reason: "verdict-parse-failure",
    });
    expect(parseOriginAnswerVerificationVerdicts("{\"claims\":\"none\"}")).toEqual({
      ok: false,
      reason: "verdict-parse-failure",
    });
    expect(parseOriginAnswerVerificationVerdicts("{\"other\":true}")).toEqual({
      ok: false,
      reason: "verdict-parse-failure",
    });
  });

  it("treats empty output as an empty response, not a parse failure", () => {
    expect(parseOriginAnswerVerificationVerdicts("")).toEqual({
      ok: false,
      reason: "empty-response",
    });
    expect(parseOriginAnswerVerificationVerdicts("  \n ")).toEqual({
      ok: false,
      reason: "empty-response",
    });
  });

  it("keeps valid entries from a partial payload and counts the dropped ones as unjudged", () => {
    const parsed = parseOriginAnswerVerificationVerdicts(
      JSON.stringify({
        claims: [
          { index: 1, verdict: "supported" },
          { index: 2, verdict: "definitely-wrong" },
          { verdict: "supported" },
          { index: 3, verdict: "uncertain", internalConflict: true },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.claims.map((claim) => claim.index)).toEqual([1, 3]);
    expect(parsed.claims[1].internalConflict).toBe(true);
    expect(parsed.unjudgedClaimCount).toBe(2);
  });

  it("fails when every entry is unusable", () => {
    expect(
      parseOriginAnswerVerificationVerdicts(
        JSON.stringify({ claims: [{ index: 1, verdict: "nope" }] }),
      ),
    ).toEqual({ ok: false, reason: "verdict-parse-failure" });
  });

  it("accepts an explicitly empty claims list (an answer with no factual claims)", () => {
    const parsed = parseOriginAnswerVerificationVerdicts(
      JSON.stringify({ claims: [], unjudged: 0 }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.claims).toEqual([]);
      expect(parsed.unjudgedClaimCount).toBe(0);
    }
  });

  it("downgrades a contradicted verdict without a correction to uncertain", () => {
    const parsed = parseOriginAnswerVerificationVerdicts(
      JSON.stringify({ claims: [{ index: 1, verdict: "contradicted", note: "古い制度" }] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.claims[0].verdict).toBe("uncertain");
    expect(parsed.claims[0].corrected).toBeUndefined();
  });

  it("keeps the first verdict on duplicate indexes and counts the rest as unjudged", () => {
    const parsed = parseOriginAnswerVerificationVerdicts(
      JSON.stringify({
        claims: [
          { index: 1, verdict: "supported" },
          { index: 1, verdict: "contradicted", corrected: "別の文です。" },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.claims).toHaveLength(1);
    expect(parsed.claims[0].verdict).toBe("supported");
    expect(parsed.unjudgedClaimCount).toBe(1);
  });

  it("caps judged claims at 12 and counts the overflow as unjudged", () => {
    const claims = Array.from({ length: 13 }, (_unused, position) => ({
      index: position + 1,
      verdict: "supported",
    }));
    const parsed = parseOriginAnswerVerificationVerdicts(JSON.stringify({ claims }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.claims).toHaveLength(12);
    expect(parsed.unjudgedClaimCount).toBe(1);
  });
});

describe("isOriginAnswerCorrectionMachineCheckable", () => {
  const excerpt = "児童手当の支給額は、3歳未満は月額15000円、3歳以上は月額10000円です。施行日は2026-11-21です。";

  it("accepts a correction whose values all appear in the excerpt", () => {
    expect(
      isOriginAnswerCorrectionMachineCheckable("児童手当の支給額は月額15,000円です。", excerpt),
    ).toBe(true);
  });

  it("accepts a correction that appears verbatim in the excerpt", () => {
    expect(
      isOriginAnswerCorrectionMachineCheckable("3歳以上は月額10000円です", excerpt),
    ).toBe(true);
  });

  it("matches dates across written forms", () => {
    expect(
      isOriginAnswerCorrectionMachineCheckable("施行日は2026年11月21日です。", excerpt),
    ).toBe(true);
  });

  it("rejects a correction whose value does not appear in the excerpt", () => {
    expect(
      isOriginAnswerCorrectionMachineCheckable("児童手当の支給額は月額16,000円です。", excerpt),
    ).toBe(false);
  });

  it("rejects a value-free correction that is not verbatim", () => {
    expect(
      isOriginAnswerCorrectionMachineCheckable("児童手当は全国一律の制度です。", excerpt),
    ).toBe(false);
  });

  it("rejects empty corrections and missing excerpts", () => {
    expect(isOriginAnswerCorrectionMachineCheckable("", excerpt)).toBe(false);
    expect(isOriginAnswerCorrectionMachineCheckable("月額15,000円です。", undefined)).toBe(false);
    expect(isOriginAnswerCorrectionMachineCheckable("月額15,000円です。", "  ")).toBe(false);
  });
});

describe("decideOriginAnswerCorrection", () => {
  const supported: OriginAnswerClaimVerdict = { index: 1, verdict: "supported" };
  const uncertain: OriginAnswerClaimVerdict = { index: 2, verdict: "uncertain" };
  const unsupported: OriginAnswerClaimVerdict = { index: 3, verdict: "unsupported" };
  const checkableContradiction: OriginAnswerClaimVerdict = {
    index: 4,
    verdict: "contradicted",
    corrected: "児童手当の支給額は月額15,000円です。",
    sourceRef: 1,
  };
  const uncheckableContradiction: OriginAnswerClaimVerdict = {
    index: 5,
    verdict: "contradicted",
    corrected: "児童手当の支給額は月額16,000円です。",
    sourceRef: 1,
  };

  it("does nothing without an actionable contradicted verdict", () => {
    expect(
      decideOriginAnswerCorrection([supported, uncertain, unsupported], {
        answerClass: "A",
        path: "research",
        sources: SOURCES,
      }).action,
    ).toBe("none");
    expect(
      decideOriginAnswerCorrection([], { answerClass: "A", path: "direct" }).action,
    ).toBe("none");
  });

  it("patches when every contradiction is machine-checkable against its source", () => {
    const decision = decideOriginAnswerCorrection([supported, checkableContradiction], {
      answerClass: "A",
      path: "research",
      sources: SOURCES,
    });
    expect(decision.action).toBe("patch");
    expect(decision.patchClaims.map((claim) => claim.index)).toEqual([4]);
  });

  it("regenerates when a contradiction cannot be machine-checked", () => {
    const decision = decideOriginAnswerCorrection([uncheckableContradiction], {
      answerClass: "A",
      path: "research",
      sources: SOURCES,
    });
    expect(decision.action).toBe("regenerate");
    expect(decision.claimIndexes).toEqual([5]);
    expect(decision.patchClaims).toEqual([]);
  });

  it("patches the checkable subset and regenerates for the rest", () => {
    const decision = decideOriginAnswerCorrection(
      [checkableContradiction, uncheckableContradiction],
      { answerClass: "A", path: "research", sources: SOURCES },
    );
    expect(decision.action).toBe("regenerate");
    expect(decision.patchClaims.map((claim) => claim.index)).toEqual([4]);
    expect(decision.claimIndexes).toEqual([5]);
  });

  it("never patches on the direct path, even with sources present", () => {
    const decision = decideOriginAnswerCorrection([checkableContradiction], {
      answerClass: "A",
      path: "direct",
      sources: SOURCES,
    });
    expect(decision.action).toBe("regenerate");
    expect(decision.patchClaims).toEqual([]);
  });

  it("still patches after regeneration when the remaining contradiction is checkable", () => {
    const decision = decideOriginAnswerCorrection([checkableContradiction], {
      answerClass: "A",
      path: "research",
      sources: SOURCES,
      regenerationAttempted: true,
    });
    expect(decision.action).toBe("patch");
  });

  it("holds for class A when contradictions survive regeneration", () => {
    const decision = decideOriginAnswerCorrection([uncheckableContradiction], {
      answerClass: "A",
      path: "research",
      sources: SOURCES,
      regenerationAttempted: true,
    });
    expect(decision.action).toBe("hold");
    expect(decision.claimIndexes).toEqual([5]);
  });

  it("never holds for class B; unresolved contradictions are only recorded", () => {
    const decision = decideOriginAnswerCorrection([uncheckableContradiction], {
      answerClass: "B",
      path: "direct",
      regenerationAttempted: true,
    });
    expect(decision.action).toBe("none");
    expect(decision.unresolvedClaimIndexes).toEqual([5]);
  });
});

describe("verifyOriginAnswerCrossRoute", () => {
  const baseInput = {
    question: "児童手当の支給額を教えてください。",
    answerText: "児童手当の支給額は月額10,000円です。",
  };

  it("verifies a Cloudflare-served answer with the Groq route only", async () => {
    const groqExecute = vi.fn<GroqExecutor>(async (request) => {
      expect(request.plan.modelId).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
      expect(request.systemInstruction).toContain("検査者");
      expect(request.messages[0].content).toContain("児童手当の支給額を教えてください。");
      expect(request.messages[0].content).toContain("月額10,000円");
      return verifierResult(VERDICTS_JSON, ORIGIN_GROQ_FREE_MODEL_ID);
    });
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () => {
      throw new Error("must not be called");
    });
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, groqExecute, cloudflareExecute },
    );
    expect(groqExecute).toHaveBeenCalledTimes(1);
    expect(cloudflareExecute).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.servedRoute).toBe("cloudflare");
    expect(result.verifierRoute).toBe("groq");
    expect(result.verifierModel).toBe(ORIGIN_GROQ_FREE_MODEL_ID);
    expect(result.verdictCounts).toEqual({
      supported: 1,
      unsupported: 0,
      contradicted: 1,
      uncertain: 1,
    });
    expect(result.unjudgedClaimCount).toBe(1);
    expect(result.transportRequestCount).toBe(3);
  });

  it("verifies a Groq-served answer with the Cloudflare route and includes the source digest", async () => {
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async (request) => {
      expect(request.plan.modelId).toBe(ORIGIN_CLOUDFLARE_FREE_MODEL);
      expect(request.messages[0].content).toContain("児童手当制度のご案内");
      expect(request.messages[0].content).toContain("月額15000円");
      return verifierResult(VERDICTS_JSON, ORIGIN_CLOUDFLARE_FREE_MODEL);
    });
    const groqExecute = vi.fn<GroqExecutor>(async () => {
      throw new Error("must not be called");
    });
    const result = await verifyOriginAnswerCrossRoute(
      {
        ...baseInput,
        sources: SOURCES,
        generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
        sourcePlan: sourcePlanStub(),
      },
      { nowMs: NOW_MS, groqExecute, cloudflareExecute },
    );
    expect(cloudflareExecute).toHaveBeenCalledTimes(1);
    expect(groqExecute).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.servedRoute).toBe("groq");
    expect(result.verifierRoute).toBe("cloudflare");
  });

  it("treats a Groq rotation served model as the Groq route", async () => {
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () =>
      verifierResult(VERDICTS_JSON, ORIGIN_CLOUDFLARE_FREE_MODEL),
    );
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_GROQ_FREE_ROTATION_MODEL_ID), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, cloudflareExecute },
    );
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.verifierRoute).toBe("cloudflare");
  });

  it("fails open without calling any route when the serving route is unknown", async () => {
    const groqExecute = vi.fn<GroqExecutor>(async () => verifierResult(VERDICTS_JSON, ORIGIN_GROQ_FREE_MODEL_ID));
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () =>
      verifierResult(VERDICTS_JSON, ORIGIN_CLOUDFLARE_FREE_MODEL),
    );
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult("google/gemma-4-31b-it:free"), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, groqExecute, cloudflareExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "unknown-served-route" });
    expect(groqExecute).not.toHaveBeenCalled();
    expect(cloudflareExecute).not.toHaveBeenCalled();
  });

  it("fails open on E-1 (429) from the verifier route", async () => {
    const groqExecute = vi.fn<GroqExecutor>(async () => {
      throw new OriginProviderError("PROVIDER_RATE_LIMITED", "rate limited", 429, true);
    });
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, groqExecute },
    );
    expect(result).toMatchObject({
      status: "not-run",
      failureKind: "rate-limited",
      servedRoute: "cloudflare",
      verifierRoute: "groq",
    });
  });

  it("fails open on E-2 (provider timeout) from the verifier route", async () => {
    const groqExecute = vi.fn<GroqExecutor>(async () => {
      throw new OriginProviderError("PROVIDER_TIMEOUT", "timed out", 504, true);
    });
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, groqExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "timeout" });
  });

  it("fails open on E-2 when the verifier exceeds the verification budget", async () => {
    const groqExecute = vi.fn<GroqExecutor>(
      () => new Promise<OriginProviderExecutionResult>(() => undefined),
    );
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, groqExecute, timeoutMs: 25 },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "timeout" });
  });

  it("fails open on E-3 (empty verifier response)", async () => {
    const groqExecute = vi.fn<GroqExecutor>(async () =>
      verifierResult("   ", ORIGIN_GROQ_FREE_MODEL_ID),
    );
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, groqExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "empty-response" });
  });

  it("fails open on E-4 (503) from the verifier route", async () => {
    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () => {
      throw new OriginProviderError("PROVIDER_UNAVAILABLE", "unavailable", 503, true);
    });
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, cloudflareExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "service-unavailable" });
  });

  it("fails open on E-5 (route skipped before sending) for both routes", async () => {
    const groqExecute = vi.fn<GroqExecutor>(async () => {
      throw new OriginGroqPreflightError("not-configured");
    });
    const fromGroq = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, groqExecute },
    );
    expect(fromGroq).toMatchObject({ status: "not-run", failureKind: "route-unavailable" });

    const cloudflareExecute = vi.fn<CloudflareExecutor>(async () => {
      throw new OriginCloudflarePreflightError("pool-exhausted");
    });
    const fromCloudflare = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, cloudflareExecute },
    );
    expect(fromCloudflare).toMatchObject({ status: "not-run", failureKind: "route-unavailable" });
  });

  it("fails open when the verifier output is not verdict JSON", async () => {
    const groqExecute = vi.fn<GroqExecutor>(async () =>
      verifierResult("判定できませんでした。", ORIGIN_GROQ_FREE_MODEL_ID),
    );
    const result = await verifyOriginAnswerCrossRoute(
      { ...baseInput, generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL), sourcePlan: sourcePlanStub() },
      { nowMs: NOW_MS, groqExecute },
    );
    expect(result).toMatchObject({ status: "not-run", failureKind: "verdict-parse-failure" });
  });
});

describe("instruction and payload builders", () => {
  it("builds an inspector instruction that carries today's date and the JSON-only rule", () => {
    const instruction = buildOriginAnswerVerificationInstruction(NOW_MS);
    expect(instruction).toContain("検査者");
    expect(instruction).toContain("2026年11月27日");
    expect(instruction).toContain("JSONだけ");
    expect(instruction).toContain("uncertainに倒してください");
  });

  it("caps the answer at the payload limit and flags the truncation", () => {
    const payload = buildOriginAnswerVerificationPayload({
      question: "質問",
      answerText: "あ".repeat(3_001),
    });
    expect(payload.answerTruncated).toBe(true);
    const exact = buildOriginAnswerVerificationPayload({
      question: "質問",
      answerText: "あ".repeat(3_000),
    });
    expect(exact.answerTruncated).toBe(false);
  });
});
