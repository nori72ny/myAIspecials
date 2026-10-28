#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
const ISO = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

export function validateBenchmarkEvidence(input, nowMs = Date.now()) {
  const errors = [];
  const add = (code) => errors.push(code);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["EVIDENCE_OBJECT_REQUIRED"] };
  }
  if (input.schemaVersion !== "origin.competitive-benchmark-evidence.v1") add("SCHEMA_VERSION_INVALID");
  if (typeof input.candidateSha !== "string" || !SHA40.test(input.candidateSha)) add("CANDIDATE_SHA_INVALID");
  if (typeof input.taskSetSha256 !== "string" || !SHA256.test(input.taskSetSha256)) add("TASK_SET_DIGEST_INVALID");
  if (!ISO(input.createdAt) || Date.parse(input.createdAt) > nowMs + 5 * 60_000) add("CREATED_AT_INVALID");
  if (!Array.isArray(input.results) || input.results.length < 1) add("RESULTS_REQUIRED");
  const results = Array.isArray(input.results) ? input.results : [];
  const ids = new Set();
  for (const row of results) {
    if (!row || typeof row !== "object" || Array.isArray(row)) { add("RESULT_ROW_INVALID"); continue; }
    if (typeof row.taskId !== "string" || !SAFE.test(row.taskId) || ids.has(row.taskId)) add("TASK_ID_INVALID_OR_DUPLICATE");
    else ids.add(row.taskId);
    if (row.status === "NOT_RUN") {
      if (typeof row.notRunReason !== "string" || row.notRunReason.trim().length < 8) add("NOT_RUN_REASON_REQUIRED");
      if (row.score !== undefined || row.passed !== undefined) add("NOT_RUN_MUST_NOT_HAVE_SCORE");
      continue;
    }
    if (row.status !== "EXECUTED") { add("EXECUTION_STATUS_INVALID"); continue; }
    if (typeof row.product !== "string" || !SAFE.test(row.product)) add("PRODUCT_ID_INVALID");
    if (typeof row.surface !== "string" || row.surface.trim().length < 2) add("PRODUCT_SURFACE_REQUIRED");
    if (typeof row.modelLabel !== "string" || row.modelLabel.trim().length < 2) add("MODEL_LABEL_REQUIRED");
    if (typeof row.planTier !== "string" || row.planTier.trim().length < 2) add("PLAN_TIER_REQUIRED");
    if (typeof row.executionId !== "string" || !SAFE.test(row.executionId)) add("EXECUTION_ID_REQUIRED");
    if (!ISO(row.executedAt) || Date.parse(row.executedAt) > nowMs + 5 * 60_000) add("EXECUTED_AT_INVALID");
    if (!SHA256.test(row.inputSha256 ?? "")) add("INPUT_DIGEST_INVALID");
    if (!SHA256.test(row.outputSha256 ?? "")) add("OUTPUT_DIGEST_INVALID");
    if (!Number.isFinite(row.durationMs) || row.durationMs < 0 || row.durationMs > 24 * 60 * 60 * 1000) add("DURATION_INVALID");
    if (!Number.isInteger(row.score) || row.score < 0 || row.score > 5) add("SCORE_OUT_OF_RANGE");
    if (typeof row.passed !== "boolean") add("PASS_FLAG_REQUIRED");
    if (!row.cost || row.cost.amountUsd !== 0) add("ZERO_COST_NOT_PROVEN");
    else if (!["free-entitlement", "usage-record", "local-only"].includes(row.cost.verification)) add("COST_VERIFICATION_INVALID");
    else if (typeof row.cost.evidenceRef !== "string" || row.cost.evidenceRef.trim().length < 8) add("COST_EVIDENCE_REFERENCE_REQUIRED");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], taskCount: results.length };
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/validate-competitive-benchmark-evidence.mjs <evidence.json>");
    process.exitCode = 2;
    return;
  }
  let input;
  try { input = JSON.parse(await readFile(path, "utf8")); }
  catch { console.error("EVIDENCE_JSON_INVALID"); process.exitCode = 2; return; }
  const report = validateBenchmarkEvidence(input);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.valid) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
