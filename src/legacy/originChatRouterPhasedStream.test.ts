import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginChatRouter, type OriginChatExecutor, type OriginResearchExecutor } from "./originChatRouter";

const verifiedEvidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const verifiedCatalogTime = Date.parse(verifiedEvidence.verifiedAt) + 1;
const defaultExecutionResult = {
  text: "安全な確認結果です。",
  transportRequestCount: 1,
  actualCostUsd: 0 as const,
  providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
  routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
};

function createApp(
  execute: OriginChatExecutor,
  research: OriginResearchExecutor,
  researchSynthesis: OriginChatExecutor | null = null,
) {
  const app = express();
  app.use(express.json());
  app.use(createOriginChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key" },
    execute,
    research,
    researchSynthesis,
    now: (() => { let current = 1_000; return () => { current += 25; return current; }; })(),
    catalogNow: () => verifiedCatalogTime,
    createRequestId: () => "origin-test-trace",
  }));
  return app;
}

type PhasedEvent =
  | { type: "phase"; phase: string }
  | { type: "sources"; sources: Array<{ title: string; domain: string }> }
  | { type: "delta"; text: string }
  | { type: "complete" }
  | { type: "error"; code?: string };

function parsePhasedStream(text: string): { events: PhasedEvent[]; doneSeen: boolean } {
  const events: PhasedEvent[] = [];
  let doneSeen = false;
  for (const block of text.split("\n\n")) {
    const line = block.trim();
    if (!line) continue;
    expect(line.startsWith("data:")).toBe(true);
    const raw = line.slice("data:".length).trim();
    if (raw === "[DONE]") { doneSeen = true; continue; }
    events.push(JSON.parse(raw) as PhasedEvent);
  }
  return { events, doneSeen };
}

function deltaText(events: PhasedEvent[]): string {
  return events.filter((event) => event.type === "delta").map((event) => (event as { text: string }).text).join("");
}

const researchWithMixedSources = {
  ok: true,
  searchProvider: "DuckDuckGo",
  sources: [
    {
      title: "Price source one",
      url: "https://example.com/one",
      excerpt: "料金は100円と記載されています。",
      sourceType: "web-search",
      domain: "example.com",
      rank: 1,
      evidenceLevel: "page-verified",
      retrievedAt: "2026-09-24T06:00:00.000Z",
      freshness: "recent",
    },
    {
      title: "Price source two",
      url: "https://example.org/two",
      excerpt: "料金は120円と記載されています。",
      sourceType: "web-search",
      rank: 2,
      evidenceLevel: "page-verified",
      retrievedAt: "2026-09-24T06:00:00.000Z",
      freshness: "recent",
    },
    {
      title: "Insecure source",
      url: "http://example.net/insecure",
      excerpt: "httpなので出典に使えません。",
      sourceType: "web-search",
      domain: "example.net",
      rank: 3,
      evidenceLevel: "snippet",
      retrievedAt: "2026-09-24T06:00:00.000Z",
      freshness: "recent",
    },
    {
      title: "Credential source",
      url: "https://user:pass@example.com/secret",
      excerpt: "資格情報を含むURLは出典に使えません。",
      sourceType: "web-search",
      domain: "example.com",
      rank: 4,
      evidenceLevel: "snippet",
      retrievedAt: "2026-09-24T06:00:00.000Z",
      freshness: "recent",
    },
  ],
} as unknown as Awaited<ReturnType<OriginResearchExecutor>>;

