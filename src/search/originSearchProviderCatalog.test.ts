import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG,
  evaluateOriginSearchProviderAccess,
  isValidOriginSearchProviderEvidence,
  OriginSearchUsageCounter,
  selectCurrentOriginSearchProviderEvidence,
  type OriginSearchProviderEvidence,
} from "./originSearchProviderCatalog";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG", () => {
  it("contains the design-approved providers with valid $0 evidence", () => {
    expect(DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG.map((entry) => entry.providerId)).toEqual([
      "open-meteo",
      "gdelt",
      "wikipedia",
      "tavily",
      "stooq",
    ]);
    for (const entry of DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG) {
      expect(isValidOriginSearchProviderEvidence(entry)).toBe(true);
      expect(entry.paymentMethodRequired).toBe(false);
      expect(entry.termsUrl.startsWith("https://")).toBe(true);
    }
  });

  it("records Tavily's verified free cap and the conservative 800-credit self cap", () => {
    const tavily = DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG.find((entry) => entry.providerId === "tavily");
    expect(tavily?.freeCap).toEqual({ amount: 1_000, unit: "credits", period: "month" });
    expect(tavily?.monthlySelfCapUnits).toBe(800);
    expect(tavily?.requiresApiKey).toBe(true);
  });

  it("sets reviewAfter exactly 30 days after the 2026-11-07 verification", () => {
    for (const entry of DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG) {
      if (entry.providerId === "stooq") continue;
      expect(Date.parse(entry.verifiedAt)).toBe(Date.parse("2026-11-07T00:00:00.000Z"));
      expect(Date.parse(entry.reviewAfter) - Date.parse(entry.verifiedAt)).toBe(30 * DAY_MS);
    }
  });

  it("records Stooq as keyless with a deliberately short 14-day evidence fuse", () => {
    const stooq = DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG.find((entry) => entry.providerId === "stooq");
    expect(stooq?.requiresApiKey).toBe(false);
    expect(stooq?.freeCap).toBeNull();
    expect(stooq?.monthlySelfCapUnits).toBeNull();
    expect(Date.parse(stooq?.verifiedAt ?? "")).toBe(Date.parse("2026-11-08T00:00:00.000Z"));
    expect(Date.parse(stooq?.reviewAfter ?? "") - Date.parse(stooq?.verifiedAt ?? "")).toBe(14 * DAY_MS);
    // The route is live only inside the fuse window and fails closed after it.
    expect(selectCurrentOriginSearchProviderEvidence(
      DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG, "stooq", Date.parse("2026-11-08T12:00:00.000Z"),
    )).not.toBeNull();
    expect(selectCurrentOriginSearchProviderEvidence(
      DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG, "stooq", Date.parse("2026-11-23T00:00:00.000Z"),
    )).toBeNull();
  });

  it("fails closed once the evidence window has passed", () => {
    expect(selectCurrentOriginSearchProviderEvidence(DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG, "tavily", NOW)).not.toBeNull();
    expect(
      selectCurrentOriginSearchProviderEvidence(DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG, "tavily", Date.parse("2026-12-08T00:00:00.000Z")),
    ).toBeNull();
  });

  it("rejects an evidence entry whose self cap exceeds the documented free cap", () => {
    const forged: OriginSearchProviderEvidence = {
      providerId: "tavily",
      termsUrl: "https://www.tavily.com/pricing",
      freeCap: { amount: 1_000, unit: "credits", period: "month" },
      freeCapNote: "forged",
      paymentMethodRequired: false,
      requiresApiKey: true,
      monthlySelfCapUnits: 5_000,
      verifiedAt: "2026-11-07T00:00:00.000Z",
      reviewAfter: "2026-12-07T00:00:00.000Z",
    };
    expect(isValidOriginSearchProviderEvidence(forged)).toBe(false);
  });
});

describe("evaluateOriginSearchProviderAccess", () => {
  it("disables the Tavily route when the API key is absent, without affecting keyless routes", () => {
    const counter = new OriginSearchUsageCounter();
    expect(evaluateOriginSearchProviderAccess("tavily", { env: {}, nowMs: NOW, counter })).toEqual({
      enabled: false,
      reason: "api-key-missing",
    });
    expect(evaluateOriginSearchProviderAccess("open-meteo", { env: {}, nowMs: NOW, counter }).enabled).toBe(true);
    expect(evaluateOriginSearchProviderAccess("gdelt", { env: {}, nowMs: NOW, counter }).enabled).toBe(true);
    expect(evaluateOriginSearchProviderAccess("wikipedia", { env: {}, nowMs: NOW, counter }).enabled).toBe(true);
  });

  it("enables Tavily when a key is present and evidence is current", () => {
    const access = evaluateOriginSearchProviderAccess("tavily", {
      env: { TAVILY_API_KEY: "tvly-test-key" },
      nowMs: NOW,
      counter: new OriginSearchUsageCounter(),
    });
    expect(access.enabled).toBe(true);
  });

  it("disables Tavily when the evidence is stale even if a key exists", () => {
    const access = evaluateOriginSearchProviderAccess("tavily", {
      env: { TAVILY_API_KEY: "tvly-test-key" },
      nowMs: Date.parse("2026-12-20T00:00:00.000Z"),
      counter: new OriginSearchUsageCounter(),
    });
    expect(access).toEqual({ enabled: false, reason: "evidence-stale" });
  });

  it("stops the route at the monthly self cap and recovers on month rollover", () => {
    const counter = new OriginSearchUsageCounter();
    counter.record("tavily", 799, NOW);
    const env = { TAVILY_API_KEY: "tvly-test-key" };
    expect(evaluateOriginSearchProviderAccess("tavily", { env, nowMs: NOW, counter, units: 1 }).enabled).toBe(true);
    counter.record("tavily", 1, NOW);
    expect(counter.usage("tavily", NOW)).toBe(800);
    expect(evaluateOriginSearchProviderAccess("tavily", { env, nowMs: NOW, counter, units: 1 })).toEqual({
      enabled: false,
      reason: "monthly-cap-reached",
    });
    const december = Date.parse("2026-12-01T00:00:00.000Z");
    expect(counter.usage("tavily", december)).toBe(0);
    expect(evaluateOriginSearchProviderAccess("tavily", { env, nowMs: december, counter, units: 1 }).enabled).toBe(true);
  });
});

describe("OriginSearchUsageCounter", () => {
  it("tracks usage per provider and per UTC month", () => {
    const counter = new OriginSearchUsageCounter();
    counter.record("tavily", 3, NOW);
    counter.record("tavily", 2, NOW);
    counter.record("gdelt", 5, NOW);
    expect(counter.usage("tavily", NOW)).toBe(5);
    expect(counter.usage("gdelt", NOW)).toBe(5);
    expect(counter.usage("tavily", Date.parse("2026-12-01T00:00:00.000Z"))).toBe(0);
  });

  it("ignores non-positive units", () => {
    const counter = new OriginSearchUsageCounter();
    counter.record("tavily", 0, NOW);
    counter.record("tavily", -3, NOW);
    expect(counter.usage("tavily", NOW)).toBe(0);
  });
});
