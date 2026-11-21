import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import type { OriginAnswerVerificationResult } from "./originAnswerVerification";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";
import type { OriginResearchSource } from "./originResearchSource";

// Wiring tests for answer verification V-PR-2 (blocking router,
// shadow): mode off reproduces the pre-feature response exactly;
// shadow verifies targeted answers through the injected seam, never
// changes the delivered content byte-for-byte, reports a clean pass
// honestly in the envelope, keeps not-run wording truthful for
// review-required answers, and fails open when verification breaks.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;

const PLAIN_QUESTION = "富士山の高さはどれくらいですか。";
const PLAIN_ANSWER = "富士山の標高は3,776メートルです。";
const REVIEW_QUESTION = "二重確認してください。手紙の書き出しの例を教えてください。";
const REVIEW_ANSWER = "拝啓　時下ますますご清栄のこととお慶び申し上げます。";
const FABRICATED_LAW_ANSWER = "デジタル資産保護法は2021年4月1日から施行されました。登録手数料は16,000円です。";

type VerifyStub = (input: unknown, options: unknown) => Promise<OriginAnswerVerificationResult>;

function completedVerdicts(
  overrides: Partial<Extract<OriginAnswerVerificationResult, { status: "completed" }>> = {},
): OriginAnswerVerificationResult {
  return {
    status: "completed",
    servedRoute: "groq",
    verifierRoute: "cloudflare",
    servedModel: "openai/gpt-oss-120b",
    verifierModel: "@cf/google/gemma-4-26b-a4b-it",
    claims: [{ index: 1, verdict: "supported" }],
    unjudgedClaimCount: 0,
    verdictCounts: { supported: 1, unsupported: 0, contradicted: 0, uncertain: 0 },
    answerTruncated: false,
    durationMs: 100,
    transportRequestCount: 2,
    neurons: 35,
    ...overrides,
  };
}

