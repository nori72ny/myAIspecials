import { describe, expect, it, vi } from "vitest";
import {
  createOrinAiNewsService,
  OrinAiNewsUnavailableError,
  type OrinAiNewsFailure,
} from "./orinAiNews.js";
import type { OriginSearchFetch, OriginSearchFetchResponse } from "../search/originSearchProviders.js";

function gdeltResponse(articles: unknown[], status = 200): OriginSearchFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ articles }),
  };
}

const ARTICLES = [
  { url: "https://example.com/ai-1", title: "AIの新しい発表", domain: "example.com", seendate: "20251125T030000Z" },
  { url: "https://example.org/ai-2", title: "Another AI headline", domain: "example.org", seendate: "20251125T020000Z" },
];

function fetchReturning(...responses: OriginSearchFetchResponse[]): OriginSearchFetch {
  let index = 0;
  return vi.fn(async () => responses[Math.min(index++, responses.length - 1)]);
}

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<item><title>生成AIの新モデルを発表 - ITmedia</title><link>https://news.google.com/rss/articles/AAA</link><pubDate>Wed, 25 Nov 2026 03:30:00 GMT</pubDate><source url="https://www.itmedia.co.jp">ITmedia</source></item>
<item><title>AI regulation &amp; policy update - Reuters</title><link>https://news.google.com/rss/articles/BBB</link><pubDate>Wed, 25 Nov 2026 01:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
</channel></rss>`;

function rssResponse(xml: string = RSS_XML, status = 200): OriginSearchFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => xml,
  };
}

const noSleep = async () => { /* injected in tests that do not exercise the wait */ };

describe("createOrinAiNewsService (ai-news headline outlet fix, 2026-11-25)", () => {
  it("returns mapped headlines from GDELT for the fixed query", async () => {
    const fetchImpl = fetchReturning(gdeltResponse(ARTICLES));
    const service = createOrinAiNewsService({ fetchImpl, sleep: noSleep });
    const result = await service.getHeadlines();
    expect(result.stale).toBe(false);
    expect(result.items).toEqual([
      { title: "AIの新しい発表", url: "https://example.com/ai-1", source: "example.com", publishedAt: "2025-11-25T03:00:00Z" },
      { title: "Another AI headline", url: "https://example.org/ai-2", source: "example.org", publishedAt: "2025-11-25T02:00:00Z" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = String(vi.mocked(fetchImpl).mock.calls[0][0]);
    expect(calledUrl).toContain("api.gdeltproject.org");
    expect(decodeURIComponent(calledUrl)).toContain("人工知能");
  });

  it("serves the in-memory cache within the TTL instead of refetching", async () => {
    const fetchImpl = fetchReturning(gdeltResponse(ARTICLES));
    let nowMs = 1_000_000;
    const service = createOrinAiNewsService({ fetchImpl, sleep: noSleep, now: () => nowMs });
    const first = await service.getHeadlines();
    nowMs += 5 * 60 * 1000;
    const second = await service.getHeadlines();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("coalesces concurrent requests into one fetch", async () => {
    let release: (response: OriginSearchFetchResponse) => void = () => { /* replaced below */ };
    const fetchImpl = vi.fn(() => new Promise<OriginSearchFetchResponse>((resolve) => { release = resolve; }));
    const service = createOrinAiNewsService({ fetchImpl, sleep: noSleep });
    const first = service.getHeadlines();
    const second = service.getHeadlines();
    release(gdeltResponse(ARTICLES));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(firstResult.items).toHaveLength(2);
    expect(secondResult.items).toHaveLength(2);
  });

  it("retries once after the rate-limit wait when GDELT answers 429", async () => {
    const fetchImpl = fetchReturning(
      { ok: false, status: 429, text: async () => "Please limit requests to one every 5 seconds" },
      gdeltResponse(ARTICLES),
    );
    const sleep = vi.fn(async (_ms: number) => { /* record only */ });
    const service = createOrinAiNewsService({ fetchImpl, sleep });
    const result = await service.getHeadlines();
    expect(result.items).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(5_000);
  });

  it("does not retry non-429 GDELT failures, tries the RSS fallback, and reports both reasons", async () => {
    const fetchImpl = fetchReturning({ ok: false, status: 500, text: async () => "server error" });
    const failures: OrinAiNewsFailure[] = [];
    const service = createOrinAiNewsService({
      fetchImpl,
      sleep: noSleep,
      onFailure: (failure) => { failures.push(failure); },
    });
    await expect(service.getHeadlines()).rejects.toBeInstanceOf(OrinAiNewsUnavailableError);
    // GDELT は引き直さず、代替ソース（RSS）を1回だけ引く。
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetchImpl).mock.calls[1][0])).toContain("news.google.com/rss");
    expect(failures).toEqual([{ code: "http", status: 500 }, { code: "rss-http", status: 500 }]);
  });

  it("falls back to the RSS headlines when GDELT fails", async () => {
    const fetchImpl = fetchReturning(
      { ok: false, status: 500, text: async () => "server error" },
      rssResponse(),
    );
    const service = createOrinAiNewsService({ fetchImpl, sleep: noSleep });
    const result = await service.getHeadlines();
    expect(result.stale).toBe(false);
    expect(result.items).toEqual([
      { title: "生成AIの新モデルを発表", url: "https://news.google.com/rss/articles/AAA", source: "ITmedia", publishedAt: "2026-11-25T03:30:00.000Z" },
      { title: "AI regulation & policy update", url: "https://news.google.com/rss/articles/BBB", source: "Reuters", publishedAt: "2026-11-25T01:00:00.000Z" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to RSS after the GDELT rate-limit retry also fails", async () => {
    const fetchImpl = fetchReturning(
      { ok: false, status: 429, text: async () => "Please limit requests to one every 5 seconds" },
      { ok: false, status: 429, text: async () => "Please limit requests to one every 5 seconds" },
      rssResponse(),
    );
    const sleep = vi.fn(async (_ms: number) => { /* record only */ });
    const service = createOrinAiNewsService({ fetchImpl, sleep });
    const result = await service.getHeadlines();
    expect(result.items).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("treats an RSS response without usable items as a failure", async () => {
    const fetchImpl = fetchReturning(
      { ok: false, status: 503, text: async () => "unavailable" },
      rssResponse("<html><body>not a feed</body></html>"),
    );
    const failures: OrinAiNewsFailure[] = [];
    const service = createOrinAiNewsService({
      fetchImpl,
      sleep: noSleep,
      onFailure: (failure) => { failures.push(failure); },
    });
    await expect(service.getHeadlines()).rejects.toBeInstanceOf(OrinAiNewsUnavailableError);
    expect(failures).toEqual([{ code: "http", status: 503 }, { code: "rss-invalid" }]);
  });

  it("surfaces a timeout as the failure reason (the production failure mode)", async () => {
    const fetchImpl: OriginSearchFetch = (_url, init) => new Promise<OriginSearchFetchResponse>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { reject(new Error("aborted")); });
    });
    const failures: OrinAiNewsFailure[] = [];
    const service = createOrinAiNewsService({
      fetchImpl,
      timeoutMs: 10,
      rssTimeoutMs: 10,
      sleep: noSleep,
      onFailure: (failure) => { failures.push(failure); },
    });
    await expect(service.getHeadlines()).rejects.toBeInstanceOf(OrinAiNewsUnavailableError);
    expect(failures).toEqual([{ code: "timeout" }, { code: "rss-timeout" }]);
  });

  it("falls back to the previous headlines (marked stale) when a refresh fails", async () => {
    const fetchImpl = fetchReturning(
      gdeltResponse(ARTICLES),
      { ok: false, status: 503, text: async () => "unavailable" },
    );
    let nowMs = 1_000_000;
    const service = createOrinAiNewsService({ fetchImpl, sleep: noSleep, now: () => nowMs });
    const first = await service.getHeadlines();
    nowMs += 30 * 60 * 1000; // beyond the 10-minute TTL, within the stale limit
    const second = await service.getHeadlines();
    expect(second.stale).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.items).toEqual(first.items);
  });

  it("gives up when the previous headlines are older than the stale limit", async () => {
    const fetchImpl = fetchReturning(
      gdeltResponse(ARTICLES),
      { ok: false, status: 503, text: async () => "unavailable" },
    );
    let nowMs = 1_000_000;
    const service = createOrinAiNewsService({ fetchImpl, sleep: noSleep, now: () => nowMs });
    await service.getHeadlines();
    nowMs += 25 * 60 * 60 * 1000;
    await expect(service.getHeadlines()).rejects.toBeInstanceOf(OrinAiNewsUnavailableError);
  });
});
