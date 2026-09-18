import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";

import { PostgresOriginExecutionTraceStoreV1 } from "../src/agent/originExecutionTraceStoreV1.js";

const rawUrl = process.env.ORIGIN_CODING_TEST_POSTGRES_URL;
assert.ok(rawUrl, "A disposable ORIGIN_CODING_TEST_POSTGRES_URL is required");
const testUrl = new URL(rawUrl);
assert.ok(["postgres:", "postgresql:"].includes(testUrl.protocol));
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(testUrl.hostname), "Only a loopback test service is allowed");
assert.equal(testUrl.pathname, "/origin_coding_test");
assert.equal(testUrl.search, "");

const databaseName = `origin_trace_test_${randomBytes(8).toString("hex")}`;
const admin = new Pool({ connectionString: rawUrl, max: 1, connectionTimeoutMillis: 3000 });
testUrl.pathname = `/${databaseName}`;
const db = new Pool({
  connectionString: testUrl.toString(),
  max: 2,
  connectionTimeoutMillis: 3000,
  statement_timeout: 8000,
});
const store = new PostgresOriginExecutionTraceStoreV1(db);
let createdDatabase = false;

before(async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    const exists = await admin.query("select 1 from pg_roles where rolname = $1", [role]);
    if (!exists.rowCount) await admin.query(`create role ${role} nologin`);
  }
  await admin.query(`create database ${databaseName}`);
  createdDatabase = true;
  const migration = await readFile(new URL("../supabase/migrations/20260918_origin_execution_traces_v1.sql", import.meta.url), "utf8");
  await db.query(migration);
  await db.query(migration);
});

after(async () => {
  await db.end();
  try {
    if (createdDatabase) await admin.query(`drop database ${databaseName}`);
  } finally {
    await admin.end();
  }
});

describe("sanitized execution trace Postgres boundary", () => {
  it("enables RLS and denies browser roles", async () => {
    const row = (await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'public.origin_execution_traces_v1'::regclass",
    )).rows[0];
    assert.equal(row.relrowsecurity, true);

    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const access = (await db.query<{ allowed: boolean }>(
          "select has_table_privilege($1, $2, $3) as allowed",
          [role, "public.origin_execution_traces_v1", privilege],
        )).rows[0];
        assert.equal(access.allowed, false);
      }
    }
  });

  it("persists only bounded zero-cost metadata and is append-only by trace id", async () => {
    const now = Date.now();
    const record = {
      traceId: "origin-1789718400000-123e4567-e89b-12d3-a456-426614174000",
      route: "/api/chat",
      taskType: "review",
      verificationStatus: "not-run" as const,
      reviewRequired: true,
      independentReviewPerformed: false,
      providerId: "openrouter-free",
      modelId: "example/model:free",
      freeOnly: true as const,
      actualCostUsd: 0 as const,
      outcome: "success" as const,
      includedMessageCount: 2,
      includedCharacterCount: 120,
      omittedMessageCount: 1,
      omittedCharacterCount: 400,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    };

    assert.equal(await store.append(record), true);
    assert.equal(await store.append(record), false);

    const persisted = (await db.query(
      "select trace_id, free_only, actual_cost_usd::text as cost, included_message_count from public.origin_execution_traces_v1 where trace_id = $1",
      [record.traceId],
    )).rows[0];
    assert.equal(persisted.trace_id, record.traceId);
    assert.equal(persisted.free_only, true);
    assert.equal(persisted.cost, "0.000000");
    assert.equal(persisted.included_message_count, 2);
  });
});
