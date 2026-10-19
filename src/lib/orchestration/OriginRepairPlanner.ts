import type { OriginVerificationIssue, OriginVerificationResult } from "./OriginVerifier.js";

export type OriginRepairActionKind =
  | "retrieve-evidence"
  | "refresh-evidence"
  | "run-deterministic-check"
  | "request-user-evidence"
  | "run-independent-review";

export interface OriginRepairAction {
  readonly issueCode: OriginVerificationIssue["code"];
  readonly claimId?: string;
  readonly action: OriginRepairActionKind;
  readonly maxAttempts: 1;
}

export interface OriginRepairPlan {
  readonly schemaVersion: "origin.repair-plan.v1";
  readonly required: boolean;
  readonly blocked: boolean;
  readonly actions: readonly OriginRepairAction[];
}

function actionFor(issue: OriginVerificationIssue): OriginRepairAction {
  const action: OriginRepairActionKind =
    issue.code === "MISSING_EVIDENCE" || issue.code === "INSUFFICIENT_EVIDENCE_STATE"
      ? "retrieve-evidence"
      : issue.code === "STALE_EVIDENCE"
        ? "refresh-evidence"
        : issue.code === "EXECUTION_EVIDENCE_REQUIRED"
          ? "run-deterministic-check"
          : issue.code === "USER_EVIDENCE_REQUIRED"
            ? "request-user-evidence"
            : "run-independent-review";

  return Object.freeze({
    issueCode: issue.code,
    ...(issue.claimId ? { claimId: issue.claimId } : {}),
    action,
    maxAttempts: 1 as const,
  });
}

export function buildOriginRepairPlan(
  result: OriginVerificationResult,
): OriginRepairPlan {
  if (result.decision === "PASS") {
    return Object.freeze({
      schemaVersion: "origin.repair-plan.v1",
      required: false,
      blocked: false,
      actions: Object.freeze([]),
    });
  }

  const seen = new Set<string>();
  const actions: OriginRepairAction[] = [];
  for (const issue of result.issues) {
    const key = `${issue.code}:${issue.claimId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push(actionFor(issue));
  }

  return Object.freeze({
    schemaVersion: "origin.repair-plan.v1",
    required: result.decision === "REPAIR_REQUIRED",
    blocked: result.decision === "BLOCKED_UNVERIFIED",
    actions: Object.freeze(actions),
  });
}
