import { describe, expect, it } from "vitest";

import {
  buildOriginAgentWorkPlan,
  originAgentWorkPlanInstruction,
} from "./OriginAgentWorkPlan";
import { classifyOriginRequestIntent } from "./OriginRequestIntent";

describe("OriginAgentWorkPlan", () => {
  it("keeps a plain conversation focused on understanding and verification", () => {
    const plan = buildOriginAgentWorkPlan(
      classifyOriginRequestIntent("考えを整理してください", "review"),
    );

    expect(plan.mode).toBe("conversation");
    expect(plan.steps.map((step) => step.kind)).toEqual([
      "understand-goal",
      "verify-output",
    ]);
    expect(plan.canCompleteInCurrentRelease).toBe(true);
    expect(plan.incompleteCapabilities).toEqual([]);
  });

  it("can produce an inline talk script without claiming a file artifact", () => {
    const plan = buildOriginAgentWorkPlan(
      classifyOriginRequestIntent("営業用のトークスクリプトを作ってください", "documentation"),
    );

    expect(plan.mode).toBe("deliverable");
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "clarify-requirements",
        requiredCapability: "requirement-clarification",
        availability: "available",
      }),
      expect.objectContaining({
        kind: "create-output",
        requiredCapability: "text-generation",
        availability: "available",
      }),
    ]));
    expect(plan.steps.find((step) => step.kind === "deliver-result")?.availability).toBe("available");
  });

  it("routes real slide generation through the verified artifact runtime", () => {
    const plan = buildOriginAgentWorkPlan(
      classifyOriginRequestIntent("提案スライドを作成してください", "documentation"),
    );

    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "design-output",
        availability: "available",
      }),
      expect.objectContaining({
        kind: "create-output",
        requiredCapability: "presentation-artifact-runtime",
        availability: "available",
      }),
    ]));
    expect(plan.canCompleteInCurrentRelease).toBe(true);
  });

  it("routes live research but keeps unconnected website creation partial", () => {
    const intent = classifyOriginRequestIntent(
      "市場を調査してホームページを完成まで制作してください",
      "research",
    );
    const plan = buildOriginAgentWorkPlan(intent);
    const instruction = originAgentWorkPlanInstruction(plan);

    expect(plan.mode).toBe("agent-workflow");
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requiredCapability: "live-research",
        availability: "available",
      }),
      expect.objectContaining({
        requiredCapability: "website-workspace-runtime",
        availability: "partial",
      }),
    ]));
    expect(plan.incompleteCapabilities).toContain("website-workspace-runtime");
    expect(plan.incompleteCapabilities).not.toContain("live-research");
    expect(instruction).toContain("not proof that any step ran");
    expect(instruction).toContain("Never present an uncreated file");
  });

  it("handles future output types without changing the planner", () => {
    const plan = buildOriginAgentWorkPlan({
      primaryTask: "review",
      interactionMode: "deliverable",
      requiredCapabilities: ["video-generation"],
      requestedOutputs: ["video"],
      suggestedOutputs: [],
    });

    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requiredCapability: "output-service:video",
        availability: "partial",
      }),
    ]));
  });
});
