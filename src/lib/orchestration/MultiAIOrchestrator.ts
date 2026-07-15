export type AITaskType =
  | "implementation"
  | "review"
  | "security"
  | "ux"
  | "research"
  | "test"
  | "documentation"
  | "operations"
  | "architecture"
  | "current-information";

export type AIProviderId = string;
export type AIQuotaState = "available" | "limited" | "exhausted";

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
  paidOnly?: boolean;
  quotaState?: AIQuotaState;
  reliabilityScore?: number;
  expectedLatencyMs?: number;
  preferredFor: readonly AITaskType[];
  limitations: readonly string[];
}

export interface VerificationPlan {
  autoVerification: boolean;
  verificationProvider?: AIProviderId;
  steps: string[];
}

export interface AIRoutingDecision {
  taskType: AITaskType;
  selectedProvider: AIProviderId;
  selectedProviderName: string;
  reason: string;
  requiresHumanApproval: boolean;
  verificationProvider?: AIProviderId;
  verificationPlan: VerificationPlan;
}

const TASK_KEYWORDS: ReadonlyArray<[AITaskType, readonly string[]]> = [
  ["current-information", ["current-information", "最新情報", "リアルタイム", "ニュース"]],
  ["architecture", ["architecture", "設計", "アーキテクチャ", "構成"]],
  ["security", ["security", "脆弱", "認証", "権限", "secret", "cors", "xss"]],
  ["test", ["test", "テスト", "検証", "vitest", "jest", "playwright", "ci"]],
  ["review", ["review", "レビュー", "監査", "diff", "pr"]],
  ["ux", ["ux", "ui", "画面", "文言", "操作性", "デザイン"]],
  ["research", ["research", "調査", "比較", "最新", "仕様", "料金"]],
  ["documentation", ["document", "documentation", "ドキュメント", "readme", "手順書"]],
  ["operations", ["deploy", "deployment", "デプロイ", "dns", "運用", "本番"]],
  ["implementation", ["implement", "implementation", "実装", "修正", "コード", "開発"]],
];

const DANGEROUS_OPERATION_KEYWORDS = [
  "deploy",
  "deployment",
  "デプロイ",
  "merge",
  "マージ",
  "dns",
  "secret",
  "api key",
  "apiキー",
  "認証情報",
  "billing",
  "payment",
  "課金",
  "支払い",
  "有料化",
  "production",
  "本番",
  "account",
  "アカウント",
] as const;

export const DEFAULT_AI_CAPABILITIES: readonly AICapabilityProfile[] = [
  {
    id: "ai-studio-primary",
    displayName: "AI Studio Primary",
    capabilities: ["implementation", "test", "documentation"],
    available: true,
    freeOnly: true,
    quotaState: "available",
    reliabilityScore: 0.95,
    expectedLatencyMs: 1500,
    preferredFor: ["implementation", "test", "documentation"],
    limitations: ["GitHub push may require separate authentication", "No deployment authority"],
  },
  {
    id: "security-review-assistant",
    displayName: "Security Review Assistant",
    capabilities: ["security", "review"],
    available: true,
    freeOnly: true,
    quotaState: "available",
    reliabilityScore: 0.93,
    expectedLatencyMs: 1800,
    preferredFor: ["security"],
    limitations: ["Read-only review role", "Must not receive secrets"],
  },
  {
    id: "architecture-review-assistant",
    displayName: "Architecture Review Assistant",
    capabilities: ["architecture", "review"],
    available: true,
    freeOnly: true,
    quotaState: "available",
    reliabilityScore: 0.92,
    expectedLatencyMs: 1900,
    preferredFor: ["architecture"],
    limitations: ["Read-only review role"],
  },
  {
    id: "research-assistant",
    displayName: "Research Assistant",
    capabilities: ["research", "current-information"],
    available: true,
    freeOnly: true,
    quotaState: "available",
    reliabilityScore: 0.9,
    expectedLatencyMs: 2200,
    preferredFor: ["research", "current-information"],
    limitations: ["Current claims require source verification"],
  },
  {
    id: "ux-writing-assistant",
    displayName: "UX Writing Assistant",
    capabilities: ["ux", "documentation"],
    available: true,
    freeOnly: true,
    quotaState: "available",
    reliabilityScore: 0.89,
    expectedLatencyMs: 1700,
    preferredFor: ["ux"],
    limitations: ["No deployment authority"],
  },
  {
    id: "openrouter-free",
    displayName: "OpenRouter Free Specialist",
    capabilities: ["implementation", "research", "review", "security", "ux", "documentation", "test"],
    available: true,
    freeOnly: true,
    quotaState: "limited",
    reliabilityScore: 0.75,
    expectedLatencyMs: 3000,
    preferredFor: [],
    limitations: ["Only explicit :free models", "May be rate limited"],
  },
  {
    id: "external-review",
    displayName: "External Review Assistant",
    capabilities: ["review", "security", "test"],
    available: true,
    freeOnly: true,
    quotaState: "available",
    reliabilityScore: 0.88,
    expectedLatencyMs: 2100,
    preferredFor: ["review"],
    limitations: ["Read-only review role", "Must not receive secrets"],
  },
] as const;

