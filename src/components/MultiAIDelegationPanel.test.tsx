import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MultiAIDelegationPanel from "./MultiAIDelegationPanel";
import {
  createDelegationInstruction,
  DEFAULT_AI_CAPABILITIES,
  routeTask,
  type AICapabilityProfile,
} from "../lib/orchestration/MultiAIOrchestrator";

const humanApprovalGate: AICapabilityProfile = {
  id: "human-approval-gate",
  displayName: "Human Approval Gate",
  capabilities: ["operations"],
  available: true,
  freeOnly: true,
  preferredFor: ["operations"],
  limitations: ["Does not execute operations", "Requires explicit owner approval"],
};

const plannerProfiles: readonly AICapabilityProfile[] = [
  ...DEFAULT_AI_CAPABILITIES,
  humanApprovalGate,
];

afterEach(() => {
  cleanup();
});

describe("MultiAIDelegationPanel", () => {
  it("opens the delegation planner without affecting the surrounding app", () => {
    render(<MultiAIDelegationPanel />);

    fireEvent.click(screen.getByTestId("multi-ai-planner-open"));

    expect(screen.getByRole("dialog", { name: "AI作業振り分け" })).toBeTruthy();
  });

  it("routes implementation work to AI Studio Primary", () => {
    const decision = routeTask(
      { goal: "新しい画面を実装してください", requiresCodeChanges: true },
      plannerProfiles,
    );

    expect(decision.taskType).toBe("implementation");
    expect(decision.selectedProvider).toBe("ai-studio-primary");
    expect(decision.selectedProviderName).toBe("AI Studio Primary");
  });

  it("routes production deployment to the human approval gate", () => {
    const decision = routeTask(
      { goal: "本番へデプロイしてください" },
      plannerProfiles,
    );

    expect(decision.taskType).toBe("operations");
    expect(decision.selectedProvider).toBe("human-approval-gate");
    expect(decision.requiresHumanApproval).toBe(true);
  });

  it("generates a secret-safe copy instruction", () => {
    const request = {
      goal: "APIキー secret-value を確認してください",
      containsSecrets: true,
    };
    const decision = routeTask(request, plannerProfiles);
    const instruction = createDelegationInstruction(request, decision);

    expect(instruction).toContain("機密情報を除去した要約を人間が入力してください");
    expect(instruction).not.toContain("secret-value");
  });
});
