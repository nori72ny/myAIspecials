import { containsSensitiveInput } from "./SensitiveInputDetector.js";

export type OriginExecutionTraceOutcome =
  | "local-only"
  | "sensitive-input-blocked"
  | "context-rejected"
  | "policy-rejected"
  | "provider-failed"
  | "accepted";

export type OriginExecutionTraceVerificationStatus =
  | "not-required"
  | "not-run"
  | "pending"
  | "passed"
  | "failed";

export interface OriginExecutionTraceRecord {
  schemaVersion: "origin-execution-trace-v1";
  traceId: string;
  startedAt: string;
  completedAt: string;
  outcome: OriginExecutionTraceOutcome;
  transmission: "not-attempted" | "attempted";
  policy: {
    freeOnly: true;
    maxEstimatedCostUsd: 0;
    timeoutMs: number;
    modelEvidenceStatus: "current" | "stale" | "invalid" | "not-applicable";
  };
  execution?: {
    providerId: string;
    modelId: string;
    fallbackUsed: false;
    estimatedCostUsd: number;
    actualCostUsd: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  verification: {
    status: OriginExecutionTraceVerificationStatus;
    reviewerCount: number;
  };
  context?: {
    policyVersion: string;
    includedMessageCount: number;
    includedCharacterCount: number;
    omittedMessageCount: number;
    omittedCharacterCount: number;
  };
  errorCode?: string;
}

export type OriginExecutionTraceValidationResult =
  | { ok: true; value: Readonly<OriginExecutionTraceRecord> }
  | { ok: false; code: "INVALID_EXECUTION_TRACE"; message: string };

const TRACE_ID = /^origin-[A-Za-z0-9._:-]{1,180}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,180}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,120}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_TIMEOUT_MS = 120_000;
const MAX_COUNT = 100_000;
const ALLOWED_KEYS = new Set([
  "schemaVersion","traceId","startedAt","completedAt","outcome","transmission",
  "policy","execution","verification","context","errorCode",
]);

function safeIso(value: unknown): value is string {
  return typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value));
}
function safeCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_COUNT;
}
function noSensitiveString(value: unknown): boolean {
  return typeof value !== "string" || !containsSensitiveInput(value);
}
function validExecution(record: OriginExecutionTraceRecord): boolean {
  if (!record.execution) return record.transmission === "not-attempted";
  const execution = record.execution;
  return record.transmission === "attempted"
    && SAFE_ID.test(execution.providerId)
    && SAFE_ID.test(execution.modelId)
    && noSensitiveString(execution.providerId)
    && noSensitiveString(execution.modelId)
    && execution.fallbackUsed === false
    && Number.isFinite(execution.estimatedCostUsd)
    && Number.isFinite(execution.actualCostUsd)
    && execution.estimatedCostUsd === 0
    && execution.actualCostUsd === 0
    && (execution.inputTokens === undefined || safeCount(execution.inputTokens))
    && (execution.outputTokens === undefined || safeCount(execution.outputTokens));
}

export function validateOriginExecutionTrace(input: unknown): OriginExecutionTraceValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok:false, code:"INVALID_EXECUTION_TRACE", message:"Execution trace is invalid." };
  }
  const raw=input as Record<string, unknown>;
  if (Object.keys(raw).some((key)=>!ALLOWED_KEYS.has(key))) {
    return { ok:false, code:"INVALID_EXECUTION_TRACE", message:"Execution trace is invalid." };
  }
  const record=input as OriginExecutionTraceRecord;
  const start=Date.parse(record.startedAt);
  const end=Date.parse(record.completedAt);
  const valid =
    record.schemaVersion === "origin-execution-trace-v1"
    && typeof record.traceId === "string"
    && TRACE_ID.test(record.traceId)
    && noSensitiveString(record.traceId)
    && safeIso(record.startedAt)
    && safeIso(record.completedAt)
    && end >= start
    && ["local-only","sensitive-input-blocked","context-rejected","policy-rejected","provider-failed","accepted"].includes(record.outcome)
    && ["not-attempted","attempted"].includes(record.transmission)
    && record.policy?.freeOnly === true
    && record.policy.maxEstimatedCostUsd === 0
    && Number.isInteger(record.policy.timeoutMs)
    && record.policy.timeoutMs >= 1
    && record.policy.timeoutMs <= MAX_TIMEOUT_MS
    && ["current","stale","invalid","not-applicable"].includes(record.policy.modelEvidenceStatus)
    && validExecution(record)
    && record.verification
    && ["not-required","not-run","pending","passed","failed"].includes(record.verification.status)
    && Number.isInteger(record.verification.reviewerCount)
    && record.verification.reviewerCount >= 0
    && record.verification.reviewerCount <= 8
    && (record.verification.status !== "passed" || record.verification.reviewerCount > 0)
    && (record.verification.status === "not-required" || record.verification.reviewerCount >= 0)
    && (record.errorCode === undefined || (ERROR_CODE.test(record.errorCode) && noSensitiveString(record.errorCode)))
    && (!record.context || (
      SAFE_ID.test(record.context.policyVersion)
      && noSensitiveString(record.context.policyVersion)
      && safeCount(record.context.includedMessageCount)
      && safeCount(record.context.includedCharacterCount)
      && safeCount(record.context.omittedMessageCount)
      && safeCount(record.context.omittedCharacterCount)
    ));

  if (!valid) return { ok:false, code:"INVALID_EXECUTION_TRACE", message:"Execution trace is invalid." };

  const frozen = Object.freeze({
    ...record,
    policy: Object.freeze({ ...record.policy }),
    ...(record.execution ? { execution:Object.freeze({ ...record.execution }) } : {}),
    verification:Object.freeze({ ...record.verification }),
    ...(record.context ? { context:Object.freeze({ ...record.context }) } : {}),
  });
  return { ok:true, value:frozen };
}
