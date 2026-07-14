import type { AIRoutingDecision, AITaskRequest } from "./MultiAIOrchestrator";

export const DELEGATION_AUDIT_STORAGE_KEY = "acos.multi-ai.delegation-audit.v1";
export const MAX_DELEGATION_AUDIT_RECORDS = 50;

export type DelegationResultStatus = "pending" | "success" | "changes-required" | "failed";
export type DelegationVerificationStatus = "not-required" | "pending" | "passed" | "failed";

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

export function readDelegationAudit(storage: AuditStorage): DelegationAuditRecord[] {
  try {
    const raw = storage.getItem(DELEGATION_AUDIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeAuditRecord)
      .filter((record): record is DelegationAuditRecord => record !== null)
      .slice(0, MAX_DELEGATION_AUDIT_RECORDS);
  } catch {
    return [];
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
): DelegationAuditRecord[] {
  const next = [record, ...readDelegationAudit(storage)].slice(0, MAX_DELEGATION_AUDIT_RECORDS);
  storage.setItem(DELEGATION_AUDIT_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function updateDelegationAuditRecord(
  storage: AuditStorage,
  id: string,
  update: DelegationAuditUpdate,
): DelegationAuditRecord[] {
  const current = readDelegationAudit(storage);
  if (!Number.isInteger(update.elapsedSeconds) || update.elapsedSeconds < 0) return current;
  const index = current.findIndex((record) => record.id === id);
  if (index < 0) return current;

  const next = [...current];
  next[index] = {
    ...next[index],
    resultStatus: update.resultStatus,
    verificationStatus: update.verificationStatus,
    elapsedSeconds: update.elapsedSeconds,
    completedAt: update.completedAt ?? new Date().toISOString(),
  };
  storage.setItem(DELEGATION_AUDIT_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearDelegationAudit(storage: AuditStorage): void {
  storage.removeItem(DELEGATION_AUDIT_STORAGE_KEY);
}