describe("createOriginChatRouter phased streaming (origin-phased-sse-v1)", () => {
  let executeMock: ReturnType<typeof vi.fn>;
  let execute: OriginChatExecutor;
  beforeEach(() => {
    executeMock = vi.fn().mockResolvedValue(defaultExecutionResult);
    execute = executeMock as OriginChatExecutor;
  });

  it("streams research phases, safe sources, then the verified digest answer", async () => {
    const researchMock = vi.fn().mockResolvedValue(researchWithMixedSources) as unknown as OriginResearchExecutor;
    const app = createApp(execute, researchMock);

    const streamed = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "候補を比較調査してください" }] });

    expect(streamed.status).toBe(200);
    expect(streamed.headers["content-type"]).toContain("text/event-stream");
    expect(streamed.headers["x-origin-stream-protocol"]).toBe("origin-phased-sse-v1");
    expect(streamed.headers["x-origin-stream-source"]).toBe("phased");
    expect(streamed.headers["x-origin-free-only"]).toBe("true");
    // Provider names and internal routing details never reach the phase stream.
    expect(streamed.text).not.toContain("DuckDuckGo");

    const { events, doneSeen } = parsePhasedStream(streamed.text);
    expect(doneSeen).toBe(true);
    const kinds = events.map((event) => event.type);
    expect(kinds[0]).toBe("phase");
    expect((events[0] as { phase: string }).phase).toBe("searching");
    expect(kinds[1]).toBe("sources");
    expect(kinds[2]).toBe("phase");
    expect((events[2] as { phase: string }).phase).toBe("composing");
    expect(kinds.at(-1)).toBe("complete");
    expect(kinds.filter((kind) => kind === "delta").length).toBeGreaterThan(0);

    // The sources event carries exactly the citable safe set, titles/domains only.
    const sourcesEvent = events[1] as { type: "sources"; sources: Array<{ title: string; domain: string }> };
    expect(sourcesEvent.sources).toEqual([
      { title: "Price source one", domain: "example.com" },
      { title: "Price source two", domain: "example.org" },
    ]);
    for (const source of sourcesEvent.sources) {
      expect(Object.keys(source).sort()).toEqual(["domain", "title"]);
    }

    // The streamed answer text is byte-identical to the JSON path's content.
    const json = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "候補を比較調査してください" }] });
    expect(json.status).toBe(200);
    expect(json.headers["content-type"]).toContain("application/json");
    expect(json.body.routing.answerMode).toBe("research");
    expect(deltaText(events)).toBe(json.body.content);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("streams the citation-validated synthesis answer with the same phase sequence", async () => {
    const researchMock = vi.fn().mockResolvedValue({
      ok: true,
      searchProvider: "DuckDuckGo",
      sources: researchWithMixedSources.sources.slice(0, 2),
    }) as unknown as OriginResearchExecutor;
    const synthesisText = [
      "## 結論",
      "",
      "取得できた資料では料金表記が一致していません。[S1](https://example.com/one) [S2](https://example.org/two)",
      "",
      "- 1つ目の資料は100円としています。[S1](https://example.com/one)",
      "- 2つ目の資料は120円としています。[S2](https://example.org/two)",
    ].join("\n");
    const synthesisMock = vi.fn().mockResolvedValue({ ...defaultExecutionResult, text: synthesisText }) as unknown as OriginChatExecutor;

    const response = await request(createApp(execute, researchMock, synthesisMock))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "現在の料金を比較調査してください" }] });

    expect(response.status).toBe(200);
    expect(response.headers["x-origin-stream-protocol"]).toBe("origin-phased-sse-v1");
    const { events, doneSeen } = parsePhasedStream(response.text);
    expect(doneSeen).toBe(true);
    expect(events.map((event) => event.type).slice(0, 3)).toEqual(["phase", "sources", "phase"]);
    expect(deltaText(events)).toBe(synthesisText);
    expect(synthesisMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("omits the sources event when no citable source was retrieved", async () => {
    const researchMock = vi.fn().mockResolvedValue({ ok: false, sources: [], failure: { stage: "web-search", code: "NO_RESULTS" } }) as unknown as OriginResearchExecutor;

    const response = await request(createApp(execute, researchMock))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "候補を比較調査してください" }] });

    expect(response.status).toBe(200);
    const { events, doneSeen } = parsePhasedStream(response.text);
    expect(doneSeen).toBe(true);
    expect(events.filter((event) => event.type === "sources")).toHaveLength(0);
    expect(events.filter((event) => event.type === "phase").map((event) => (event as { phase: string }).phase)).toEqual(["searching", "composing"]);
    expect(events.at(-1)?.type).toBe("complete");
    expect(deltaText(events)).toContain("確認できる公開情報を取得できなかったため");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("keeps pre-research failures as plain JSON even when streaming is requested", async () => {
    const researchMock = vi.fn() as unknown as OriginResearchExecutor;
    const app = createApp(execute, researchMock);

    const sensitive = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "Authorization: Bearer <redacted>" }] });
    expect(sensitive.status).toBe(422);
    expect(sensitive.headers["content-type"]).toContain("application/json");
    expect(sensitive.body.code).toBe("SENSITIVE_INPUT_BLOCKED");

    const invalid = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({});
    expect(invalid.status).toBe(400);
    expect(invalid.headers["content-type"]).toContain("application/json");
    expect(invalid.body.code).toBe("INVALID_CHAT_MESSAGES");
    expect(researchMock).not.toHaveBeenCalled();
  });
});
