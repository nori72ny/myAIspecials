import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

// P3-1 (WEEKLY_INSPECTION_P3_DESIGN_2026-11-23 §3.2 / §6): the
// deterministic direct-answer layer is wired into the tier-T3
// landing of the research path — after the PR-4 recovery-template
// trial, before the PR-5 conditional — as observation only. These
// router-level tests pin the wiring contract:
//  - mode off: the layer is never called (no shadow log line, and
//    the answer is the pre-P3 answer);
//  - shadow: the attempt is computed and logged with the design's
//    fields, and the delivered answer is byte-identical to off;
//  - enforce: at this stage the router still treats the attempt as
//    observation only (delivery is P3-3), so the answer also stays
//    byte-identical;
//  - the replay shapes that must not fire (a single stating
//    source, a question outside the registered fact types) log a
//    not-fired attempt and leave the answer untouched.
// The layer's own extraction/agreement logic is pinned by
// src/research/groundedResearchDirectAnswer.test.ts; here the
// fixtures reuse that file's Q2 replay sources.

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
// A fixed clock, as in the PR-4/PR-5 router tests: freshness and
// publication windows are judged against the router's now().
const FIXED_NOW = Date.parse("2026-11-19T00:00:00.000Z");

const execute: OriginChatExecutor = vi.fn().mockResolvedValue({
  text: "安全な確認結果です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
});

function createDirectAnswerApp(env: NodeJS.ProcessEnv, research: OriginResearchExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env,
    execute,
    research,
    researchSynthesis: null,
    now: () => FIXED_NOW,
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-test-trace",
  }));
  return app;
}

const pmSource = (overrides: {
  title: string;
  url: string;
  domain: string;
  excerpt: string;
}) => ({
  title: overrides.title,
  url: overrides.url,
  excerpt: overrides.excerpt,
  sourceType: "web-search" as const,
  domain: overrides.domain,
  rank: 1,
  evidenceLevel: "page-verified" as const,
  retrievedAt: "2026-11-14T10:00:00.000Z",
  freshness: "recent" as const,
  sourceAuthority: "unclassified" as const,
});

// The design §6 Q2 replay: two independent sources stating the
// incumbent's name as the answer, in assertion form.
const PM_SOURCES = [
  pmSource({
    title: "内閣総理大臣の指名について",
    url: "https://www.kantei.example.go.jp/souri/",
    domain: "kantei.example.go.jp",
    excerpt: "高市早苗は、第105代内閣総理大臣に指名された。内閣総理大臣は、国会の議決により指名される。",
  }),
  pmSource({
    title: "首相ニュース",
    url: "https://news.example.co.jp/pm",
    domain: "news.example.co.jp",
    excerpt: "2026年11月現在、内閣総理大臣は高市早苗氏である。高市氏は自由民主党の総裁を務めている。",
  }),
];
const PM_QUESTION = { messages: [{ role: "user", content: "現在の内閣総理大臣は誰ですか？" }] };

function directAnswerLog(info: ReturnType<typeof vi.spyOn>) {
  return info.mock.calls.find((call: unknown[]) => String(call[0]).includes("research direct answer (shadow)"));
}

