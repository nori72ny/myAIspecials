import { describe, expect, it } from "vitest";

import { buildOriginAgentWorkPlan, originAgentWorkPlanInstruction } from "./OriginAgentWorkPlan";
import { classifyOriginRequestIntent } from "./OriginRequestIntent";

describe("OriginAgentWorkPlan", () => {
  it("keeps a plain conversation focused on understanding and verification", () => {
    const plan = buildOriginAgentWorkPlan(classifyOriginRequestIntent("考えを整理してください", "review"));
    expect(plan.mode).toBe("conversation");
    expect(plan.steps.map((step) => step.kind)).toEqual(["understand-goal", "verify-output"]);
    expect(plan.steps.map((step) => step.aiRole)).toEqual(["THINK", "VERIFY"]);
    expect(plan.canCompleteInCurrentRelease).toBe(true);
    expect(plan.incompleteCapabilities).toEqual([]);
  });

  it("can produce an inline talk script without claiming a file artifact", () => {
    const plan = buildOriginAgentWorkPlan(classifyOriginRequestIntent("営業用のトークスクリプトを作ってください", "documentation"));
    expect(plan.mode).toBe("deliverable");
    expect(plan.steps).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "create-output", aiRole: "BUILD", requiredCapability: "text-generation", availability: "available",
    })]));
    expect(plan.steps.find((step) => step.kind === "deliver-result")?.availability).toBe("available");
  });

  it("marks real slide generation as partial while preserving content design", () => {
    const plan = buildOriginAgentWorkPlan(classifyOriginRequestIntent("提案スライドを作成してください", "documentation"));
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "design-output", aiRole: "THINK", availability: "available" }),
      expect.objectContaining({ kind: "create-output", aiRole: "BUILD", requiredCapability: "presentation-artifact-runtime", availability: "partial" }),
    ]));
    expect(plan.canCompleteInCurrentRelease).toBe(false);
  });

  it("does not present live research or website creation as executed", () => {
    const plan = buildOriginAgentWorkPlan(classifyOriginRequestIntent("市場を調査してホームページを完成まで制作してください", "research"));
    const instruction = originAgentWorkPlanInstruction(plan);
    expect(plan.mode).toBe("agent-workflow");
    expect(plan.incompleteCapabilities).toEqual(expect.arrayContaining(["live-research", "website-workspace-runtime"]));
    expect(plan.steps).toEqual(expect.arrayContaining([expect.objectContaining({ aiRole: "RESEARCH", availability: "unavailable" })]));
    expect(instruction).toContain("not proof that any step ran");
    expect(instruction).toContain("Never present an uncreated file");
  });

  it("routes requested external operations to ACT without claiming execution", () => {
    const intent = classifyOriginRequestIntent("サイトを操作して予約を完了してください", "review");
    const plan = buildOriginAgentWorkPlan(intent);
    expect(intent.requiredCapabilities).toContain("computer-action");
    expect(plan.steps).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "execute-action", aiRole: "ACT", requiredCapability: "external-action", availability: "unavailable",
    })]));
    expect(plan.canCompleteInCurrentRelease).toBe(false);
  });

  it("documents the five stable roles instead of future model brands", () => {
    const instruction = originAgentWorkPlanInstruction(buildOriginAgentWorkPlan(
      classifyOriginRequestIntent("考えを整理してください", "review"),
    ));
    for (const role of ["THINK", "RESEARCH", "BUILD", "ACT", "VERIFY"]) expect(instruction).toContain(role);
    expect(instruction).toContain("never by brand preference or an unverified future model name");
  });

  it("handles future output types without changing the planner", () => {
    const plan = buildOriginAgentWorkPlan({
      primaryTask: "review", interactionMode: "deliverable", requiredCapabilities: ["video-generation"], requestedOutputs: ["video"], suggestedOutputs: [],
    });
    expect(plan.steps).toEqual(expect.arrayContaining([expect.objectContaining({
      aiRole: "BUILD", requiredCapability: "output-service:video", availability: "partial",
    })]));
  });
});