function executorWith(text: string): OriginChatExecutor {
  return vi.fn(async () => ({
    text,
    transportRequestCount: 1,
    actualCostUsd: 0 as const,
    providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
    routingEvidence: { requestedModel: verifiedEvidence.modelId, servedModel: verifiedEvidence.modelId, strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
  })) as unknown as OriginChatExecutor;
}

function groqServedExecutorWith(text: string): OriginChatExecutor {
  return vi.fn(async () => ({
    text,
    transportRequestCount: 2,
    actualCostUsd: 0 as const,
    providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
    routingEvidence: { requestedModel: "openai/gpt-oss-120b", servedModel: "openai/gpt-oss-120b", strategy: "verified-free-failover" as const, provider: "Groq", attempt: 3 as const, fallbackUsed: true as const },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
    attempts: [
      { providerId: "openrouter-free", modelId: verifiedEvidence.modelId, outcome: "skipped" as const, skipReason: "route-stopped", transportRequestCount: 0 },
      { providerId: "cloudflare-workers-ai-free", modelId: "@cf/google/gemma-4-26b-a4b-it", outcome: "availability-error" as const, errorCode: "PROVIDER_RATE_LIMITED" as const, transportRequestCount: 1 },
      { providerId: "groq-free", modelId: "openai/gpt-oss-120b", outcome: "succeeded" as const, transportRequestCount: 1 },
    ],
  })) as unknown as OriginChatExecutor;
}

function createApp(options: {
  execute: OriginChatExecutor;
  env?: NodeJS.ProcessEnv;
  verify?: VerifyStub;
  research?: OriginResearchExecutor;
  researchSynthesis?: OriginChatExecutor | null;
}) {
  const app = express();
  app.use(express.json());
  const research: OriginResearchExecutor = options.research ?? (async () => ({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } }));
  app.use(createOriginChatRouter({
    env: options.env ?? { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute: options.execute,
    research,
    researchSynthesis: options.researchSynthesis === undefined ? null : options.researchSynthesis,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-answer-verification-test",
    ...(options.verify
      ? { answerVerification: { verify: options.verify as never, readDailyNeuronsUsed: async () => null } }
      : {}),
  }));
  return app;
}

function verificationLogFields(infoSpy: ReturnType<typeof vi.spyOn>): Record<string, unknown> | undefined {
  const call = infoSpy.mock.calls.find(([message]) => String(message).includes("answer verification"));
  return call?.[1] as Record<string, unknown> | undefined;
}

describe("answer verification shadow wiring — direct path (V-PR-2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mode off (default): no verification, no routing block, baseline envelope", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(createApp({ execute: executorWith(PLAIN_ANSWER), verify }))
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(PLAIN_ANSWER);
    expect(response.body.answer.verification.status).toBe("not-required");
    expect(response.body.routing.answerVerification).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it("shadow: a clean class-B pass upgrades the envelope to passed and never touches the content", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(createApp({
      execute: executorWith(PLAIN_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(PLAIN_ANSWER);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(response.body.answer.verification.status).toBe("passed");
    expect(response.body.answer.verification.independentReviewPerformed).toBe(true);
    expect(response.body.answer.verification.summary).toContain("別のAIが内容を確認しました");
    expect(response.body.routing.verificationStatus).toBe("passed");
    expect(response.body.routing.answerVerification).toMatchObject({
      verificationMode: "shadow",
      verificationConfiguredMode: "shadow",
      verificationClass: "B",
      verificationPath: "direct",
      verificationStatus: "completed",
      verdictSupported: 1,
      wouldBeAction: "none",
      appliedAction: "none",
    });
    const fields = verificationLogFields(infoSpy);
    expect(fields).toBeDefined();
    expect(fields?.requestId).toBe("origin-answer-verification-test");
    expect(fields?.verificationStatus).toBe("completed");
    expect(JSON.stringify(fields)).not.toContain(PLAIN_ANSWER);
  });

  it("shadow: routes are identified from the serving execution (Groq served, Cloudflare verified)", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(createApp({
      execute: groqServedExecutorWith(PLAIN_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(PLAIN_ANSWER);
    expect(response.body.routing.answerVerification).toMatchObject({
      servedRoute: "groq",
      verifierRoute: "cloudflare",
      neuronsCountSource: "reported",
      neuronsDelta: 35,
    });
  });

  it("shadow: a failed check on a review-required answer keeps not-run with truthful wording", async () => {
    const verify = vi.fn(async () => ({
      status: "not-run",
      failureKind: "rate-limited",
      servedRoute: "groq",
      verifierRoute: "cloudflare",
      durationMs: 30,
    }) as OriginAnswerVerificationResult);
    const response = await request(createApp({
      execute: executorWith(REVIEW_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: REVIEW_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(REVIEW_ANSWER);
    expect(response.body.answer.verification.status).toBe("not-run");
    expect(response.body.answer.verification.summary).toContain("応答しなかったため");
    expect(response.body.answer.verification.summary).not.toContain("利用できないため実施していません");
    expect(response.body.answer.limitations.join("")).toContain("完了できていないため");
    expect(response.body.routing.answerVerification).toMatchObject({
      verificationClass: "A",
      verificationStatus: "not-run",
      verificationFailureKind: "rate-limited",
    });
  });

  it("shadow: contradictions found on a review-required answer are recorded, never applied, and not marked passed", async () => {
    const verify = vi.fn(async () => completedVerdicts({
      claims: [{ index: 1, verdict: "contradicted", corrected: "拝啓　時下ますますご健勝のこととお慶び申し上げます。" }],
      verdictCounts: { supported: 0, unsupported: 0, contradicted: 1, uncertain: 0 },
    }));
    const response = await request(createApp({
      execute: executorWith(REVIEW_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: REVIEW_QUESTION }] });
    expect(response.status).toBe(200);
    // Shadow never changes the delivered answer, even with a correction in hand.
    expect(response.body.content).toBe(REVIEW_ANSWER);
    expect(response.body.answer.verification.status).toBe("not-run");
    expect(response.body.answer.verification.summary).toContain("見解が一致しない点が残ったため");
    expect(response.body.routing.answerVerification).toMatchObject({
      verificationClass: "A",
      verdictContradicted: 1,
      wouldBeAction: "regenerate",
      appliedAction: "none",
    });
  });

  it("shadow: a publication-gate firing answer is a class-A target even without a review requirement", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(createApp({
      execute: executorWith(FABRICATED_LAW_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: "手紙の書き出しの例を教えてください。" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(FABRICATED_LAW_ANSWER);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(response.body.routing.answerVerification).toMatchObject({ verificationClass: "A" });
  });

  it("enforce value behaves as shadow in V-PR-2 (configured mode recorded, nothing applied)", async () => {
    const verify = vi.fn(async () => completedVerdicts({
      claims: [{ index: 1, verdict: "contradicted", corrected: "富士山の標高は3,776メートルです。" }],
      verdictCounts: { supported: 0, unsupported: 0, contradicted: 1, uncertain: 0 },
    }));
    const response = await request(createApp({
      execute: executorWith(PLAIN_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "enforce" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(PLAIN_ANSWER);
    expect(response.body.routing.answerVerification).toMatchObject({
      verificationMode: "shadow",
      verificationConfiguredMode: "enforce",
      appliedAction: "none",
    });
  });

  it("a held answer (publication gate enforce) is not a verification target", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(createApp({
      execute: executorWith("衆議院は465名、参議院は245名です。"),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow", ORIGIN_PUBLICATION_GATE_MODE: "enforce" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: "国会の衆議院と参議院の議員定数はそれぞれ何人ですか？" }] });
    expect(response.status).toBe(200);
    expect(response.body.content).not.toContain("245名");
    expect(verify).not.toHaveBeenCalled();
    expect(response.body.routing.answerVerification).toBeUndefined();
  });

  it("fails open when the verification seam throws: the answer is delivered with the baseline envelope", async () => {
    const verify = vi.fn(async () => { throw new Error("seam failure"); });
    const response = await request(createApp({
      execute: executorWith(PLAIN_ANSWER),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
    })).post("/api/chat").send({ messages: [{ role: "user", content: PLAIN_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(PLAIN_ANSWER);
    expect(response.body.answer.verification.status).toBe("not-required");
    expect(response.body.routing.answerVerification).toMatchObject({
      verificationStatus: "not-run",
      verificationFailureKind: "provider-error",
    });
  });
});

const researchSources: OriginResearchSource[] = [
  {
    title: "児童手当制度のご案内 - こども家庭庁",
    url: "https://www.cfa.go.jp/policies/kodomo-teate/",
    excerpt: "児童手当の支給額は、3歳未満は月額15,000円、3歳以上は月額10,000円です。手続きは市区町村の窓口で行います。",
    sourceType: "web-search",
    domain: "cfa.go.jp",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-20T03:00:00.000Z",
    freshness: "recent",
  },
  {
    title: "児童手当 - 市区町村の案内",
    url: "https://www.city.example.jp/kosodate/teate.html",
    excerpt: "児童手当は中学校修了前の児童を養育している方に支給されます。支給額は年齢により異なります。",
    sourceType: "web-search",
    domain: "city.example.jp",
    rank: 2,
    evidenceLevel: "snippet",
    retrievedAt: "2026-11-20T03:00:00.000Z",
    freshness: "recent",
  },
];

const RESEARCH_QUESTION = "現在の児童手当の支給額を調査してください";
const SYNTHESIS_TEXT = "児童手当の支給額は、3歳未満は月額15,000円、3歳以上は月額10,000円です [S1](https://www.cfa.go.jp/policies/kodomo-teate/)。児童手当は中学校修了前の児童を養育している方に支給されます [S2](https://www.city.example.jp/kosodate/teate.html)";

function researchExecutor(): OriginResearchExecutor {
  return vi.fn().mockResolvedValue({ ok: true, searchProvider: "Tavily", sources: researchSources }) as unknown as OriginResearchExecutor;
}

function synthesisExecutor(text: string): OriginChatExecutor {
  return vi.fn().mockResolvedValue({
    text,
    transportRequestCount: 1,
    actualCostUsd: 0 as const,
    providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
    routingEvidence: { requestedModel: verifiedEvidence.modelId, servedModel: verifiedEvidence.modelId, strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
  }) as unknown as OriginChatExecutor;
}

describe("answer verification shadow wiring — research path (V-PR-2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T0: an adopted synthesis is verified as class A; a clean pass upgrades the envelope, content untouched", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(createApp({
      execute: executorWith("未使用"),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
      research: researchExecutor(),
      researchSynthesis: synthesisExecutor(SYNTHESIS_TEXT),
    })).post("/api/chat").send({ messages: [{ role: "user", content: RESEARCH_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.content).toBe(SYNTHESIS_TEXT);
    expect(response.body.routing.researchTier).toBe("T0");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(response.body.answer.verification.status).toBe("passed");
    expect(response.body.routing.verificationStatus).toBe("passed");
    expect(response.body.routing.answerVerification).toMatchObject({
      verificationPath: "research",
      verificationClass: "A",
      verificationStatus: "completed",
      appliedAction: "none",
    });
  });

  it("T3: a claim-carrying partial answer is verified as class A and stays byte-identical to the mode-off body", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const shadowResponse = await request(createApp({
      execute: executorWith("未使用"),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
      research: researchExecutor(),
      researchSynthesis: synthesisExecutor("児童手当は子育て世帯への支援制度です。"),
    })).post("/api/chat").send({ messages: [{ role: "user", content: RESEARCH_QUESTION }] });
    expect(shadowResponse.status).toBe(200);
    expect(shadowResponse.body.routing.researchTier).toBe("T3");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(shadowResponse.body.routing.answerVerification).toMatchObject({
      verificationPath: "research",
      verificationClass: "A",
      verificationStatus: "completed",
    });
    expect(shadowResponse.body.answer.verification.status).toBe("passed");

    const offResponse = await request(createApp({
      execute: executorWith("未使用"),
      research: researchExecutor(),
      researchSynthesis: synthesisExecutor("児童手当は子育て世帯への支援制度です。"),
    })).post("/api/chat").send({ messages: [{ role: "user", content: RESEARCH_QUESTION }] });
    expect(offResponse.status).toBe(200);
    expect(shadowResponse.body.content).toBe(offResponse.body.content);
    expect(offResponse.body.routing.answerVerification).toBeUndefined();
  });

  it("T4: a no-source hold is not a verification target", async () => {
    const verify = vi.fn(async () => completedVerdicts());
    const response = await request(createApp({
      execute: executorWith("未使用"),
      env: { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_ANSWER_VERIFICATION_MODE: "shadow" },
      verify,
      researchSynthesis: null,
    })).post("/api/chat").send({ messages: [{ role: "user", content: RESEARCH_QUESTION }] });
    expect(response.status).toBe(200);
    expect(response.body.routing.researchTier).toBe("T4");
    expect(verify).not.toHaveBeenCalled();
    expect(response.body.routing.answerVerification).toBeUndefined();
  });
});
