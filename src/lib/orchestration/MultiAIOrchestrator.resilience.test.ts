import { describe, expect, it } from "vitest";
import { routeTask, type AICapabilityProfile } from "./MultiAIOrchestrator";

function profile(
  id: string,
  overrides: Partial<AICapabilityProfile> = {},
): AICapabilityProfile {
  return {
    id,
    displayName: id,
    capabilities: ["review"],
    available: true,
    freeOnly: true,
    quotaState: "available",
    reliabilityScore: 0.8,
    expectedLatencyMs: 2000,
    preferredFor: [],
    limitations: [],
    ...overrides,
  };
}

describe("MultiAIOrchestrator resilience scoring", () => {
  it("never selects a quota-exhausted provider", () => {
    const profiles = [
      profile("preferred-exhausted", {
        preferredFor: ["review"],
        quotaState: "exhausted",
        reliabilityScore: 1,
        expectedLatencyMs: 1,
      }),
      profile("available-fallback", {
        reliabilityScore: 0.7,
        expectedLatencyMs: 2500,
      }),
    ];

    const decision = routeTask({ goal: "PRをレビューする" }, profiles);
    expect(decision.selectedProvider).toBe("available-fallback");
  });

  it("keeps AI Studio Primary for implementation while eligible", () => {
    const profiles = [
      profile("faster-alternative", {
        capabilities: ["implementation"],
        reliabilityScore: 1,
        expectedLatencyMs: 1,
        preferredFor: ["implementation"],
      }),
      profile("ai-studio-primary", {
        capabilities: ["implementation"],
        reliabilityScore: 0.6,
        expectedLatencyMs: 5000,
        preferredFor: ["implementation"],
      }),
    ];

    expect(routeTask({ goal: "APIを実装する" }, profiles).selectedProvider).toBe("ai-studio-primary");
  });

  it("falls back when AI Studio Primary quota is exhausted", () => {
    const profiles = [
      profile("ai-studio-primary", {
        capabilities: ["implementation"],
        quotaState: "exhausted",
        preferredFor: ["implementation"],
      }),
      profile("free-implementation-fallback", {
        capabilities: ["implementation"],
        reliabilityScore: 0.9,
        expectedLatencyMs: 1200,
      }),
    ];

    const decision = routeTask({ goal: "コードを実装する" }, profiles);
    expect(decision.selectedProvider).toBe("free-implementation-fallback");
    expect(decision.reason).toContain("deterministic free fallback");
  });

  it("prefers the more reliable candidate before latency", () => {
    const profiles = [
      profile("fast-less-reliable", {
        reliabilityScore: 0.8,
        expectedLatencyMs: 100,
      }),
      profile("slow-more-reliable", {
        reliabilityScore: 0.95,
        expectedLatencyMs: 3000,
      }),
    ];

    expect(routeTask({ goal: "PRをレビューする" }, profiles).selectedProvider).toBe("slow-more-reliable");
  });

  it("uses lower latency when reliability is equal", () => {
    const profiles = [
      profile("slow", { reliabilityScore: 0.9, expectedLatencyMs: 3000 }),
      profile("fast", { reliabilityScore: 0.9, expectedLatencyMs: 500 }),
    ];

    expect(routeTask({ goal: "PRをレビューする" }, profiles).selectedProvider).toBe("fast");
  });

  it("uses provider ID as a stable final tie-breaker independent of input order", () => {
    const alpha = profile("alpha");
    const beta = profile("beta");

    const forward = routeTask({ goal: "PRをレビューする" }, [beta, alpha]);
    const reverse = routeTask({ goal: "PRをレビューする" }, [alpha, beta]);

    expect(forward.selectedProvider).toBe("alpha");
    expect(reverse.selectedProvider).toBe("alpha");
  });

  it("stops safely when every free provider is exhausted", () => {
    const profiles = [
      profile("exhausted-one", { quotaState: "exhausted" }),
      profile("exhausted-two", { quotaState: "exhausted" }),
    ];

    expect(() => routeTask({ goal: "PRをレビューする" }, profiles)).toThrow(
      "No eligible free AI provider",
    );
  });

  it("selects the verifier deterministically and never reuses the executor", () => {
    const profiles = [
      profile("executor", {
        capabilities: ["implementation"],
        preferredFor: ["implementation"],
      }),
      profile("review-z", {
        capabilities: ["review"],
        reliabilityScore: 0.9,
        expectedLatencyMs: 1000,
      }),
      profile("review-a", {
        capabilities: ["review"],
        reliabilityScore: 0.9,
        expectedLatencyMs: 1000,
      }),
    ];

    const decision = routeTask(
      { goal: "コードを実装する", taskType: "implementation" },
      profiles,
    );

    expect(decision.selectedProvider).toBe("executor");
    expect(decision.verificationProvider).toBe("review-a");
  });
});
