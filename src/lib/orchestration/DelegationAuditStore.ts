import type { AIRoutingDecision, AITaskRequest } from "./MultiAIOrchestrator";

export const DELEGATION_AUDIT_STORAGE_KEY = "acos.multi-ai.delegation-audit.v1";
export const MAX_DELEGATION_AUDIT_RECORDS = 50;

export type DelegationResultStatus = "pending" | "success" | "changes-required" | "failed";
export type DelegationVerificationStatus = "not-required" | "pending" | "passed" | "failed";
export type AuditStorageFailureReason =
  | "unavailable"
  | "read-failed"
  | "write-failed"
  | "remove-failed"
  | "quota-exceeded";

export type AuditStorageResult<T> =
  | { ok: true; value: T; reason?: never }
  | { ok: false; value: T; reason: AuditStorageFailureReason };

export interface DelegationAuditRecord {
  id: string;
  createdAt: string;
  goal: string;
  taskType: AIRoutingDecision["taskType"];
  selectedProvider: string;
  selectedProviderName: string;
  reason: string;
  verificationProvider?: string;
  requiresHumanApproval: boolean;
  costClassification: "free-only";
  resultStatus: DelegationResultStatus;
  verificationStatus: DelegationVerificationStatus;
  elapsedSeconds?: number;
  completedAt?: string;
}

export interface DelegationAuditUpdate {
  resultStatus: DelegationResultStatus;
  verificationStatus: DelegationVerificationStatus;
  elapsedSeconds: number;
  completedAt?: string;
}

export interface AuditStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RESULT_STATUSES: readonly DelegationResultStatus[] = ["pending", "success", "changes-required", "failed"];
const VERIFICATION_STATUSES: readonly DelegationVerificationStatus[] = ["not-required", "pending", "passed", "failed"];

function normalizeAuditRecord(value: unknown): DelegationAuditRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<DelegationAuditRecord>;
  if (
    typeof record.id !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.goal !== "string" ||
    typeof record.taskType !== "string" ||
    typeof record.selectedProvider !== "string" ||
    typeof record.selectedProviderName !== "string" ||
    typeof record.reason !== "string" ||
    typeof record.requiresHumanApproval !== "boolean" ||
    record.costClassification !== "free-only"
  ) return null;

  const resultStatus = RESULT_STATUSES.includes(record.resultStatus as DelegationResultStatus)
    ? record.resultStatus as DelegationResultStatus
    : "pending";
  const verificationStatus = VERIFICATION_STATUSES.includes(record.verificationStatus as DelegationVerificationStatus)
    ? record.verificationStatus as DelegationVerificationStatus
    : record.verificationProvider ? "pending" : "not-required";
  const elapsedSeconds = Number.isInteger(record.elapsedSeconds) && (record.elapsedSeconds ?? -1) >= 0
    ? record.elapsedSeconds
    : undefined;

  return {
    id: record.id,
    createdAt: record.createdAt,
    goal: record.goal,
    taskType: record.taskType,
    selectedProvider: record.selectedProvider,
    selectedProviderName: record.selectedProviderName,
    reason: record.reason,
    verificationProvider: typeof record.verificationProvider === "string" ? record.verificationProvider : undefined,
    requiresHumanApproval: record.requiresHumanApproval,
    costClassification: "free-only",
    resultStatus,
    verificationStatus,
    elapsedSeconds,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
  };
}

function writeFailureReason(error: unknown): AuditStorageFailureReason {
  return error instanceof DOMException && error.name === "QuotaExceededError"
    ? "quota-exceeded"
    : "write-failed";
}

export function readDelegationAudit(storage: AuditStorage): AuditStorageResult<DelegationAuditRecord[]> {
  try {
    const raw = storage.getItem(DELEGATION_AUDIT_STORAGE_KEY);
    if (!raw) return { ok: true, value: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: true, value: [] };
    return {
      ok: true,
      value: parsed
        .map(normalizeAuditRecord)
        .filter((record): record is DelegationAuditRecord => record !== null)
        .slice(0, MAX_DELEGATION_AUDIT_RECORDS),
    };
  } catch {
    return { ok: false, value: [], reason: "read-failed" };
  }
}

export function createDelegationAuditRecord(
  request: AITaskRequest,
  decision: AIRoutingDecision,
  createdAt = new Date().toISOString(),
): DelegationAuditRecord {
  return {
    id: `${createdAt}:${decision.selectedProvider}:${decision.taskType}`,
    createdAt,
    goal: request.containsSecrets ? "[REDACTED]" : request.goal.trim(),
    taskType: decision.taskType,
    selectedProvider: decision.selectedProvider,
    selectedProviderName: decision.selectedProviderName,
    reason: decision.reason,
    verificationProvider: decision.verificationProvider,
    requiresHumanApproval: decision.requiresHumanApproval,
    costClassification: "free-only",
    resultStatus: "pending",
    verificationStatus: decision.verificationProvider ? "pending" : "not-required",
  };
}

export function appendDelegationAudit(
  storage: AuditStorage,
  record: DelegationAuditRecord,
): AuditStorageResult<DelegationAuditRecord[]> {
  const current = readDelegationAudit(storage);
  if (!current.ok) return { ...current, value: [record] };
  const next = [record, ...current.value].slice(0, MAX_DELEGATION_AUDIT_RECORDS);
  try {
    storage.setItem(DELEGATION_AUDIT_STORAGE_KEY, JSON.stringify(next));
    return { ok: true, value: next };
  } catch (error) {
    return { ok: false, value: next, reason: writeFailureReason(error) };
  }
}

export function updateDelegationAuditRecord(
  storage: AuditStorage,
  id: string,
  update: DelegationAuditUpdate,
): AuditStorageResult<DelegationAuditRecord[]> {
  const current = readDelegationAudit(storage);
  if (!current.ok) return current;
  if (!Number.isInteger(update.elapsedSeconds) || update.elapsedSeconds < 0) return current;
  const index = current.value.findIndex((record) => record.id === id);
  const existing = current.value[index];
  if (index < 0 || !existing) return current;

  const next = [...current.value];
  next[index] = {
    ...existing,
    resultStatus: update.resultStatus,
    verificationStatus: update.verificationStatus,
    elapsedSeconds: update.elapsedSeconds,
    completedAt: update.completedAt ?? new Date().toISOString(),
  };
  try {
    storage.setItem(DELEGATION_AUDIT_STORAGE_KEY, JSON.stringify(next));
    return { ok: true, value: next };
  } catch (error) {
    return { ok: false, value: next, reason: writeFailureReason(error) };
  }
}

export function clearDelegationAudit(storage: AuditStorage): AuditStorageResult<DelegationAuditRecord[]> {
  try {
    storage.removeItem(DELEGATION_AUDIT_STORAGE_KEY);
    return { ok: true, value: [] };
  } catch {
    return { ok: false, value: [], reason: "remove-failed" };
  }
}
