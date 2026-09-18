import { describe, expect, it, vi } from "vitest";

import {
  PostgresOriginExecutionTraceStoreV1,
  validateOriginExecutionTraceRecordV1,
  type OriginExecutionTraceRecordV1,
} from "./originExecutionTraceStoreV1";

const now = Date.parse("2026-09-18T08:00:00.000Z");
const record: OriginExecutionTraceRecordV1 = {
  traceId: "origin-1789718400000-123e4567-e89b-12d3-a456-426614174000",
  route: "/api/chat",
  taskType: "review",
  verificationStatus: "not-run",
  reviewRequired: true,
  independentReviewPerformed: false,
  providerId: "openrouter-free",
  modelId: "example/model:free",
  freeOnly: true,
  actualCostUsd: 0,
  outcome: "success",
  includedMessageCount: 2,
  includedCharacterCount: 120,
  omittedMessageCount: 4,
  omittedCharacterCount: 900,
  createdAt: now,
  expiresAt: now + 7 * 24 * 60 * 60 * 1000,
};

describe("OriginExecutionTraceStoreV1", () => {
  it("accepts only sanitized zero-cost metadata without prompt or answer fields", () => {
    expect(validateOriginExecutionTraceRecordV1(record)).toBe(true);
    expect(record).not.toHaveProperty("prompt");
    expect(record).not.toHaveProperty("messages");
    expect(record).not.toHaveProperty("answer");
    expect(record).not.toHaveProperty("sourceContent");
  });

  it("rejects paid, inconsistent review, secret-bearing, and invalid retention records", () => {
    expect(validateOriginExecutionTraceRecordV1({ ...record, actualCostUsd: 1 } as unknown as OriginExecutionTraceRecordV1)).toBe(false);
    expect(validateOriginExecutionTraceRecordV1({
      ...record,
      verificationStatus: "passed",
      independentReviewPerformed: false,
    })).toBe(false);
    expect(validateOriginExecutionTraceRecordV1({
      ...record,
      providerId: "api_key=synthetic_secret_123456",
    })).toBe(false);
    expect(validateOriginExecutionTraceRecordV1({
      ...record,
      expiresAt: now + 32 * 24 * 60 * 60 * 1000,
    })).toBe(false);
  });

  it("appends once and never updates an existing trace", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ trace_id: record.traceId }] });
    const store = new PostgresOriginExecutionTraceStoreV1({ query } as any);

    await expect(store.append(record)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("insert into public.origin_execution_traces_v1");
    expect(sql).toContain("on conflict (trace_id) do nothing");
    expect(sql.toLowerCase()).not.toContain("update ");
    expect(query.mock.calls[0][1]).not.toContain(expect.stringContaining("prompt"));
  });

  it("bounds retention cleanup", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 3, rows: [] });
    const store = new PostgresOriginExecutionTraceStoreV1({ query } as any);
    await expect(store.deleteExpired(100)).resolves.toBe(3);
    await expect(store.deleteExpired(0)).rejects.toThrow("ORIGIN_TRACE_CLEANUP_LIMIT_INVALID");
    await expect(store.deleteExpired(1001)).rejects.toThrow("ORIGIN_TRACE_CLEANUP_LIMIT_INVALID");
  });
});
