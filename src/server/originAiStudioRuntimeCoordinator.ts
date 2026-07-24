import {
  buildOriginAiStudioRuntimePlan,
  DEFAULT_ORIGIN_AI_STUDIO_FREE_MODEL_CATALOG,
  isOriginAiStudioRuntimeEnabled,
  type OriginAiStudioFreeModelEvidence,
  type OriginAiStudioRuntimePlanResult,
} from "../lib/orchestration/OriginAiStudioRuntimePolicy";
import {
  executeOriginAiStudioOfflineContract,
  type OriginAiStudioOfflineExecutionResult,
} from "../lib/orchestration/OriginAiStudioOfflineExecutor";
import {
  createOriginAiStudioInteractionsTransport,
  ORIGIN_AI_STUDIO_API_KEY_ENV,
  type OriginFetch,
} from "./originAiStudioInteractionsAdapter";

export interface OriginAiStudioApprovalGate {
  consumeApproval(): boolean;
}

export const DENY_ALL_ORIGIN_AI_STUDIO_APPROVAL_GATE: OriginAiStudioApprovalGate =
  Object.freeze({
    consumeApproval: () => false,
  });

export interface OriginAiStudioRuntimeCoordinatorOptions {
  env: Readonly<Record<string, string | undefined>>;
  catalog?: readonly OriginAiStudioFreeModelEvidence[];
  approvalGate?: OriginAiStudioApprovalGate;
  fetchImpl?: OriginFetch;
  now?: () => number;
  timeoutMs?: number;
}

export type OriginAiStudioRuntimeCoordinatorResult =
  | OriginAiStudioRuntimePlanResult
  | OriginAiStudioOfflineExecutionResult;

export interface OriginAiStudioRuntimeCoordinator {
  execute(prompt: string): Promise<OriginAiStudioRuntimeCoordinatorResult>;
}

function isApiKeyConfigured(env: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(env[ORIGIN_AI_STUDIO_API_KEY_ENV]?.trim());
}

export function createOriginAiStudioRuntimeCoordinator(
  options: OriginAiStudioRuntimeCoordinatorOptions,
): OriginAiStudioRuntimeCoordinator {
  const approvalGate = options.approvalGate ?? DENY_ALL_ORIGIN_AI_STUDIO_APPROVAL_GATE;
  const catalog = options.catalog ?? DEFAULT_ORIGIN_AI_STUDIO_FREE_MODEL_CATALOG;
  const transport = createOriginAiStudioInteractionsTransport({
    env: options.env,
    fetchImpl: options.fetchImpl,
  });
  let approvalConsumed = false;

  return {
    async execute(prompt) {
      const nowMs = options.now?.() ?? Date.now();
      const availability = {
        enabled: isOriginAiStudioRuntimeEnabled(options.env),
        apiKeyConfigured: isApiKeyConfigured(options.env),
        ownerApprovedLiveExecution: false,
      };

      const preflight = buildOriginAiStudioRuntimePlan(availability, { catalog, nowMs });
      if (!("code" in preflight)) return preflight;
      if (preflight.code !== "AI_STUDIO_OWNER_APPROVAL_REQUIRED") return preflight;

      if (approvalConsumed) return preflight;

      let approved = false;
      try {
        approved = approvalGate.consumeApproval() === true;
      } catch {
        approved = false;
      }
      if (!approved) return preflight;

      approvalConsumed = true;
      const approvedPlan = buildOriginAiStudioRuntimePlan({
        ...availability,
        ownerApprovedLiveExecution: true,
      }, { catalog, nowMs });
      if (!approvedPlan.ok) return approvedPlan;

      return executeOriginAiStudioOfflineContract(
        approvedPlan.plan,
        prompt,
        transport,
        { nowMs, timeoutMs: options.timeoutMs },
      );
    },
  };
}