describe("createOriginChatRouter — P3-1 direct-answer layer wiring", () => {
  it("shadow logs the Q2 would-fire attempt with the design's fields and delivers the off answer byte-identically", async () => {
    const researchMock = vi.fn().mockResolvedValue({ ok: true, sources: PM_SOURCES });
    const baseline = await request(createDirectAnswerApp({ OPENROUTER_API_KEY: "synthetic-test-key" }, researchMock))
      .post("/api/chat").send(PM_QUESTION);
    expect(baseline.status).toBe(200);
    expect(baseline.body.routing.researchTier).toBe("T3");

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const shadowed = await request(createDirectAnswerApp(
        { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "shadow" },
        researchMock,
      )).post("/api/chat").send(PM_QUESTION);
      expect(shadowed.status).toBe(200);
      // Observation only: the delivered answer and its landing are
      // exactly the pre-P3 ones.
      expect(shadowed.body.content).toBe(baseline.body.content);
      expect(shadowed.body.routing.researchTier).toBe(baseline.body.routing.researchTier);
      expect(shadowed.body.routing.researchOutcome).toBe(baseline.body.routing.researchOutcome);

      const attemptLog = directAnswerLog(info);
      expect(attemptLog).toBeDefined();
      const fields = attemptLog?.[1] as {
        directAnswerMode?: string;
        directAnswerEntry?: string;
        directAnswerFired?: boolean;
        directAnswerAgreementSources?: number;
        directAnswerGateHeld?: boolean;
        directAnswerGateFiringKinds?: string[];
      } | undefined;
      expect(fields?.directAnswerMode).toBe("shadow");
      expect(fields?.directAnswerEntry).toBe("incumbent-prime-minister-jp");
      expect(fields?.directAnswerFired).toBe(true);
      expect(fields?.directAnswerAgreementSources).toBe(2);
      // §3.4: the incumbent statement is held by the gate's
      // position-status shape; the shadow record carries that
      // judgement for the verified-claim channel stage.
      expect(fields?.directAnswerGateHeld).toBe(true);
      expect(fields?.directAnswerGateFiringKinds).toContain("position-status");
      // Log discipline: names, quotes, and URLs are never logged —
      // status, counts, and codes only.
      expect(JSON.stringify(fields)).not.toContain("高市早苗");
      expect(JSON.stringify(fields)).not.toContain("https://");
    } finally {
      info.mockRestore();
    }
  });

  it("mode off (unset or unrecognized) never calls the layer: no shadow log, same answer", async () => {
    const researchMock = vi.fn().mockResolvedValue({ ok: true, sources: PM_SOURCES });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      for (const env of [
        { OPENROUTER_API_KEY: "synthetic-test-key" },
        { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "on" },
      ]) {
        info.mockClear();
        const response = await request(createDirectAnswerApp(env, researchMock))
          .post("/api/chat").send(PM_QUESTION);
        expect(response.status).toBe(200);
        expect(response.body.routing.researchTier).toBe("T3");
        expect(directAnswerLog(info)).toBeUndefined();
      }
    } finally {
      info.mockRestore();
    }
  });

  it("enforce is still observation-only at the router at this stage (delivery is P3-3)", async () => {
    const researchMock = vi.fn().mockResolvedValue({ ok: true, sources: PM_SOURCES });
    const baseline = await request(createDirectAnswerApp({ OPENROUTER_API_KEY: "synthetic-test-key" }, researchMock))
      .post("/api/chat").send(PM_QUESTION);
    expect(baseline.status).toBe(200);

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const enforced = await request(createDirectAnswerApp(
        { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "enforce" },
        researchMock,
      )).post("/api/chat").send(PM_QUESTION);
      expect(enforced.status).toBe(200);
      expect(enforced.body.content).toBe(baseline.body.content);
      const attemptLog = directAnswerLog(info);
      expect(attemptLog).toBeDefined();
      const fields = attemptLog?.[1] as { directAnswerMode?: string; directAnswerFired?: boolean } | undefined;
      expect(fields?.directAnswerMode).toBe("enforce");
      expect(fields?.directAnswerFired).toBe(true);
    } finally {
      info.mockRestore();
    }
  });

  it("shadow does not fire on a single stating source and leaves the answer untouched", async () => {
    const researchMock = vi.fn().mockResolvedValue({ ok: true, sources: [PM_SOURCES[0]] });
    const baseline = await request(createDirectAnswerApp({ OPENROUTER_API_KEY: "synthetic-test-key" }, researchMock))
      .post("/api/chat").send(PM_QUESTION);
    expect(baseline.status).toBe(200);

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const shadowed = await request(createDirectAnswerApp(
        { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "shadow" },
        researchMock,
      )).post("/api/chat").send(PM_QUESTION);
      expect(shadowed.status).toBe(200);
      expect(shadowed.body.content).toBe(baseline.body.content);
      const attemptLog = directAnswerLog(info);
      expect(attemptLog).toBeDefined();
      const fields = attemptLog?.[1] as { directAnswerFired?: boolean; directAnswerReason?: string } | undefined;
      expect(fields?.directAnswerFired).toBe(false);
      expect(fields?.directAnswerReason).toBe("insufficient-sources");
    } finally {
      info.mockRestore();
    }
  });

  it("shadow does not fire on a research question outside the registered fact types", async () => {
    const rateSource = (domain: string, url: string) => ({
      title: "労働力調査",
      url,
      excerpt: "総務省統計局が2026年10月30日に公表した労働力調査では、2026年9月の完全失業率は2.4%でした。",
      revisionTimestamp: "2026-10-30T00:00:00.000Z",
      sourceType: "web-search" as const,
      domain,
      evidenceLevel: "page-verified" as const,
      retrievedAt: "2026-11-19T00:00:00.000Z",
      freshness: "recent" as const,
    });
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      sources: [rateSource("stat.go.jp", "https://www.stat.go.jp/a"), rateSource("news.example", "https://news.example/b")],
    });
    const question = { messages: [{ role: "user", content: "最新の完全失業率を教えてください。いつの分ですか？" }] };
    const baseline = await request(createDirectAnswerApp({ OPENROUTER_API_KEY: "synthetic-test-key" }, researchMock))
      .post("/api/chat").send(question);
    expect(baseline.status).toBe(200);
    expect(baseline.body.routing.researchTier).toBe("T3");

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const shadowed = await request(createDirectAnswerApp(
        { OPENROUTER_API_KEY: "synthetic-test-key", ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "shadow" },
        researchMock,
      )).post("/api/chat").send(question);
      expect(shadowed.status).toBe(200);
      expect(shadowed.body.content).toBe(baseline.body.content);
      const attemptLog = directAnswerLog(info);
      expect(attemptLog).toBeDefined();
      const fields = attemptLog?.[1] as { directAnswerFired?: boolean; directAnswerReason?: string; directAnswerEntry?: string } | undefined;
      expect(fields?.directAnswerFired).toBe(false);
      expect(fields?.directAnswerReason).toBe("no-slot-entry");
      expect(fields?.directAnswerEntry).toBeUndefined();
    } finally {
      info.mockRestore();
    }
  });
});
