import { describe, expect, it, vi } from "vitest";
import { ORIGIN_CLOUDFLARE_FREE_MODEL } from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import { ORIGIN_GROQ_FREE_MODEL_ID } from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import type { OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import type {
  OriginProviderExecutionResult,
} from "./originProviderClient.js";
import {
  classifyDirectAnswerVerificationTarget,
  classifyResearchAnswerVerificationTarget,
  createOriginAnswerVerificationNeuronLedger,
  resolveOriginAnswerVerificationEffectiveMode,
  resolveOriginAnswerVerificationMode,
  runOriginAnswerVerificationShadow,
  ORIGIN_ANSWER_VERIFICATION_DAILY_NEURON_SUBCAP,
  type OriginAnswerVerificationResult,
  type OriginAnswerVerificationShadowInput,
} from "./originAnswerVerification.js";

// V-PR-2 unit tests: mode resolution (off default / shadow / enforce,
// with enforce behaving as shadow until V-PR-4), target
// classification for both paths, the daily Neuron sub-cap ledger, and
// the shadow runner — envelope effects, would-be actions, Neuron
// counting from usage-counter deltas (W-1), the class-B cap, and
// fail-open behaviour. The verification call and the usage counter are
// stubbed throughout; no provider is contacted.

const NOW_MS = Date.parse("2026-11-21T03:00:00.000Z");

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

function completedResult(
  overrides: Partial<Extract<OriginAnswerVerificationResult, { status: "completed" }>> = {},
): OriginAnswerVerificationResult {
  return {
    status: "completed",
    servedRoute: "groq",
    verifierRoute: "cloudflare",
    servedModel: ORIGIN_GROQ_FREE_MODEL_ID,
    verifierModel: ORIGIN_CLOUDFLARE_FREE_MODEL,
    claims: [{ index: 1, verdict: "supported" }],
    unjudgedClaimCount: 0,
    verdictCounts: { supported: 1, unsupported: 0, contradicted: 0, uncertain: 0 },
    answerTruncated: false,
    durationMs: 123,
    transportRequestCount: 2,
    neurons: 35,
    ...overrides,
  };
}

function shadowInput(
  overrides: Partial<OriginAnswerVerificationShadowInput> = {},
): OriginAnswerVerificationShadowInput {
  return {
    requestId: "origin-verification-test",
    path: "direct",
    answerClass: "B",
    question: "富士山の高さはどれくらいですか。",
    answerText: "富士山の標高は3,776メートルです。",
    generationResult: generationResult(ORIGIN_GROQ_FREE_MODEL_ID),
    sourcePlan: sourcePlanStub(),
    language: "ja",
    ...overrides,
  };
}

describe("answer verification mode resolution (V-PR-2)", () => {
  it("defaults to off for unset and unrecognised values", () => {
    expect(resolveOriginAnswerVerificationMode(undefined)).toBe("off");
    expect(resolveOriginAnswerVerificationMode({})).toBe("off");
    expect(resolveOriginAnswerVerificationMode({ ORIGIN_ANSWER_VERIFICATION_MODE: "off" })).toBe("off");
    expect(resolveOriginAnswerVerificationMode({ ORIGIN_ANSWER_VERIFICATION_MODE: "SHADOW" })).toBe("off");
    expect(resolveOriginAnswerVerificationMode({ ORIGIN_ANSWER_VERIFICATION_MODE: "on" })).toBe("off");
  });

  it("resolves shadow and enforce, and enforce behaves as shadow until V-PR-4", () => {
    expect(resolveOriginAnswerVerificationMode({ ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginAnswerVerificationMode({ ORIGIN_ANSWER_VERIFICATION_MODE: "enforce" })).toBe("enforce");
    expect(resolveOriginAnswerVerificationEffectiveMode({ ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginAnswerVerificationEffectiveMode({ ORIGIN_ANSWER_VERIFICATION_MODE: "enforce" })).toBe("shadow");
    expect(resolveOriginAnswerVerificationEffectiveMode({})).toBe("off");
  });
});

describe("answer verification target classification (V-PR-2)", () => {
  it("direct: held answers are never targets", () => {
    expect(classifyDirectAnswerVerificationTarget({ reviewRequired: true, publicationGateFired: true, publicationGateHeld: true }))
      .toEqual({ targeted: false, reason: "gate-held" });
  });

  it("direct: review-required and gate-fired answers are class A, the rest class B", () => {
    expect(classifyDirectAnswerVerificationTarget({ reviewRequired: true, publicationGateFired: false, publicationGateHeld: false }))
      .toEqual({ targeted: true, answerClass: "A" });
    expect(classifyDirectAnswerVerificationTarget({ reviewRequired: false, publicationGateFired: true, publicationGateHeld: false }))
      .toEqual({ targeted: true, answerClass: "A" });
    expect(classifyDirectAnswerVerificationTarget({ reviewRequired: false, publicationGateFired: false, publicationGateHeld: false }))
      .toEqual({ targeted: true, answerClass: "B" });
  });

  it("research: an adopted synthesis (T0) is always class A", () => {
    expect(classifyResearchAnswerVerificationTarget({ site: "t0" }))
      .toEqual({ targeted: true, answerClass: "A" });
  });

  it("research final assembly: only a claim-carrying T3 partial with a generation result is a target", () => {
    const base = { site: "final" as const, tier: "T3", deterministicLanding: false, hasClaimSentences: true, hasGenerationResult: true };
    expect(classifyResearchAnswerVerificationTarget(base)).toEqual({ targeted: true, answerClass: "A" });
    expect(classifyResearchAnswerVerificationTarget({ ...base, deterministicLanding: true }))
      .toEqual({ targeted: false, reason: "not-model-answer" });
    expect(classifyResearchAnswerVerificationTarget({ ...base, tier: "T4" }))
      .toEqual({ targeted: false, reason: "abstain" });
    expect(classifyResearchAnswerVerificationTarget({ ...base, hasClaimSentences: false }))
      .toEqual({ targeted: false, reason: "no-claim-sentences" });
    expect(classifyResearchAnswerVerificationTarget({ ...base, hasGenerationResult: false }))
      .toEqual({ targeted: false, reason: "no-generation-result" });
  });
});

describe("answer verification Neuron ledger (V-PR-2)", () => {
  it("accumulates, reaches the cap at the sub-cap, and resets on the UTC day boundary", () => {
    const ledger = createOriginAnswerVerificationNeuronLedger(100);
    expect(ledger.usedToday(NOW_MS)).toBe(0);
    expect(ledger.capReached(NOW_MS)).toBe(false);
    ledger.add(60, NOW_MS);
    ledger.add(39, NOW_MS);
    expect(ledger.usedToday(NOW_MS)).toBe(99);
    expect(ledger.capReached(NOW_MS)).toBe(false);
    ledger.add(1, NOW_MS);
    expect(ledger.capReached(NOW_MS)).toBe(true);
    const nextDay = Date.parse("2026-11-22T00:00:01.000Z");
    expect(ledger.usedToday(nextDay)).toBe(0);
    expect(ledger.capReached(nextDay)).toBe(false);
  });

  it("uses the design's 1,500 sub-cap by default and ignores non-positive deltas", () => {
    const ledger = createOriginAnswerVerificationNeuronLedger();
    ledger.add(ORIGIN_ANSWER_VERIFICATION_DAILY_NEURON_SUBCAP - 1, NOW_MS);
    expect(ledger.capReached(NOW_MS)).toBe(false);
    ledger.add(-50, NOW_MS);
    expect(ledger.usedToday(NOW_MS)).toBe(ORIGIN_ANSWER_VERIFICATION_DAILY_NEURON_SUBCAP - 1);
    ledger.add(1, NOW_MS);
    expect(ledger.capReached(NOW_MS)).toBe(true);
  });
});

describe("answer verification shadow runner (V-PR-2)", () => {
  it("records a clean pass: envelope effect pass, counts from the usage-counter delta, full log shape", async () => {
    const ledger = createOriginAnswerVerificationNeuronLedger();
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const readings = [1_000, 1_035];
    const outcome = await runOriginAnswerVerificationShadow(shadowInput(), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      nowMs: NOW_MS,
      neuronLedger: ledger,
      verify: vi.fn(async () => completedResult()),
      readDailyNeuronsUsed: vi.fn(async () => readings.shift() ?? null),
      logger: (message, fields) => logs.push({ message, fields }),
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.envelopeEffect).toBe("pass");
    expect(outcome.wouldBeAction).toBe("none");
    expect(outcome.actionableContradictionCount).toBe(0);
    expect(ledger.usedToday(NOW_MS)).toBe(35);
    expect(outcome.metadata).toMatchObject({
      verificationMode: "shadow",
      verificationConfiguredMode: "shadow",
      verificationClass: "B",
      verificationPath: "direct",
      verificationStatus: "completed",
      servedRoute: "groq",
      verifierRoute: "cloudflare",
      claimCount: 1,
      verdictSupported: 1,
      verdictContradicted: 0,
      wouldBeAction: "none",
      appliedAction: "none",
      verificationDurationMs: 123,
      verifierTransportRequests: 2,
      neuronsDelta: 35,
      verificationNeuronsToday: 35,
      neuronCapReached: false,
      neuronsCountSource: "counter-delta",
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("[origin-chat] answer verification");
    expect(logs[0].fields.requestId).toBe("origin-verification-test");
    expect(logs[0].fields.verificationStatus).toBe("completed");
    // Kinds and counts only: the log never carries the answer text.
    expect(JSON.stringify(logs[0].fields)).not.toContain("富士山の標高は3,776メートルです");
  });

  it("records a would-be regeneration for a direct-path contradiction and holds the envelope at not-run", async () => {
    const outcome = await runOriginAnswerVerificationShadow(shadowInput({ answerClass: "A" }), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      nowMs: NOW_MS,
      neuronLedger: createOriginAnswerVerificationNeuronLedger(),
      verify: vi.fn(async () => completedResult({
        claims: [{ index: 1, verdict: "contradicted", corrected: "富士山の標高は3,776メートルです。" }],
        verdictCounts: { supported: 0, unsupported: 0, contradicted: 1, uncertain: 0 },
      })),
      readDailyNeuronsUsed: vi.fn(async () => null),
      logger: () => {},
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.wouldBeAction).toBe("regenerate");
    expect(outcome.actionableContradictionCount).toBe(1);
    expect(outcome.envelopeEffect).toBe("hold-not-run");
    expect(outcome.notRunSummary).toContain("見解が一致しない点が残ったため");
    // The counter was unreadable, so the completed call's reported
    // usage is the labelled fallback count.
    expect(outcome.metadata.neuronsCountSource).toBe("reported");
    expect(outcome.metadata.neuronsDelta).toBe(35);
  });

  it("records a would-be patch for a research-path contradiction the sources machine-check", async () => {
    const outcome = await runOriginAnswerVerificationShadow(shadowInput({
      path: "research",
      answerClass: "A",
      sources: [{
        title: "児童手当制度のご案内",
        domain: "www.city.example.jp",
        retrievedAt: "2026-11-20",
        excerpt: "児童手当の支給額は、3歳未満は月額15000円、3歳以上は月額10000円です。",
      }],
    }), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      nowMs: NOW_MS,
      neuronLedger: createOriginAnswerVerificationNeuronLedger(),
      verify: vi.fn(async () => completedResult({
        claims: [{ index: 1, verdict: "contradicted", corrected: "児童手当の支給額は月額15,000円です。", sourceRef: 1 }],
        verdictCounts: { supported: 0, unsupported: 0, contradicted: 1, uncertain: 0 },
      })),
      readDailyNeuronsUsed: vi.fn(async () => null),
      logger: () => {},
    });
    expect(outcome.wouldBeAction).toBe("patch");
    expect(outcome.wouldBePatchCount).toBe(1);
    expect(outcome.envelopeEffect).toBe("hold-not-run");
  });

  it("fails open on a verifier failure: not-run outcome, E-series kind recorded, envelope held", async () => {
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const outcome = await runOriginAnswerVerificationShadow(shadowInput({ answerClass: "A" }), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      nowMs: NOW_MS,
      neuronLedger: createOriginAnswerVerificationNeuronLedger(),
      verify: vi.fn(async () => ({
        status: "not-run",
        failureKind: "rate-limited",
        servedRoute: "groq",
        verifierRoute: "cloudflare",
        durationMs: 40,
      }) as OriginAnswerVerificationResult),
      readDailyNeuronsUsed: vi.fn(async () => null),
      logger: (message, fields) => logs.push({ message, fields }),
    });
    expect(outcome.status).toBe("not-run");
    expect(outcome.failureKind).toBe("rate-limited");
    expect(outcome.envelopeEffect).toBe("hold-not-run");
    expect(outcome.notRunSummary).toContain("応答しなかったため");
    expect(logs[0].fields.verificationFailureKind).toBe("rate-limited");
    expect(outcome.metadata.neuronsCountSource).toBe("unavailable");
  });

  it("never throws: a throwing verification call degrades to a not-run outcome", async () => {
    const outcome = await runOriginAnswerVerificationShadow(shadowInput(), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      nowMs: NOW_MS,
      neuronLedger: createOriginAnswerVerificationNeuronLedger(),
      verify: vi.fn(async () => { throw new Error("boom"); }),
      readDailyNeuronsUsed: vi.fn(async () => null),
      logger: () => {},
    });
    expect(outcome.status).toBe("not-run");
    expect(outcome.failureKind).toBe("provider-error");
    expect(outcome.envelopeEffect).toBe("hold-not-run");
  });

  it("skips class B at the daily cap without calling the verifier; class A still runs", async () => {
    const ledger = createOriginAnswerVerificationNeuronLedger(10);
    ledger.add(10, NOW_MS);
    const verify = vi.fn(async () => completedResult());
    const skipped = await runOriginAnswerVerificationShadow(shadowInput({ answerClass: "B" }), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      nowMs: NOW_MS,
      neuronLedger: ledger,
      verify,
      readDailyNeuronsUsed: vi.fn(async () => null),
      logger: () => {},
    });
    expect(skipped.status).toBe("skipped");
    expect(skipped.skipReason).toBe("daily-neuron-cap");
    expect(verify).not.toHaveBeenCalled();
    expect(skipped.metadata.verificationStatus).toBe("skipped");
    expect(skipped.metadata.neuronCapReached).toBe(true);

    const classA = await runOriginAnswerVerificationShadow(shadowInput({ answerClass: "A" }), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      nowMs: NOW_MS,
      neuronLedger: ledger,
      verify,
      readDailyNeuronsUsed: vi.fn(async () => null),
      logger: () => {},
    });
    expect(classA.status).toBe("completed");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("does not read the usage counter when the verifier is Groq (zero Neurons)", async () => {
    const readUsage = vi.fn(async () => 5_000);
    const outcome = await runOriginAnswerVerificationShadow(shadowInput({
      generationResult: generationResult(ORIGIN_CLOUDFLARE_FREE_MODEL),
    }), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      nowMs: NOW_MS,
      neuronLedger: createOriginAnswerVerificationNeuronLedger(),
      verify: vi.fn(async () => completedResult({
        servedRoute: "cloudflare",
        verifierRoute: "groq",
        servedModel: ORIGIN_CLOUDFLARE_FREE_MODEL,
        verifierModel: ORIGIN_GROQ_FREE_MODEL_ID,
        neurons: undefined,
      })),
      readDailyNeuronsUsed: readUsage,
      logger: () => {},
    });
    expect(outcome.status).toBe("completed");
    expect(readUsage).not.toHaveBeenCalled();
    expect(outcome.metadata.neuronsDelta).toBe(0);
    expect(outcome.metadata.neuronsCountSource).toBe("not-applicable");
    expect(outcome.metadata.verifierRoute).toBe("groq");
  });

  it("records the configured mode: enforce resolves to shadow behaviour with the configured value visible", async () => {
    const outcome = await runOriginAnswerVerificationShadow(shadowInput(), {
      env: { ORIGIN_ANSWER_VERIFICATION_MODE: "enforce" },
      nowMs: NOW_MS,
      neuronLedger: createOriginAnswerVerificationNeuronLedger(),
      verify: vi.fn(async () => completedResult()),
      readDailyNeuronsUsed: vi.fn(async () => null),
      logger: () => {},
    });
    expect(outcome.configuredMode).toBe("enforce");
    expect(outcome.effectiveMode).toBe("shadow");
    expect(outcome.metadata.verificationMode).toBe("shadow");
    expect(outcome.metadata.verificationConfiguredMode).toBe("enforce");
    expect(outcome.metadata.appliedAction).toBe("none");
  });
});
