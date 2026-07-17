import { describe, expect, it } from "vitest";
import {
  CapabilityRegistry,
  DEFAULT_AI_CAPABILITIES,
  DelegationInstructionBuilder,
  DeterministicRouter,
  TaskClassifier,
  classifyTask,
  containsDangerousOperations,
  createDelegationInstruction,
  routeTask,
  type AICapabilityProfile,
} from "./MultiAIOrchestrator";

describe("MultiAIOrchestrator", () => {
  it("selects AI Studio Primary for implementation", () => {
    const decision = routeTask({ goal: "新しいAPIを実装してください", requiresCodeChanges: true });
    expect(decision.taskType).toBe("implementation");
    expect(decision.selectedProvider).toBe("ai-studio-primary");
    expect(decision.reason).toContain("primary implementation provider");
  });

  it("delegates security work to the security specialist", () => {
    const decision = routeTask({ goal: "CORSと認証のセキュリティレビューをしてください" });
    expect(decision.taskType).toBe("security");
    expect(decision.selectedProvider).toBe("security-review-assistant");
  });

  it("delegates research work to the research specialist", () => {
    const decision = routeTask({ goal: "LLMの料金を調査してください" });
    expect(decision.taskType).toBe("research");
    expect(decision.selectedProvider).toBe("research-assistant");
  });

  it("classifies Japanese UX requests", () => {
    expect(classifyTask({ goal: "画面の操作性と文言を改善する" })).toBe("ux");
  });

  it("classifies architecture before generic research terms", () => {
    expect(TaskClassifier.classify({ goal: "最新構成のアーキテクチャ設計をレビューする" })).toBe("architecture");
  });

  it("classifies explicit fresh-research requests as current information", () => {
    expect(classifyTask({ goal: "更新状況を確認する", requiresFreshResearch: true })).toBe("current-information");
  });

  it.each([
    "本番へデプロイする",
    "このPRをマージする",
    "DNSを変更する",
    "APIキーを入力する",
    "課金設定を変更する",
    "production accountを更新する",
  ])("requires human approval for dangerous goal: %s", (goal) => {
    const profiles: readonly AICapabilityProfile[] = [
      {
        id: "safe-operations-planner",
        displayName: "Safe Operations Planner",
        capabilities: ["operations", "documentation"],
        available: true,
        freeOnly: true,
        preferredFor: ["operations", "documentation"],
        limitations: [],
      },
    ];
    const decision = routeTask({ goal, taskType: "documentation" }, profiles);
    expect(decision.requiresHumanApproval).toBe(true);
  });

  it("detects dangerous operations independently of task classification", () => {
    expect(containsDangerousOperations("READMEを更新してから本番へデプロイする")).toBe(true);
  });

  it("rejects paid-only providers in free-only mode", () => {
    const profiles: readonly AICapabilityProfile[] = [
      {
        id: "paid-security",
        displayName: "Paid Security",
        capabilities: ["security"],
        available: true,
        freeOnly: true,
        paidOnly: true,
        preferredFor: ["security"],
        limitations: [],
      },
    ];
    expect(() => routeTask({ goal: "security review" }, profiles, true)).toThrow("No eligible free AI provider");
  });

  it("rejects providers marked freeOnly false", () => {
    const profiles: readonly AICapabilityProfile[] = [
      {
        id: "not-free",
        displayName: "Not Free",
        capabilities: ["review"],
        available: true,
        freeOnly: false,
        preferredFor: ["review"],
        limitations: [],
      },
    ];
    expect(() => routeTask({ goal: "review" }, profiles, true)).toThrow("No eligible free AI provider");
  });

  it("rejects OpenRouter auto providers", () => {
    const profiles: readonly AICapabilityProfile[] = [
      {
        id: "openrouter/auto",
        displayName: "OpenRouter Auto",
        capabilities: ["research"],
        available: true,
        freeOnly: true,
        preferredFor: ["research"],
        limitations: [],
      },
    ];
    expect(() => routeTask({ goal: "料金を調査する" }, profiles, true)).toThrow("No eligible free AI provider");
  });

  it("falls back to a free implementation provider when AI Studio is unavailable", () => {
    const profiles = DEFAULT_AI_CAPABILITIES.map((profile) =>
      profile.id === "ai-studio-primary" ? { ...profile, available: false } : profile,
    );
    const decision = routeTask({ goal: "コードを実装する" }, profiles, true);
    expect(decision.selectedProvider).toBe("openrouter-free");
  });

  it("stops safely when no eligible provider exists", () => {
    expect(() => routeTask({ goal: "コードを実装する" }, [], true)).toThrow("No eligible free AI provider");
  });

  it("always returns a non-empty selection reason", () => {
    expect(routeTask({ goal: "セキュリティを確認する" }).reason.trim().length).toBeGreaterThan(0);
  });

  it("uses a different provider for verification", () => {
    const decision = DeterministicRouter.route({ goal: "コードを実装する" });
    expect(decision.verificationProvider).toBeDefined();
    expect(decision.verificationProvider).not.toBe(decision.selectedProvider);
    expect(decision.verificationPlan.autoVerification).toBe(true);
  });

  it("registers configurable profiles and lets the latest duplicate win", () => {
    const registry = new CapabilityRegistry([]);
    const first: AICapabilityProfile = {
      id: "custom",
      displayName: "First",
      capabilities: ["review"],
      available: true,
      freeOnly: true,
      preferredFor: ["review"],
      limitations: [],
    };
    registry.registerProfile(first);
    registry.registerProfile({ ...first, displayName: "Second" });
    expect(registry.getProfile("custom")?.displayName).toBe("Second");
  });

  it("routes using a CapabilityRegistry", () => {
    const registry = new CapabilityRegistry([
      {
        id: "custom-research",
        displayName: "Custom Research",
        capabilities: ["research"],
        available: true,
        freeOnly: true,
        preferredFor: ["research"],
        limitations: [],
      },
    ]);
    expect(routeTask({ goal: "料金を調査する", registry }).selectedProvider).toBe("custom-research");
  });

  it("does not include a secret-bearing goal in delegation instructions", () => {
    const privateValue = ["s", "k", "-", "sample", "private", "value"].join("");
    const request = { goal: `APIキー ${privateValue} を使って確認する`, taskType: "documentation" as const, containsSecrets: true };
    const decision = routeTask(request);
    const instruction = createDelegationInstruction(request, decision);
    expect(instruction).not.toContain(privateValue);
    expect(instruction).toContain("目的 (goal): [REDACTED]");
  });

  it("creates localized structured instructions without raw provider labels", () => {
    const request = { goal: "認証処理を確認する" };
    const instruction = createDelegationInstruction(request, routeTask(request));
    expect(instruction).toContain("担当 (role): セキュリティレビュー担当AI");
    expect(instruction).toContain("タスク種別 (task_type): セキュリティ確認");
    expect(instruction).toContain("選定理由 (selection_reason):");
    expect(instruction).not.toContain("Security Review Assistant");
    expect(instruction).not.toContain("Task type: security");
  });

  it("includes every permission and cost prohibition", () => {
    const request = { goal: "実装計画を作る", requiresCodeChanges: true };
    const instruction = DelegationInstructionBuilder.build(request, routeTask(request));
    expect(instruction).toContain("コードをマージしないでください");
    expect(instruction).toContain("コードやサービスをデプロイしないでください");
    expect(instruction).toContain("DNSを変更しないでください");
    expect(instruction).toContain("秘密情報、認証情報、APIキーを入力・表示・要求しないでください");
    expect(instruction).toContain("有料プランを有効化・設定しないでください");
    expect(instruction).toContain("有料モデルまたは自動選択モデルを使用しないでください");
    expect(instruction).toContain("openrouter/auto");
  });

  it("preserves explicit task type while still applying safety approval", () => {
    const decision = routeTask({ goal: "本番へデプロイする手順を書く", taskType: "documentation" });
    expect(decision.taskType).toBe("documentation");
    expect(decision.requiresHumanApproval).toBe(true);
  });
});
