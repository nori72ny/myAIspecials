import { describe, expect, it } from "vitest";
import {
  providerDisplayName,
  selectionReason,
  taskDisplayName,
  verificationDescription,
} from "./DelegationPresentation";
import type { AIRoutingDecision } from "./MultiAIOrchestrator";

function decision(overrides: Partial<AIRoutingDecision> = {}): AIRoutingDecision {
  return {
    taskType: "security",
    selectedProvider: "security-review-assistant",
    selectedProviderName: "Security Review Assistant",
    reason: "Preferred specialist",
    requiresHumanApproval: false,
    verificationProvider: "external-review",
    verificationPlan: {
      autoVerification: true,
      verificationProvider: "external-review",
      steps: ["Review"],
    },
    ...overrides,
  };
}

describe("DelegationPresentation", () => {
  it("keeps internal task IDs out of user-facing labels", () => {
    expect(taskDisplayName("current-information")).toBe("最新情報の確認");
    expect(taskDisplayName("security")).toBe("セキュリティ確認");
  });

  it("localizes known provider IDs without exposing internal English names", () => {
    expect(providerDisplayName("security-review-assistant")).toBe("セキュリティレビュー担当AI");
    expect(providerDisplayName("external-review")).toBe("独立レビュー担当AI");
    expect(providerDisplayName(undefined)).toBe("自動テストによる確認");
  });

  it("uses a safe generic label for future providers", () => {
    expect(providerDisplayName("future-model-v9")).toBe("登録済みの専門担当AI");
  });

  it("explains the routing decision using the detected task", () => {
    const text = selectionReason(decision());
    expect(text).toContain("認証・権限・秘密情報");
    expect(text).toContain("無料枠");
    expect(text).not.toContain("security-review-assistant");
    expect(text).not.toContain("Security Review Assistant");
  });

  it("explains fallback without claiming a paid or automatic upgrade", () => {
    const text = selectionReason(decision({ reason: "fallback selected" }));
    expect(text).toContain("第一候補が利用できない");
    expect(text).toContain("無料枠内");
    expect(text).not.toContain("有料");
  });

  it("makes human approval explicit for privileged operations", () => {
    const text = selectionReason(decision({
      taskType: "operations",
      selectedProvider: "human-approval-gate",
      selectedProviderName: "Human Approval Gate",
      requiresHumanApproval: true,
    }));
    expect(text).toContain("自動実行は行わず");
    expect(text).toContain("明示承認");
  });

  it("describes independent verification in Japanese", () => {
    expect(verificationDescription("external-review")).toBe(
      "独立レビュー担当AIが、主担当とは別の視点で結果を確認します。",
    );
  });
});
