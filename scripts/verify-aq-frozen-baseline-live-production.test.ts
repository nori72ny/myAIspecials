import { describe, it, expect } from "vitest";
import {
  verifyAqFrozenBaselineLiveProduction,
} from "./verify-aq-frozen-baseline-live-production.mjs";

const frozen = "437f4f0a5c66c0d9add7f65e72369f9787931f7a";
const wrong = "f0c1bff22d3246d3eac3903b9def5d3aa7c1e498";
const domains = [
  "origin-personal.vercel.app",
  "origin-personal-nori72nyprivate-6923s-projects.vercel.app",
  "origin-personal-git-main-nori72nyprivate-6923s-projects.vercel.app",
];

function client(served: Record<string, string>, options?: { cost?: number; paid?: boolean; http?: number; type?: string }) {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(url.hostname);
    if (!domains.includes(url.hostname) || url.pathname !== "/api/health") {
      throw Error("UNEXPECTED_HEALTH_URL");
    }
    return new Response(JSON.stringify({
      status: "ok",
      releaseSha: served[url.hostname],
      freeOnly: true,
      paidFallbackEnabled: options?.paid ?? false,
      costUsd: options?.cost ?? 0,
      secretDelivery: "server-only",
    }), { status: options?.http ?? 200, headers: {
      "content-type": options?.type ?? "application/json",
    } });
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}
const all = Object.fromEntries(domains.map(d => [d, frozen]));
describe("AQ-40 live Production baseline lock", () => {
  it("accepts the approved exact SHA from all three live production aliases, never promotes", async () => {
    const network = client(all);
    await expect(verifyAqFrozenBaselineLiveProduction(frozen, network.fetchImpl)).resolves.toEqual({
      schemaVersion: "origin.aq-frozen-baseline-live-production.v1",
      frozenBaselineSha: frozen,
      servingProductionAliasesVerified: 3,
      providerCalls: 0,
      hasRealModelAnswers: false,
      benchmarkPromotionAuthorized: false,
      productionPromotionAuthorized: false,
    });
    expect(network.calls.sort()).toEqual([...domains].sort());
  });
  it("blocks the historical f0c1 baseline even though it is a valid commit SHA", async () => {
    await expect(verifyAqFrozenBaselineLiveProduction(wrong, client(all).fetchImpl))
      .rejects.toThrow("AQ_FROZEN_BASELINE_NOT_SERVING");
  });
  it("fails when one secondary production alias changes without authorization", async () => {
    const split = { ...all, [domains[1]]: wrong };
    await expect(verifyAqFrozenBaselineLiveProduction(frozen, client(split).fetchImpl))
      .rejects.toThrow("AQ_FROZEN_BASELINE_NOT_SERVING");
  });
  it.each([
    { cost: 0.001 },
    { paid: true },
    { http: 503 },
    { type: "text/html" },
  ])("blocks unsafe health state: %j", async options => {
    await expect(verifyAqFrozenBaselineLiveProduction(frozen, client(all, options).fetchImpl))
      .rejects.toThrow("AQ_FROZEN_BASELINE_NOT_SERVING");
  });
  it("does not accept an unknown SHA or an automatic current-live baseline", async () => {
    for (const bad of ["", "main", "latest", "abc", undefined, "A".repeat(40)]) {
      await expect(verifyAqFrozenBaselineLiveProduction(bad, client(all).fetchImpl))
        .rejects.toThrow("AQ_FROZEN_BASELINE_SHA_INVALID");
    }
  });
});
