import type { OriginRepairExecutionResult } from "./OriginRepairExecutor.js";
import type { OriginVerificationResult } from "./OriginVerifier.js";

export type OriginReverificationGateDecision =
  | "REVERIFY_REQUIRED"
  | "BLOCKED"
  | "NO_REPAIR_NEEDED";

export interface OriginReverificationGateResult {
  readonly decision: OriginReverificationGateDecision;
  readonly reason:
    | "NO_REPAIR_ACTIONS"
    | "REPAIR_ACTIONS_COMPLETED"
    | "REPAIR_ACTION_FAILED"
    | "REPAIR_ACTION_BLOCKED";
}

export function decideOriginReverificationGate(
  before: OriginVerificationResult,
  repair: OriginRepairExecutionResult,
): OriginReverificationGateResult {
  if (before.decision === "PASS") {
    return Object.freeze({
      decision: "NO_REPAIR_NEEDED",
      reason: "NO_REPAIR_ACTIONS",
    });
  }

  if (repair.blocked > 0) {
    return Object.freeze({
      decision: "BLOCKED",
      reason: "REPAIR_ACTION_BLOCKED",
    });
  }

  if (repair.failed > 0) {
    return Object.freeze({
      decision: "BLOCKED",
      reason: "REPAIR_ACTION_FAILED",
    });
  }

  return Object.freeze({
    decision: "REVERIFY_REQUIRED",
    reason: "REPAIR_ACTIONS_COMPLETED",
  });
}
