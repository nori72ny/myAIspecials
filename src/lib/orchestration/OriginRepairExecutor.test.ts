import { describe, expect, it, vi } from "vitest";

import { executeOriginRepairPlan } from "./OriginRepairExecutor";
import type { OriginRepairPlan } from "./OriginRepairPlanner";

const context = {
  maxCostUsd: 0 as const,
  allowExternalMutation: false as const,
  allowUserImpersonation: false as const,
};

describe("OriginRepairExecutor", () => {
  it("executes only safe one-attempt repair actions", async () => {
    const plan: OriginRepairPlan = {
      schemaVersion: "origin.repair-plan.v1",
      required: true,
      blocked: false,
      actions: [
        { issueCode: "MISSING_EVIDENCE", claimId: "c1", action: "retrieve-evidence", maxAttempts: 1 },
        { issueCode: "STALE_EVIDENCE", claimId: "c2", action: "refresh-evidence", maxAttempts: 1 },
        { issueCode: "EXECUTION_EVIDENCE_REQUIRED", claimId: "c3", action: "run-deterministic-check", maxAttempts: 1 },
      ],
    };

    const result = await executeOriginRepairPlan(plan, {
      retrieveEvidence: vi.fn().mockResolvedValue(true),
      refreshEvidence: vi.fn().mockResolvedValue(false),
      runDeterministicCheck: vi.fn().mockResolvedValue(true),
    }, context);

    expect(result).toMatchObject({
      attempted: 3,
      succeeded: 2,
      failed: 1,
      blocked: 0,
    });
  });

  it("blocks user-evidence and independent-review actions from auto execution", async () => {
    const plan: OriginRepairPlan = {
      schemaVersion: "origin.repair-plan.v1",
      required: false,
      blocked: true,
      actions: [
        { issueCode: "USER_EVIDENCE_REQUIRED", claimId: "c1", action: "request-user-evidence", maxAttempts: 1 },
        { issueCode: "INDEPENDENT_REVIEW_REQUIRED", action: "run-independent-review", maxAttempts: 1 },
      ],
    };

    const result = await executeOriginRepairPlan(plan, {}, context);

    expect(result).toMatchObject({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      blocked: 2,
    });
    expect(result.actions.every((item) => item.status === "blocked")).toBe(true);
  });

  it("does not retry failed repair actions", async () => {
    const retrieveEvidence = vi.fn().mockRejectedValue(new Error("failed"));
    const plan: OriginRepairPlan = {
      schemaVersion: "origin.repair-plan.v1",
      required: true,
      blocked: false,
      actions: [
        { issueCode: "MISSING_EVIDENCE", claimId: "c1", action: "retrieve-evidence", maxAttempts: 1 },
      ],
    };

    const result = await executeOriginRepairPlan(plan, { retrieveEvidence }, context);

    expect(retrieveEvidence).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1, blocked: 0 });
  });

  it("rejects any non-zero-cost or mutation-capable execution context", async () => {
    const plan: OriginRepairPlan = {
      schemaVersion: "origin.repair-plan.v1",
      required: false,
      blocked: false,
      actions: [],
    };

    await expect(executeOriginRepairPlan(plan, {}, {
      maxCostUsd: 0,
      allowExternalMutation: true as false,
      allowUserImpersonation: false,
    })).rejects.toThrow("REPAIR_EXECUTION_POLICY_INVALID");
  });
});