export class CapabilityRegistry {
  private readonly profiles = new Map<AIProviderId, AICapabilityProfile>();

  constructor(initialProfiles: readonly AICapabilityProfile[] = DEFAULT_AI_CAPABILITIES) {
    for (const profile of initialProfiles) this.registerProfile(profile);
  }

  registerProfile(profile: AICapabilityProfile): void {
    this.profiles.set(profile.id, profile);
  }

  getProfile(id: AIProviderId): AICapabilityProfile | undefined {
    return this.profiles.get(id);
  }

  getAllProfiles(): AICapabilityProfile[] {
    return [...this.profiles.values()];
  }

  clear(): void {
    this.profiles.clear();
  }
}

export class TaskClassifier {
  static classify(request: AITaskRequest): AITaskType {
    return classifyTask(request);
  }
}

export function classifyTask(request: AITaskRequest): AITaskType {
  if (request.taskType) return request.taskType;

  const normalized = request.goal.toLowerCase();
  for (const [taskType, keywords] of TASK_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return taskType;
  }

  if (request.requiresFreshResearch) return "current-information";
  return request.requiresCodeChanges ? "implementation" : "review";
}

export function containsDangerousOperations(goal: string): boolean {
  const normalized = goal.toLowerCase();
  return DANGEROUS_OPERATION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function isAutomaticProvider(profile: AICapabilityProfile): boolean {
  const identity = `${profile.id} ${profile.displayName}`.toLowerCase();
  return identity.includes("openrouter/auto") || identity.includes("automatic") || /(^|[\s/_-])auto([\s/_-]|$)/.test(identity);
}

function isEligibleProfile(profile: AICapabilityProfile, taskType: AITaskType, freeOnly: boolean): boolean {
  if (!profile.available || profile.quotaState === "exhausted" || !profile.capabilities.includes(taskType)) return false;
  if (!freeOnly) return true;
  return profile.freeOnly && profile.paidOnly !== true && !isAutomaticProvider(profile);
}

function normalizedReliability(profile: AICapabilityProfile): number {
  const value = profile.reliabilityScore ?? 0.5;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

function normalizedLatency(profile: AICapabilityProfile): number {
  const value = profile.expectedLatencyMs ?? Number.POSITIVE_INFINITY;
  return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}

function rankProfiles(taskType: AITaskType, profiles: readonly AICapabilityProfile[]): AICapabilityProfile[] {
  return [...profiles].sort((left, right) => {
    const preferenceDifference = Number(right.preferredFor.includes(taskType)) - Number(left.preferredFor.includes(taskType));
    if (preferenceDifference !== 0) return preferenceDifference;

    const reliabilityDifference = normalizedReliability(right) - normalizedReliability(left);
    if (reliabilityDifference !== 0) return reliabilityDifference;

    const latencyDifference = normalizedLatency(left) - normalizedLatency(right);
    if (latencyDifference !== 0) return latencyDifference;

    return left.id.localeCompare(right.id);
  });
}

function selectProvider(taskType: AITaskType, eligible: readonly AICapabilityProfile[]): AICapabilityProfile {
  if (taskType === "implementation") {
    const aiStudioPrimary = eligible.find((profile) => profile.id === "ai-studio-primary");
    if (aiStudioPrimary) return aiStudioPrimary;

    const aiStudio = rankProfiles(
      taskType,
      eligible.filter((profile) => profile.id === "ai-studio" || profile.id.startsWith("ai-studio-")),
    )[0];
    if (aiStudio) return aiStudio;
  }

  return rankProfiles(taskType, eligible)[0];
}

function createVerificationPlan(
  taskType: AITaskType,
  selected: AICapabilityProfile,
  profiles: readonly AICapabilityProfile[],
  freeOnly: boolean,
): VerificationPlan {
  const verifier = rankProfiles(
    "review",
    profiles.filter(
      (profile) => profile.id !== selected.id && isEligibleProfile(profile, "review", freeOnly),
    ),
  )[0];

  const steps =
    taskType === "implementation"
      ? ["Run type checks and linting.", "Run the focused and full test suites.", "Review the final Git diff."]
      : taskType === "security"
        ? ["Audit permission boundaries, secret handling, and paid-provider exclusion.", "Add regression tests for each finding."]
        : ["Review the result against the task requirements.", "Record unresolved risks and evidence."];

  return {
    autoVerification: Boolean(verifier),
    verificationProvider: verifier?.id,
    steps,
  };
}

export class DeterministicRouter {
  static route(
    request: AITaskRequest,
    profiles: readonly AICapabilityProfile[] | CapabilityRegistry = DEFAULT_AI_CAPABILITIES,
    freeOnly = true,
  ): AIRoutingDecision {
    return routeTask(request, profiles, freeOnly);
  }
}

export function routeTask(
  request: AITaskRequest,
  profilesInput: readonly AICapabilityProfile[] | CapabilityRegistry = DEFAULT_AI_CAPABILITIES,
  freeOnly = true,
): AIRoutingDecision {
  const profiles = profilesInput instanceof CapabilityRegistry ? profilesInput.getAllProfiles() : profilesInput;
  const taskType = classifyTask(request);
  const eligible = profiles.filter((profile) => isEligibleProfile(profile, taskType, freeOnly));

  if (eligible.length === 0) {
    throw new Error(`No eligible free AI provider for task type: ${taskType}`);
  }

  const selected = selectProvider(taskType, eligible);
  const verificationPlan = createVerificationPlan(taskType, selected, profiles, freeOnly);
  const preferred = selected.preferredFor.includes(taskType);
  const aiStudioPrimaryEligible = eligible.some((profile) => profile.id === "ai-studio-primary");

  return {
    taskType,
    selectedProvider: selected.id,
    selectedProviderName: selected.displayName,
    reason:
      taskType === "implementation" && selected.id === "ai-studio-primary"
        ? `${selected.displayName} was selected as the primary implementation provider in free-only mode.`
        : taskType === "implementation" && !aiStudioPrimaryEligible
          ? `${selected.displayName} was selected as the deterministic free fallback because AI Studio Primary was unavailable, quota-exhausted, or otherwise ineligible.`
          : preferred
            ? `${selected.displayName} was selected as the preferred ${taskType} specialist with the strongest deterministic reliability and latency ranking.`
            : `${selected.displayName} was selected as the highest-ranked available free provider for ${taskType} tasks using reliability, latency, and stable provider-ID tie-breaking.`,
    requiresHumanApproval:
      taskType === "operations" || request.containsSecrets === true || containsDangerousOperations(request.goal),
    verificationProvider: verificationPlan.verificationProvider,
    verificationPlan,
  };
}

export class DelegationInstructionBuilder {
  static build(request: AITaskRequest, decision: AIRoutingDecision): string {
    return createDelegationInstruction(request, decision);
  }
}

export function createDelegationInstruction(request: AITaskRequest, decision: AIRoutingDecision): string {
  const safeGoal = request.containsSecrets
    ? "機密情報を除去した要約を人間が入力してください"
    : request.goal.trim();
  const approvalRule = decision.requiresHumanApproval
    ? "Stop before any privileged operation and request explicit owner approval."
    : "Continue only within the listed non-privileged task scope.";

  return [
    `Role: ${decision.selectedProviderName}`,
    `Task type: ${decision.taskType}`,
    `Goal: ${safeGoal}`,
    `Selection reason: ${decision.reason}`,
    "Cost policy: Use free-only capabilities. Never select paid or automatic models, including openrouter/auto.",
    "Context policy: Use only the minimum context required and never expose credentials.",
    approvalRule,
    "SAFETY MANDATES & PROHIBITIONS:",
    "- Do not merge code.",
    "- Do not deploy code or services.",
    "- Do not change DNS.",
    "- Do not enter, expose, or request secrets, credentials, or API keys.",
    "- Do not activate or configure paid plans.",
    "- Do not use paid or automatic models.",
    "Report changed files, tests, remaining risks, and the final commit SHA when applicable.",
  ].join("\n");
}
