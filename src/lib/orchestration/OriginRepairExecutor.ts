import type { OriginRepairAction, OriginRepairPlan } from "./OriginRepairPlanner.js";

export interface OriginRepairExecutionContext {
  readonly maxCostUsd: 0;
  readonly allowExternalMutation: false;
  readonly allowUserImpersonation: false;
}

export interface OriginRepairExecutor {
  retrieveEvidence?(action: OriginRepairAction): Promise<boolean>;
  refreshEvidence?(action: OriginRepairAction): Promise<boolean>;
  runDeterministicCheck?(action: OriginRepairAction): Promise<boolean>;
}

export interface OriginRepairExecutionResult {
  readonly schemaVersion: "origin.repair-execution.v1";
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly blocked: number;
  readonly actions: readonly {
    readonly issueCode: OriginRepairAction["issueCode"];
    readonly claimId?: string;
    readonly action: OriginRepairAction["action"];
    readonly status: "succeeded" | "failed" | "blocked";
  }[];
}

function isAutoExecutable(action: OriginRepairAction["action"]): boolean {
  return action === "retrieve-evidence"
    || action === "refresh-evidence"
    || action === "run-deterministic-check";
}

export async function executeOriginRepairPlan(
  plan: OriginRepairPlan,
  executor: OriginRepairExecutor,
  context: OriginRepairExecutionContext,
): Promise<OriginRepairExecutionResult> {
  if (
    context.maxCostUsd !== 0
    || context.allowExternalMutation !== false
    || context.allowUserImpersonation !== false
  ) {
    throw new Error("REPAIR_EXECUTION_POLICY_INVALID");
  }

  const results: OriginRepairExecutionResult["actions"][number][] = [];
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let blocked = 0;

  for (const action of plan.actions) {
    if (action.maxAttempts !== 1 || !isAutoExecutable(action.action)) {
      blocked += 1;
      results.push(Object.freeze({
        issueCode: action.issueCode,
        ...(action.claimId ? { claimId: action.claimId } : {}),
        action: action.action,
        status: "blocked" as const,
      }));
      continue;
    }

    attempted += 1;
    let ok = false;
    try {
      if (action.action === "retrieve-evidence" && executor.retrieveEvidence) {
        ok = await executor.retrieveEvidence(action);
      } else if (action.action === "refresh-evidence" && executor.refreshEvidence) {
        ok = await executor.refreshEvidence(action);
      } else if (action.action === "run-deterministic-check" && executor.runDeterministicCheck) {
        ok = await executor.runDeterministicCheck(action);
      }
    } catch {
      ok = false;
    }

    if (ok) succeeded += 1;
    else failed += 1;

    results.push(Object.freeze({
      issueCode: action.issueCode,
      ...(action.claimId ? { claimId: action.claimId } : {}),
      action: action.action,
      status: ok ? "succeeded" as const : "failed" as const,
    }));
  }

  return Object.freeze({
    schemaVersion: "origin.repair-execution.v1",
    attempted,
    succeeded,
    failed,
    blocked,
    actions: Object.freeze(results),
  });
}
