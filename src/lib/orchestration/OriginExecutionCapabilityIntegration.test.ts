import { describe, expect, it } from "vitest";
import { buildOriginExecutionPlan } from "./OriginExecutionPolicy.js";

function planFor(goal: string) {
  const result = buildOriginExecutionPlan(
    { goal },
    { openRouterConfigured: true },
    undefined,
    { nowMs: Date.now() },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

describe("ORIGIN v2 capability routing integration", () => {
  it("maps research capability to the research execution task", () => {
    expect(planFor("最新情報を出典付きで調査して").taskType).toBe("research");
  });

  it("maps coding capability to implementation without changing provider policy", () => {
    const plan = planFor("TypeScriptのバグを修正してテストを追加");
    expect(plan.taskType).toBe("implementation");
    expect(plan.providerId).toBe("openrouter-free");
    expect(plan.modelId).toBe("google/gemma-4-31b-it:free");
    expect(plan.freeOnly).toBe(true);
    expect(plan.estimatedCostUsd).toBe(0);
  });

  it("maps writing capability to documentation", () => {
    expect(planFor("この文章を丁寧なメールに書き直して").taskType).toBe("documentation");
  });

  it("maps analysis capability to review", () => {
    expect(planFor("この設計を分析してリスクをレビューして").taskType).toBe("review");
  });

  it("does not override an explicit execution task type", () => {
    expect(planFor("最新のコードを調査して、TypeScriptを修正",).taskType).toBe("implementation");
    const result = buildOriginExecutionPlan(
      { goal: "最新情報を調査して", taskType: "architecture" },
      { openRouterConfigured: true },
      undefined,
      { nowMs: Date.now() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.taskType).toBe("architecture");
  });
});
