import { test, expect } from "vitest";
import { validateBenchmarkEvidence } from "../scripts/validate-competitive-benchmark-evidence.mjs";

const sha = "a".repeat(64);
const valid = {
  schemaVersion: "origin.competitive-benchmark-evidence.v1",
  candidateSha: "b".repeat(40),
  taskSetSha256: sha,
  createdAt: "2026-10-28T00:00:00.000Z",
  results: [{
    taskId: "task.ja.001", status: "EXECUTED", product: "origin-personal",
    surface: "web-ui", modelLabel: "free-model-label", planTier: "free",
    executionId: "run:origin:001", executedAt: "2026-10-28T00:00:00.000Z",
    inputSha256: sha, outputSha256: sha, durationMs: 1200, score: 4, passed: true,
    cost: { amountUsd: 0, verification: "local-only", evidenceRef: "artifact:local-run-001" }
  }]
};

test("accepts complete, explicitly zero-cost executed evidence", () => {
  expect(validateBenchmarkEvidence(valid, Date.parse("2026-10-28T01:00:00Z")).valid).toBe(true);
});

test("rejects a missing candidate SHA and a nonzero cost", () => {
  const bad = structuredClone(valid);
  bad.candidateSha = "main";
  bad.results[0].cost.amountUsd = 0.01;
  const report = validateBenchmarkEvidence(bad, Date.parse("2026-10-28T01:00:00Z"));
  expect(report.valid).toBe(false);
  expect(report.errors).toContain("CANDIDATE_SHA_INVALID");
  expect(report.errors).toContain("ZERO_COST_NOT_PROVEN");
});

test("does not allow fabricated scores for NOT_RUN products", () => {
  const bad = structuredClone(valid);
  bad.results[0] = { taskId: "task.ja.001", status: "NOT_RUN", notRunReason: "product unavailable", score: 5 };
  const report = validateBenchmarkEvidence(bad, Date.parse("2026-10-28T01:00:00Z"));
  expect(report.errors).toContain("NOT_RUN_MUST_NOT_HAVE_SCORE");
});

test("rejects duplicate task IDs", () => {
  const bad = structuredClone(valid);
  bad.results.push({ ...structuredClone(valid.results[0]) });
  const report = validateBenchmarkEvidence(bad, Date.parse("2026-10-28T01:00:00Z"));
  expect(report.errors).toContain("TASK_ID_INVALID_OR_DUPLICATE");
});
