import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityAuditRecord } from "./OriginAnswerQualityAuditRecord";

describe("OriginAnswerQualityAuditRecord", () => {
  it("creates a sanitized audit record without answer or prompt content", () => {
    const result = createOriginAnswerQualityAuditRecord({
      requestId: "origin-request-1",
      answerDigest: `sha256:${"a".repeat(64)}`,
      claimSetDigest: `sha256:${"b".repeat(64)}`,
      evidenceLedgerDigest: `sha256:${"c".repeat(64)}`,
      stages: [
        { stage: "claim-extraction", status: "passed" },
        { stage: "source-verification", status: "passed" },
        { stage: "verifier", status: "passed" },
      ],
      blockers: [],
      providerExecutions: 2,
      sourceFetches: 3,
      repairActions: 0,
      elapsedMs: 2_500,
      costUsd: 0,
      createdAt: "2026-09-18T12:30:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain("prompt");
    expect(JSON.stringify(result.value)).not.toContain("answerText");
    expect(JSON.stringify(result.value)).not.toContain("messages");
    expect(result.value.costUsd).toBe(0);
  });

  it("rejects non-zero cost and malformed digests", () => {
    expect(createOriginAnswerQualityAuditRecord({
      requestId: "origin-request-1",
      stages: [],
      blockers: [],
      providerExecutions: 0,
      sourceFetches: 0,
      repairActions: 0,
      elapsedMs: 0,
      costUsd: 0.01 as 0,
      createdAt: "2026-09-18T12:30:00.000Z",
    })).toEqual({ ok: false, code: "INVALID_AQ_AUDIT_RECORD" });

    expect(createOriginAnswerQualityAuditRecord({
      requestId: "origin-request-1",
      answerDigest: "bad-digest",
      stages: [],
      blockers: [],
      providerExecutions: 0,
      sourceFetches: 0,
      repairActions: 0,
      elapsedMs: 0,
      costUsd: 0,
      createdAt: "2026-09-18T12:30:00.000Z",
    })).toEqual({ ok: false, code: "INVALID_AQ_AUDIT_RECORD" });
  });

  it("rejects duplicate stage records", () => {
    expect(createOriginAnswerQualityAuditRecord({
      requestId: "origin-request-1",
      stages: [
        { stage: "verifier", status: "passed" },
        { stage: "verifier", status: "failed" },
      ],
      blockers: [],
      providerExecutions: 0,
      sourceFetches: 0,
      repairActions: 0,
      elapsedMs: 1,
      costUsd: 0,
      createdAt: "2026-09-18T12:30:00.000Z",
    })).toEqual({ ok: false, code: "INVALID_AQ_AUDIT_RECORD" });
  });
});
