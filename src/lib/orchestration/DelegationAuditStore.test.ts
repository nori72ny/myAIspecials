import { describe, expect, it } from "vitest";
import { routeTask, type AICapabilityProfile } from "./MultiAIOrchestrator";
import {
  MAX_DELEGATION_AUDIT_RECORDS,
  appendDelegationAudit,
  clearDelegationAudit,
  createDelegationAuditRecord,
  readDelegationAudit,
  updateDelegationAuditRecord,
  type AuditStorage,
} from "./DelegationAuditStore";

class MemoryStorage implements AuditStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const profiles: AICapabilityProfile[] = [{
  id: "ai-studio-primary",
  displayName: "AI Studio Primary",
  capabilities: ["implementation", "review"],
  available: true,
  freeOnly: true,
  preferredFor: ["implementation"],
  limitations: [],
}];

function createRecord(goal = "APIを実装", containsSecrets = false) {
  const request = {
    goal,
    taskType: "implementation" as const,
    containsSecrets,
    requiresCodeChanges: true,
  };
  return createDelegationAuditRecord(
    request,
    routeTask(request, profiles),
    "2026-07-14T00:00:00.000Z",
  );
}

describe("DelegationAuditStore", () => {
  it("creates pending lifecycle defaults", () => {
    const record = createRecord();
    expect(record.resultStatus).toBe("pending");
    expect(record.verificationStatus).toBe("pending");
    expect(record.elapsedSeconds).toBeUndefined();
  });

  it("updates result, verification, and elapsed time", () => {
    const storage = new MemoryStorage();
    const record = createRecord();
    appendDelegationAudit(storage, record);

    const records = updateDelegationAuditRecord(storage, record.id, {
      resultStatus: "success",
      verificationStatus: "passed",
      elapsedSeconds: 42,
      completedAt: "2026-07-14T00:01:00.000Z",
    });

    expect(records[0].resultStatus).toBe("success");
    expect(records[0].verificationStatus).toBe("passed");
    expect(records[0].elapsedSeconds).toBe(42);
    expect(records[0].completedAt).toBe("2026-07-14T00:01:00.000Z");
  });

  it("rejects invalid elapsed time without changing storage", () => {
    const storage = new MemoryStorage();
    const record = createRecord();
    appendDelegationAudit(storage, record);

    const records = updateDelegationAuditRecord(storage, record.id, {
      resultStatus: "failed",
      verificationStatus: "failed",
      elapsedSeconds: -1,
    });

    expect(records[0].resultStatus).toBe("pending");
    expect(readDelegationAudit(storage)[0].elapsedSeconds).toBeUndefined();
  });

  it("leaves history unchanged when the record ID is missing", () => {
    const storage = new MemoryStorage();
    const record = createRecord();
    appendDelegationAudit(storage, record);
    const records = updateDelegationAuditRecord(storage, "missing", {
      resultStatus: "success",
      verificationStatus: "passed",
      elapsedSeconds: 5,
    });
    expect(records).toEqual([record]);
  });

  it("preserves redaction after lifecycle updates", () => {
    const storage = new MemoryStorage();
    const record = createRecord("APIキー secret-value を確認", true);
    appendDelegationAudit(storage, record);
    const records = updateDelegationAuditRecord(storage, record.id, {
      resultStatus: "changes-required",
      verificationStatus: "failed",
      elapsedSeconds: 12,
    });
    expect(records[0].goal).toBe("[REDACTED]");
    expect(JSON.stringify(records[0])).not.toContain("secret-value");
  });

  it("keeps only the newest 50 records", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 55; index += 1) {
      const record = { ...createRecord(), id: `record-${index}`, createdAt: `2026-07-14T00:00:${String(index).padStart(2, "0")}.000Z` };
      appendDelegationAudit(storage, record);
    }
    const records = readDelegationAudit(storage);
    expect(records).toHaveLength(MAX_DELEGATION_AUDIT_RECORDS);
    expect(records[0].id).toBe("record-54");
  });

  it("ignores invalid stored data and migrates older valid records", () => {
    const storage = new MemoryStorage();
    storage.setItem("acos.multi-ai.delegation-audit.v1", "not-json");
    expect(readDelegationAudit(storage)).toEqual([]);

    const legacy = JSON.parse(JSON.stringify(createRecord())) as Record<string, unknown>;
    delete legacy.resultStatus;
    delete legacy.verificationStatus;
    storage.setItem("acos.multi-ai.delegation-audit.v1", JSON.stringify([legacy]));
    expect(readDelegationAudit(storage)[0].resultStatus).toBe("pending");
  });

  it("clears local history", () => {
    const storage = new MemoryStorage();
    appendDelegationAudit(storage, createRecord());
    clearDelegationAudit(storage);
    expect(readDelegationAudit(storage)).toEqual([]);
  });
});
