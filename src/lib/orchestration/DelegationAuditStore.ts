import type { AIRoutingDecision, AITaskRequest } from "./MultiAIOrchestrator";

export const DELEGATION_AUDIT_STORAGE_KEY = "acos.multi-ai.delegation-audit.v1";
export const MAX_DELEGATION_AUDIT_RECORDS = 50;

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
}

export interface AuditStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isAuditRecord(value: unknown): value is DelegationAuditRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DelegationAuditRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.goal === "string" &&
    typeof record.taskType === "string" &&
    typeof record.selectedProvider === "string" &&
    typeof record.selectedProviderName === "string" &&
    typeof record.reason === "string" &&
    typeof record.requiresHumanApproval === "boolean" &&
    record.costClassification === "free-only"
  );
}

export function readDelegationAudit(storage: AuditStorage): DelegationAuditRecord[] {
  try {
    const raw = storage.getItem(DELEGATION_AUDIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAuditRecord).slice(0, MAX_DELEGATION_AUDIT_RECORDS);
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

export function clearDelegationAudit(storage: AuditStorage): void {
  storage.removeItem(DELEGATION_AUDIT_STORAGE_KEY);
}
