#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
const DIMENSIONS = new Set([
  "correctnessEvidence",
  "instructionCompleteness",
  "artifactCodeQuality",
  "robustnessRecovery",
  "usabilityClarity",
  "efficiency",
]);
const ISO = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

export function validateCompetitiveBenchmarkEvidenceV2(input, nowMs = Date.now()) {
  const errors = [];
  const add = (code) => errors.push(code);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["EVIDENCE_OBJECT_REQUIRED"] };
  }
  if (input.schemaVersion !== "origin.competitive-benchmark-evidence.v2") add("SCHEMA_VERSION_INVALID");
  if (typeof input.roundId !== "string" || !SAFE.test(input.roundId)) add("ROUND_ID_INVALID");
  if (typeof input.candidateSha !== "string" || !SHA40.test(input.candidateSha)) add("CANDIDATE_SHA_INVALID");
  for (const field of ["taskSetSha256", "rubricSha256", "evaluatorSha256"]) {
    if (!SHA256.test(input[field] ?? "")) add(field.toUpperCase() + "_INVALID");
  }
  if (!ISO(input.createdAt) || Date.parse(input.createdAt) > nowMs + 5 * 60_000) add("CREATED_AT_INVALID");

  const systems = Array.isArray(input.systems) ? input.systems : [];
  if (systems.length < 3) add("THREE_SYSTEM_PROFILES_REQUIRED");
  const systemIds = new Set();
  const productIds = new Set();
  let candidateCount = 0;
  const validSystemIds = new Set();
  for (const system of systems) {
    if (!system || typeof system !== "object" || Array.isArray(system)) { add("SYSTEM_PROFILE_INVALID"); continue; }
    if (typeof system.systemId !== "string" || !SAFE.test(system.systemId) || systemIds.has(system.systemId)) add("SYSTEM_ID_INVALID_OR_DUPLICATE");
    else { systemIds.add(system.systemId); validSystemIds.add(system.systemId); }
    if (typeof system.productId !== "string" || !SAFE.test(system.productId)) add("PRODUCT_ID_INVALID");
    else productIds.add(system.productId);
    if (typeof system.surface !== "string" || system.surface.trim().length < 2) add("PRODUCT_SURFACE_REQUIRED");
    if (typeof system.modelLabel !== "string" || system.modelLabel.trim().length < 2) add("MODEL_LABEL_REQUIRED");
    if (typeof system.planTier !== "string" || system.planTier.trim().length < 2) add("PLAN_TIER_REQUIRED");
    if (typeof system.accessDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(system.accessDate)) add("ACCESS_DATE_REQUIRED");
    if (!["live-product-ui", "live-api"].includes(system.executionMode)) add("LIVE_EXECUTION_MODE_REQUIRED");
    if (typeof system.isCandidate !== "boolean") add("CANDIDATE_FLAG_REQUIRED");
    if (system.isCandidate === true) {
      candidateCount += 1;
      if (system.productId !== "origin-personal" || system.candidateSha !== input.candidateSha) add("CANDIDATE_SYSTEM_SHA_MISMATCH");
    } else if (system.candidateSha !== undefined) add("NON_CANDIDATE_SHA_FORBIDDEN");
    if (system.status === "NOT_RUN") {
      if (typeof system.notRunReason !== "string" || system.notRunReason.trim().length < 8) add("SYSTEM_NOT_RUN_REASON_REQUIRED");
    } else if (system.status !== "AVAILABLE") add("SYSTEM_STATUS_INVALID");
  }
  if (candidateCount !== 1) add("EXACTLY_ONE_CANDIDATE_REQUIRED");
  if (productIds.size < 3 || !productIds.has("origin-personal")) add("ORIGIN_AND_TWO_EXTERNAL_PRODUCTS_REQUIRED");

  const results = Array.isArray(input.results) ? input.results : [];
  if (!results.length) add("RESULTS_REQUIRED");
  const taskFamilies = new Map();
  const taskFamilyById = new Map();
  const taskIds = new Set();
  const pairKeys = new Set();
  const executionIds = new Set();
  const executedProducts = new Set();
  for (const row of results) {
    if (!row || typeof row !== "object" || Array.isArray(row)) { add("RESULT_ROW_INVALID"); continue; }
    if (typeof row.taskId !== "string" || !SAFE.test(row.taskId)) add("TASK_ID_INVALID");
    else taskIds.add(row.taskId);
    if (typeof row.taskFamily !== "string" || !SAFE.test(row.taskFamily)) add("TASK_FAMILY_INVALID");
    else {
      if (typeof row.taskId === "string") {
        const existingFamily = taskFamilyById.get(row.taskId);
        if (existingFamily !== undefined && existingFamily !== row.taskFamily) add("TASK_FAMILY_INCONSISTENT");
        taskFamilyById.set(row.taskId, row.taskFamily);
        if (!taskFamilies.has(row.taskFamily)) taskFamilies.set(row.taskFamily, new Set());
        taskFamilies.get(row.taskFamily).add(row.taskId);
      }
    }
    if (!validSystemIds.has(row.systemId)) add("UNKNOWN_SYSTEM_ID");
    const pairKey = `${row.taskId}| ${row.systemId}`;
    if (pairKeys.has(pairKey)) add("DUPLICATE_TASK_SYSTEM_PAIR");
    pairKeys.add(pairKey);

    if (row.status === "NOT_RUN") {
      if (typeof row.notRunReason !== "string" || row.notRunReason.trim().length < 8) add("NOT_RUN_REASON_REQUIRED");
      for (const field of ["score", "scores", "passed", "cost", "executionId", "executedAt", "inputSha256", "outputSha256"]) {
        if (row[field] !== undefined) add("NOT_RUN_MUST_NOT_HAVE_" + field.toUpperCase());
      }
      continue;
    }
    if (row.status !== "EXECUTED") { add("EXECUTION_STATUS_INVALID"); continue; }
    if (typeof row.executionId !== "string" || !SAFE.test(row.executionId) || executionIds.has(row.executionId)) add("EXECUTION_ID_INVALID_OR_DUPLICATE");
    else executionIds.add(row.executionId);
    if (!ISO(row.executedAt) || Date.parse(row.executedAt) > nowMs + 5 * 60_000) add("EXECUTED_AT_INVALID");
    if (!SHA256.test(row.inputSha256 ?? "")) add("INPUT_DIGEST_INVALID");
    if (!SHA256.test(row.outputSha256 ?? "")) add("OUTPUT_DIGEST_INVALID");
    if (!Number.isFinite(row.durationMs) || row.durationMs < 0 || row.durationMs > 24 * 60 * 60 * 1000) add("DURATION_INVALID");
    if (typeof row.passed !== "boolean") add("PASS_FLAG_REQUIRED");
    if (typeof row.evidenceRef !== "string" || row.evidenceRef.trim().length < 8) add("EXECUTION_EVIDENCE_REFERENCE_REQUIRED");
    if (typeof row.rationale !== "string" || row.rationale.trim().length < 12) add("SCORE_RATIONALE_REQUIRED");
    const scores = row.scores && typeof row.scores === "object" && !Array.isArray(row.scores) ? Object.entries(row.scores) : [];
    if (scores.length < 3) add("APPLICABLE_DIMENSION_SCORES_REQUIRED");
    for (const [dimension, score] of scores) {
      if (!DIMENSIONS.has(dimension)) add("UNKNOWN_SCORE_DIMENSION");
      if (!Number.isFinite(score) || score < 0 || score > 5) add("SCORE_OUT_OF_RANGE");
    }
    const system = systems.find((item) => item?.systemId === row.systemId);
    if (system?.status === "NOT_RUN") add("UNAVAILABLE_SYSTEM_CANNOT_HAVE_EXECUTION");
    if (!row.cost || row.cost.amountUsd !== 0) add("ZERO_COST_NOT_PROVEN");
    else if (!["free-entitlement", "usage-record"].includes(row.cost.verification)) add("COST_VERIFICATION_INVALID");
    else if (typeof row.cost.evidenceRef !== "string" || row.cost.evidenceRef.trim().length < 8) add("COST_EVIDENCE_REFERENCE_REQUIRED");
    if (system) executedProducts.add(system.productId);
  }

  if (taskIds.size < 30) add("MINIMUM_30_TASKS_REQUIRED");
  if (taskFamilies.size < 6 || [...taskFamilies.values()].some((ids) => ids.size < 3)) add("SIX_FAMILIES_THREE_TASKS_EACH_REQUIRED");
  for (const taskId of taskIds) {
    for (const systemId of validSystemIds) {
      if (!pairKeys.has(`${taskId}| ${systemId}`)) add("INCOMPLETE_PAIRED_TASK_MATRIX");
    }
  }
  if (!executedProducts.has("origin-personal")) add("ORIGIN_NOT_EXECUTED");
  const externalExecuted = [...executedProducts].filter((id) => id !== "origin-personal");
  if (externalExecuted.length < 2) add("TWO_EXTERNAL_PRODUCTS_NOT_EXECUTED");

  const judging = input.judging;
  if (!judging || judging.blind !== true || judging.randomizedOrder !== true || !Number.isInteger(judging.independentJudges) || judging.independentJudges < 2) {
    add("INDEPENDENT_BLIND_JUDGING_REQUIRED");
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    taskCount: taskIds.size,
    systemCount: systems.length,
    executedExternalProductCount: executedProducts.size - (executedProducts.has("origin-personal") ? 1 : 0),
  };
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/validate-competitive-benchmark-evidence-v2.mjs <evidence.json>");
    process.exitCode = 2;
    return;
  }
  let input;
  try { input = JSON.parse(await readFile(path, "utf8")); }
  catch { console.error("EVIDENCE_JSON_INVALID"); process.exitCode = 2; return; }
  const report = validateCompetitiveBenchmarkEvidenceV2(input);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.valid) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
