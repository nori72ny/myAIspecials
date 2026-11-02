import { test, expect } from "vitest";
import { validateCompetitiveBenchmarkEvidenceV2 } from "../scripts/validate-competitive-benchmark-evidence-v2.mjs";

const sha40 = "a".repeat(40);
const sha256 = "b".repeat(64);
const systems = [
  { systemId: "origin-web", productId: "origin-personal", surface: "web-ui", modelLabel: "free-model-label", planTier: "free", accessDate: "2026-11-02", executionMode: "deterministic-local", isCandidate: true, candidateSha: sha40, status: "AVAILABLE" },
  { systemId: "chatgpt-web", productId: "chatgpt", surface: "web-ui", modelLabel: "visible-model-label", planTier: "free", accessDate: "2026-11-02", executionMode: "live-product-ui", isCandidate: false, status: "AVAILABLE" },
  { systemId: "claude-web", productId: "claude", surface: "web-ui", modelLabel: "visible-model-label", planTier: "free", accessDate: "2026-11-02", executionMode: "live-product-ui", isCandidate: false, status: "AVAILABLE" },
];
function makeEvidence() {
  const results = [];
  for (let i = 0; i < 30; i += 1) {
    const taskId = `task.family${Math.floor(i / 5)}.${String(i).padStart(3, "0")}`;
    const taskFamily = `family${Math.floor(i / 5)}`;
    for (const system of systems) {
      const local = system.executionMode === "deterministic-local";
      results.push({
        taskId, taskFamily, systemId: system.systemId, status: "EXECUTED",
        executionId: `run:${system.systemId}:${i}`,
        executedAt: "2026-11-02T10:00:00.000Z",
        inputSha256: sha256, outputSha256: sha256, durationMs: 1200,
        scores: { correctnessEvidence: 4, instructionCompleteness: 4, usabilityClarity: 4 },
        passed: true,
        evidenceRef: "evidence:run-output-0001",
        rationale: "The observed output satisfies the task success criteria with verified evidence.",
        cost: { amountUsd: 0, verification: local ? "local-only" : "free-entitlement", evidenceRef: "evidence:verified-cost-0001" },
      });
    }
  }
  return {
    schemaVersion: "origin.competitive-benchmark-evidence.v2",
    roundId: "round:2026-11-02:001",
    candidateSha: sha40,
    taskSetSha256: sha256,
    rubricSha256: sha256,
    evaluatorSha256: sha256,
    createdAt: "2026-11-02T10:00:00.000Z",
    systems,
    judging: { blind: true, randomizedOrder: true, independentJudges: 2 },
    results,
  };
}
const now = Date.parse("2026-11-02T11:00:00.000Z");

test("accepts a complete paired 30-task benchmark with three systems and zero-cost evidence", () => {
  const result = validateCompetitiveBenchmarkEvidenceV2(makeEvidence(), now);
  expect(result.valid).toBe(true);
  expect(result.taskCount).toBe(30);
  expect(result.systemCount).toBe(3);
});
test("rejects fabricated scores on NOT_RUN rows", () => {
  const bad = makeEvidence();
  bad.results[0] = { taskId: "task.family0.000", taskFamily: "family0", systemId: "origin-web", status: "NOT_RUN", notRunReason: "candidate unavailable", score: 5 };
  expect(validateCompetitiveBenchmarkEvidenceV2(bad, now).errors).toContain("NOT_RUN_MUST_NOT_HAVE_SCORE");
});
test("allows repeated task IDs across systems but rejects duplicate task/system pairs", () => {
  const bad = makeEvidence();
  bad.results.push(structuredClone(bad.results[0]));
  expect(validateCompetitiveBenchmarkEvidenceV2(bad, now).errors).toContain("DUPLICATE_TASK_SYSTEM_PAIR");
});
test("rejects local-only cost evidence for a live product UI", () => {
  const bad = makeEvidence();
  bad.results[1].cost.verification = "local-only";
  expect(validateCompetitiveBenchmarkEvidenceV2(bad, now).errors).toContain("LOCAL_ONLY_COST_EVIDENCE_MISMATCH");
});
test("requires two external products to be genuinely executed", () => {
  const bad = makeEvidence();
  bad.results = bad.results.filter(row => row.systemId === "origin-web" || row.systemId === "chatgpt-web");
  for (const row of bad.results.filter(row => row.systemId === "chatgpt-web")) {
    row.status = "NOT_RUN"; row.notRunReason = "access unavailable";
    for (const key of ["executionId", "executedAt", "inputSha256", "outputSha256", "durationMs", "scores", "passed", "cost"]) delete row[key];
  }
  expect(validateCompetitiveBenchmarkEvidenceV2(bad, now).errors).toContain("TWO_EXTERNAL_PRODUCTS_NOT_EXECUTED");
});
test("rejects a missing system/task pair", () => {
  const bad = makeEvidence();
  bad.results = bad.results.filter(row => !(row.taskId === "task.family0.000" && row.systemId === "claude-web"));
  expect(validateCompetitiveBenchmarkEvidenceV2(bad, now).errors).toContain("INCOMPLETE_PAIRED_TASK_MATRIX");
});
test("rejects unpaired or non-blind judging", () => {
  const bad = makeEvidence();
  bad.judging.independentJudges = 1;
  expect(validateCompetitiveBenchmarkEvidenceV2(bad, now).errors).toContain("INDEPENDENT_BLIND_JUDGING_REQUIRED");
});

test("rejects inconsistent task-family labels across paired systems", () => {
  const bad = makeEvidence();
  bad.results.find(row => row.taskId === "task.family0.000" && row.systemId === "claude-web").taskFamily = "family5";
  expect(validateCompetitiveBenchmarkEvidenceV2(bad, now).errors).toContain("TASK_FAMILY_INCONSISTENT");
});
