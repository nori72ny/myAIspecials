import { describe, expect, it } from "vitest";
import {
  classifyTask,
  createDelegationInstruction,
  routeTask,
  type AICapabilityProfile,
} from "./MultiAIOrchestrator";

describe("MultiAIOrchestrator", () => {
  it("selects AI Studio by default for implementation", () => {
    const decision = routeTask({ goal: "新しいAPIを実装してください", requiresCodeChanges: true });

    expect(decision.taskType).toBe("implementation");
    expect(decision.selectedProvider).toBe("ai-studio");
    expect(decision.reason).toContain("preferred");
  });

  it("delegates security review to the specialist", () => {
    const decision = routeTask({ goal: "CORSと認証のセキュリティレビューをしてください" });

    expect(decision.taskType).toBe("security");
    expect(decision.selectedProvider).toBe("external-review");
  });

  it("classifies Japanese UX requests", () => {
    expect(classifyTask({ goal: "画面の操作性と文言を改善する" })).toBe("ux");
  });

  it("requires owner approval for operations", () => {
    const profiles: readonly AICapabilityProfile[] = [
      {
        id: "openrouter-free",
        displayName: "Operations Planner",
        capabilities: ["operations"],
        available: true,
        freeOnly: true,
        preferredFor: ["operations"],
        limitations: [],
      },
    ];
    const decision = routeTask({ goal: "本番へデプロイする", taskType: "operations" }, profiles);

    expect(decision.requiresHumanApproval).toBe(true);
  });

  it("rejects paid-only providers in free-only mode", () => {
    const paidOnly: readonly AICapabilityProfile[] = [
      {
        id: "external-review",
        displayName: "Paid Provider",
        capabilities: ["security"],
        available: true,
        freeOnly: false,
        preferredFor: ["security"],
        limitations: [],
      },
    ];

    expect(() => routeTask({ goal: "security review" }, paidOnly, true)).toThrow(
      "No eligible free AI provider",
    );
  });

  it("generates a copyable delegation instruction with safety gates", () => {
    const request = { goal: "Implement a deterministic router", requiresCodeChanges: true };
    const decision = routeTask(request);
    const instruction = createDelegationInstruction(request, decision);

    expect(instruction).toContain("Role: AI Studio");
    expect(instruction).toContain("Never select paid or automatic models");
    expect(instruction).toContain("Do not deploy, merge, change DNS, enter secrets");
  });
});
