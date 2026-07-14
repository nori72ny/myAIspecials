export type AITaskType =
  | "implementation"
  | "review"
  | "security"
  | "ux"
  | "research"
  | "test"
  | "documentation"
  | "operations";

export type AIProviderId = "ai-studio" | "openrouter-free" | "external-review";

export interface AITaskRequest {
  goal: string;
  taskType?: AITaskType;
  requiresCodeChanges?: boolean;
  requiresFreshResearch?: boolean;
  containsSecrets?: boolean;
}

export interface AICapabilityProfile {
  id: AIProviderId;
  displayName: string;
  capabilities: readonly AITaskType[];
  available: boolean;
  freeOnly: boolean;
  preferredFor: readonly AITaskType[];
  limitations: readonly string[];
}

export interface AIRoutingDecision {
  taskType: AITaskType;
  selectedProvider: AIProviderId;
  selectedProviderName: string;
  reason: string;
  requiresHumanApproval: boolean;
  verificationProvider?: AIProviderId;
}

const TASK_KEYWORDS: ReadonlyArray<[AITaskType, readonly string[]]> = [
  ["security", ["security", "脆弱", "認証", "権限", "secret", "cors", "xss"]],
  ["test", ["test", "テスト", "検証", "vitest", "jest", "playwright", "ci"]],
  ["review", ["review", "レビュー", "監査", "diff", "pr"]],
  ["ux", ["ux", "ui", "画面", "文言", "操作性", "デザイン"]],
  ["research", ["research", "調査", "比較", "最新", "仕様", "料金"]],
  ["documentation", ["document", "documentation", "ドキュメント", "readme", "手順書"]],
  ["operations", ["deploy", "deployment", "デプロイ", "dns", "運用", "本番"]],
  ["implementation", ["implement", "implementation", "実装", "修正", "コード", "開発"]],
];

export const DEFAULT_AI_CAPABILITIES: readonly AICapabilityProfile[] = [
  {
    id: "ai-studio",
    displayName: "AI Studio",
    capabilities: ["implementation", "test", "documentation", "ux", "review"],
    available: true,
    freeOnly: true,
    preferredFor: ["implementation", "test", "documentation"],
    limitations: ["GitHub push may require separate authentication", "No deployment authority"],
  },
  {
    id: "openrouter-free",
    displayName: "OpenRouter Free Specialist",
    capabilities: ["research", "review", "security", "ux", "documentation"],
    available: true,
    freeOnly: true,
    preferredFor: ["research", "ux"],
    limitations: ["Only explicit :free models", "May be rate limited"],
  },
  {
    id: "external-review",
    displayName: "External Review Assistant",
    capabilities: ["review", "security", "test"],
    available: true,
    freeOnly: true,
    preferredFor: ["review", "security"],
    limitations: ["Read-only review role", "Must not receive secrets"],
  },
] as const;

export function classifyTask(request: AITaskRequest): AITaskType {
  if (request.taskType) return request.taskType;

  const normalized = request.goal.toLowerCase();
  for (const [taskType, keywords] of TASK_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return taskType;
  }

  return request.requiresCodeChanges ? "implementation" : "review";
}

export function routeTask(
  request: AITaskRequest,
  profiles: readonly AICapabilityProfile[] = DEFAULT_AI_CAPABILITIES,
  freeOnly = true,
): AIRoutingDecision {
  const taskType = classifyTask(request);
  const eligible = profiles.filter(
    (profile) =>
      profile.available &&
      profile.capabilities.includes(taskType) &&
      (!freeOnly || profile.freeOnly),
  );

  if (eligible.length === 0) {
    throw new Error(`No eligible free AI provider for task type: ${taskType}`);
  }

  const preferred = eligible.find((profile) => profile.preferredFor.includes(taskType));
  const aiStudio = eligible.find((profile) => profile.id === "ai-studio");
  const selected = preferred ?? aiStudio ?? eligible[0];

  const verificationProvider = eligible.find(
    (profile) => profile.id !== selected.id && profile.capabilities.includes("review"),
  )?.id;

  const requiresHumanApproval =
    taskType === "operations" || request.containsSecrets === true;

  return {
    taskType,
    selectedProvider: selected.id,
    selectedProviderName: selected.displayName,
    reason: selected.preferredFor.includes(taskType)
      ? `${selected.displayName} is preferred for ${taskType} tasks and is available in free-only mode.`
      : `${selected.displayName} is the best available free provider for ${taskType}.`,
    requiresHumanApproval,
    verificationProvider,
  };
}

export function createDelegationInstruction(
  request: AITaskRequest,
  decision: AIRoutingDecision,
): string {
  const approvalRule = decision.requiresHumanApproval
    ? "Stop before deployment, secrets handling, paid-plan activation, DNS changes, or merging and request owner approval."
    : "Do not deploy, merge, change DNS, enter secrets, or activate paid plans.";

  return [
    `Role: ${decision.selectedProviderName}`,
    `Task type: ${decision.taskType}`,
    `Goal: ${request.goal.trim()}`,
    "Cost policy: Use free-only capabilities. Never select paid or automatic models.",
    "Context policy: Use only the minimum context required and never expose credentials.",
    approvalRule,
    "Report changed files, tests, remaining risks, and the final commit SHA when applicable.",
  ].join("\n");
}
