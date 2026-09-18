import { describe, expect, it } from "vitest";

import { decideOriginReverificationGate } from "./OriginReverificationGate";
import type { OriginRepairExecutionResult } from "./OriginRepairExecutor";
import type { OriginVerificationResult } from "./OriginVerifier";

const repair = (overrides: Partial<OriginRepairExecutionResult> = {}): OriginRepairExecutionResult => ({
  schemaVersion: "origin.repair-execution.v1",
  attempted: 1,
  succeeded: 1,
  failed: 0,
  blocked: 0,
  actions: [{
    issueCode: "MISSING_EVIDENCE",
    claimId: "c1",
    action: "retrieve-evidence",
    status: "succeeded",
  }],
  ...overrides,
});

const verification = (
  decision: OriginVerificationResult["decision"],
): OriginVerificationResult => ({
  schemaVersion: "origin.verification.v1",
  decision,
  issues: decision === "PASS" ? [] : [{ claimId: "c1", code: "MISSING_EVIDENCE", repairable: true }],
  verifiedClaimIds: [],
});

describe("OriginReverificationGate", () => {
  it("requires a fresh verifier pass after successful repair", () => {
    expect(decideOriginReverificationGate(
      verification("REPAIR_REQUIRED"),
      repair(),
    )).toEqual({
      decision: "REVERIFY_REQUIRED",
      reason: "REPAIR_ACTIONS_COMPLETED",
    });
  });

  it("blocks when any repair action fails", () => {
    expect(decideOriginReverificationGate(
      verification("REPAIR_REQUIRED"),
      repair({ succeeded: 0, failed: 1, actions: [{
        issueCode: "MISSING_EVIDENCE",
        claimId: "c1",
        action: "retrieve-evidence",
        status: "failed",
      }] }),
    )).toEqual({
      decision: "BLOCKED",
      reason: "REPAIR_ACTION_FAILED",
    });
  });

  it("blocks when a repair action requires human or independent review", () => {
    expect(decideOriginReverificationGate(
      verification("BLOCKED_UNVERIFIED"),
      repair({
        attempted: 0,
        succeeded: 0,
        blocked: 1,
        actions: [{
          issueCode: "INDEPENDENT_REVIEW_REQUIRED",
          action: "run-independent-review",
          status: "blocked",
        }],
      }),
    )).toEqual({
      decision: "BLOCKED",
      reason: "REPAIR_ACTION_BLOCKED",
    });
  });

  it("never creates work for an already-passed answer", () => {
    expect(decideOriginReverificationGate(
      verification("PASS"),
      repair({ attempted: 0, succeeded: 0, actions: [] }),
    )).toEqual({
      decision: "NO_REPAIR_NEEDED",
      reason: "NO_REPAIR_ACTIONS",
    });
  });
});
