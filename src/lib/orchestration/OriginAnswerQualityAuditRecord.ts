import type { OriginAnswerQualityReadinessBlocker } from "./OriginAnswerQualityRuntimeReadiness.js";

export type OriginAnswerQualityAuditStage =
  | "claim-extraction"
  | "claim-coverage-review"
  | "source-verification"
  | "verifier"
  | "independent-review"
  | "repair"
  | "reverification"
  | "presenter"
  | "trace";

export interface OriginAnswerQualityAuditStageRecord {
  readonly stage: OriginAnswerQualityAuditStage;
  readonly status: "passed" | "failed" | "blocked" | "not-required";
}

export interface OriginAnswerQualityAuditRecord {
  readonly schemaVersion: "origin.aq-audit.v1";
  readonly requestId: string;
  readonly answerDigest?: string;
  readonly claimSetDigest?: string;
  readonly evidenceLedgerDigest?: string;
  readonly stages: readonly OriginAnswerQualityAuditStageRecord[];
  readonly blockers: readonly OriginAnswerQualityReadinessBlocker[];
  readonly providerExecutions: number;
  readonly sourceFetches: number;
  readonly repairActions: number;
  readonly elapsedMs: number;
  readonly costUsd: 0;
  readonly createdAt: string;
}

export type OriginAnswerQualityAuditResult =
  | { ok: true; value: OriginAnswerQualityAuditRecord }
  | { ok: false; code: "INVALID_AQ_AUDIT_RECORD" };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function validCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function createOriginAnswerQualityAuditRecord(
  input: Omit<OriginAnswerQualityAuditRecord, "schemaVersion">,
): OriginAnswerQualityAuditResult {
  if (
    !ID.test(input.requestId)
    || (input.answerDigest !== undefined && !DIGEST.test(input.answerDigest))
    || (input.claimSetDigest !== undefined && !DIGEST.test(input.claimSetDigest))
    || (input.evidenceLedgerDigest !== undefined && !DIGEST.test(input.evidenceLedgerDigest))
    || !validCount(input.providerExecutions)
    || !validCount(input.sourceFetches)
    || !validCount(input.repairActions)
    || !Number.isFinite(input.elapsedMs)
    || input.elapsedMs < 0
    || input.costUsd !== 0
    || !ISO_UTC.test(input.createdAt)
    || !Number.isFinite(Date.parse(input.createdAt))
  ) {
    return { ok: false, code: "INVALID_AQ_AUDIT_RECORD" };
  }

  const seen = new Set<OriginAnswerQualityAuditStage>();
  for (const stage of input.stages) {
    if (seen.has(stage.stage)) {
      return { ok: false, code: "INVALID_AQ_AUDIT_RECORD" };
    }
    seen.add(stage.stage);
  }

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "origin.aq-audit.v1",
      ...input,
      stages: Object.freeze(input.stages.map((stage) => Object.freeze({ ...stage }))),
      blockers: Object.freeze([...input.blockers]),
    }),
  };
}
