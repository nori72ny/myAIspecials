import { describe, expect, it } from "vitest";
import { routeTask, type AICapabilityProfile } from "./MultiAIOrchestrator";
import {
  MAX_DELEGATION_AUDIT_RECORDS,
  appendDelegationAudit,
  clearDelegationAudit,
  createDelegationAuditRecord,
  readDelegationAudit,
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

describe("DelegationAuditStore", () => {
  it("redacts secret-bearing goals", () => {
    const request = { goal: "APIキー secret-value を確認", containsSecrets: true, requiresCodeChanges: true };
    const decision = routeTask(request, profiles);
    const record = createDelegationAuditRecord(request, decision, "2026-07-14T00:00:00.000Z");

    expect(record.goal).toBe("[REDACTED]");
    expect(JSON.stringify(record)).not.toContain("secret-value");
    expect(record.costClassification).toBe("free-only");
  });

  it("keeps only the newest 50 records", () => {
    const storage = new MemoryStorage();
    const request = { goal: "APIを実装", requiresCodeChanges: true };
    const decision = routeTask(request, profiles);

    for (let index = 0; index < 55; index += 1) {
      appendDelegationAudit(
        storage,
        createDelegationAuditRecord(request, decision, `2026-07-14T00:00:${String(index).padStart(2, "0")}.000Z`),
      );
    }

    const records = readDelegationAudit(storage);
    expect(records).toHaveLength(MAX_DELEGATION_AUDIT_RECORDS);
    expect(records[0].createdAt).toContain("54.000Z");
  });

  it("ignores invalid stored data", () => {
    const storage = new MemoryStorage();
    storage.setItem("acos.multi-ai.delegation-audit.v1", "not-json");
    expect(readDelegationAudit(storage)).toEqual([]);
  });

  it("clears local history", () => {
    const storage = new MemoryStorage();
    storage.setItem("acos.multi-ai.delegation-audit.v1", "[]");
    clearDelegationAudit(storage);
    expect(readDelegationAudit(storage)).toEqual([]);
  });
});
