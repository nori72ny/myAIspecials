import { describe, expect, it } from "vitest";

import { buildOriginAgentWorkPlan } from "./OriginAgentWorkPlan";
import { classifyOriginRequestIntent } from "./OriginRequestIntent";
import {
  OriginServiceRegistry,
  originServiceAssignmentInstruction,
  resolveOriginAgentWorkPlan,
  type OriginServiceRegistration,
} from "./OriginServiceRegistry";

function service(
  patch: Partial<OriginServiceRegistration> = {},
): OriginServiceRegistration {
  return {
    id: "test-service",
    label: "Test Service",
    adapterId: "test-adapter",
    capabilities: ["test-capability"],
    available: true,
    freeOnly: true,
    maxEstimatedCostUsd: 0,
    automaticFallback: false,
    qualityEvidence: {
      testIds: ["test-service-contract"],
      validatedAt: "2026-07-24",
    },
    ...patch,
  };
}

describe("OriginServiceRegistry", () => {
  it("assigns the verified text runtime to supported work steps", () => {
    const plan = buildOriginAgentWorkPlan(
      classifyOriginRequestIntent("営業用トークスクリプトを作ってください", "documentation"),
    );
    const resolved = resolveOriginAgentWorkPlan(plan);

    expect(resolved.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requiredCapability: "text-generation",
        serviceId: "origin-text-runtime",
        status: "assigned",
      }),
    ]));
  });

  it("does not assign unconnected search or website runtimes", () => {
    const plan = buildOriginAgentWorkPlan(
      classifyOriginRequestIntent(
        "市場を調査してホームページを完成まで制作してください",
        "research",
      ),
    );
    const resolved = resolveOriginAgentWorkPlan(plan);

    expect(resolved.unavailableCapabilities).toContain("live-research");
    expect(resolved.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requiredCapability: "website-workspace-runtime",
        status: "partial",
      }),
    ]));
    expect(originServiceAssignmentInstruction(resolved)).toContain(
      "not proof of completed execution",
    );
  });

  it("rejects a paid or automatic fallback service", () => {
    const registry = new OriginServiceRegistry([]);
    const result = registry.register(service({
      maxEstimatedCostUsd: 1 as 0,
      automaticFallback: true as false,
    }));

    expect(result).toEqual({ ok: false, code: "INVALID_COST_POLICY" });
    expect(registry.findAvailable("test-capability")).toBeUndefined();
  });

  it("rejects an available service without quality evidence", () => {
    const registry = new OriginServiceRegistry([]);
    const result = registry.register(service({
      qualityEvidence: { testIds: [], validatedAt: "" },
    }));

    expect(result).toEqual({ ok: false, code: "MISSING_QUALITY_EVIDENCE" });
  });

  it("supports a future service without changing routing code", () => {
    const registry = new OriginServiceRegistry([service({
      id: "video-runtime",
      capabilities: ["video-generation"],
    })]);

    expect(registry.findAvailable("video-generation")?.id).toBe("video-runtime");
  });
});
