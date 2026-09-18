import { describe, expect, it } from "vitest";

import { buildOriginRepairPlan } from "./OriginRepairPlanner";
import type { OriginVerificationResult } from "./OriginVerifier";

function result(
  decision: OriginVerificationResult["decision"],
  issues: OriginVerificationResult["issues"] = [],
): OriginVerificationResult {
  return {
    schemaVersion: "origin.verification.v1",
    decision,
    issues,
    verifiedClaimIds: [],
  };
}

describe("OriginRepairPlanner", () => {
  it("returns no repair actions for PASS", () => {
    expect(buildOriginRepairPlan(result("PASS"))).toEqual({
      schemaVersion: "origin.repair-plan.v1",
      required: false,
      blocked: false,
      actions: [],
    });
  });

  it("maps verifier issues to bounded repair actions", () => {
    const plan = buildOriginRepairPlan(result("REPAIR_REQUIRED", [
      { claimId: "c1", code: "MISSING_EVIDENCE", repairable: true },
      { claimId: "c2", code: "STALE_EVIDENCE", repairable: true },
      { claimId: "c3", code: "EXECUTION_EVIDENCE_REQUIRED", repairable: true },
      { claimId: "c4", code: "USER_EVIDENCE_REQUIRED", repairable: true },
    ]));

    expect(plan.required).toBe(true);
    expect(plan.blocked).toBe(false);
    expect(plan.actions).toEqual([
      { issueCode: "MISSING_EVIDENCE", claimId: "c1", action: "retrieve-evidence", maxAttempts: 1 },
      { issueCode: "STALE_EVIDENCE", claimId: "c2", action: "refresh-evidence", maxAttempts: 1 },
      { issueCode: "EXECUTION_EVIDENCE_REQUIRED", claimId: "c3", action: "run-deterministic-check", maxAttempts: 1 },
      { issueCode: "USER_EVIDENCE_REQUIRED", claimId: "c4", action: "request-user-evidence", maxAttempts: 1 },
    ]);
  });

  it("keeps blocking review requirements blocked rather than pretending repair succeeded", () => {
    const plan = buildOriginRepairPlan(result("BLOCKED_UNVERIFIED", [
      { code: "INDEPENDENT_REVIEW_REQUIRED", repairable: false },
    ]));

    expect(plan.required).toBe(false);
    expect(plan.blocked).toBe(true);
    expect(plan.actions).toEqual([
      { issueCode: "INDEPENDENT_REVIEW_REQUIRED", action: "run-independent-review", maxAttempts: 1 },
    ]);
  });

  it("deduplicates repeated issue actions for the same claim", () => {
    const plan = buildOriginRepairPlan(result("REPAIR_REQUIRED", [
      { claimId: "c1", code: "MISSING_EVIDENCE", repairable: true },
      { claimId: "c1", code: "MISSING_EVIDENCE", repairable: true },
    ]));
    expect(plan.actions).toHaveLength(1);
  });
});
