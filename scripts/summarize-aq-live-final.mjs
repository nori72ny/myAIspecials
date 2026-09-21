import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FAMILIES = [
  "current-factual",
  "multi-source-comparison",
  "contradiction-detection",
  "user-document-reasoning",
  "professional-advice",
  "coding-generation",
  "coding-repair",
  "artifact-generation",
  "ambiguity-handling",
  "fail-closed",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_FINAL_SUMMARY_ENV_MISSING:${name}`);
  return value;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function delta(baseline, candidate) {
  const baselineRepair = baseline.filter((item) => item.repairSucceeded !== undefined);
  const candidateRepair = candidate.filter((item) => item.repairSucceeded !== undefined);
  return {
    factualSupportDelta:
      mean(candidate.map((item) => item.factualSupportScore))
      - mean(baseline.map((item) => item.factualSupportScore)),
    citationPrecisionDelta:
      mean(candidate.map((item) => item.citationPrecisionScore))
      - mean(baseline.map((item) => item.citationPrecisionScore)),
    taskCompletionDelta:
      mean(candidate.map((item) => item.taskCompletionScore))
      - mean(baseline.map((item) => item.taskCompletionScore)),
    contradictionDetectionDelta:
      mean(candidate.map((item) => item.contradictionDetectionScore))
      - mean(baseline.map((item) => item.contradictionDetectionScore)),
    unsupportedMaterialClaimDelta:
      candidate.reduce((sum, item) => sum + item.unsupportedMaterialClaimCount, 0)
      - baseline.reduce((sum, item) => sum + item.unsupportedMaterialClaimCount, 0),
    verifierRejectionRateDelta:
      mean(candidate.map((item) => item.verifierRejectedUnsupportedClaim ? 1 : 0))
      - mean(baseline.map((item) => item.verifierRejectedUnsupportedClaim ? 1 : 0)),
    repairSuccessRateDelta:
      baselineRepair.length && candidateRepair.length
        ? mean(candidateRepair.map((item) => item.repairSucceeded ? 1 : 0))
          - mean(baselineRepair.map((item) => item.repairSucceeded ? 1 : 0))
        : null,
  };
}

function criticalRegression(value) {
  return value.unsupportedMaterialClaimDelta > 0
    || value.verifierRejectionRateDelta < 0
    || value.factualSupportDelta < 0
    || value.taskCompletionDelta < 0
    || value.citationPrecisionDelta < 0
    || value.contradictionDetectionDelta < 0
    || (value.repairSuccessRateDelta !== null && value.repairSuccessRateDelta < 0);
}

function improved(value) {
  return value.factualSupportDelta > 0
    || value.citationPrecisionDelta > 0
    || value.taskCompletionDelta > 0
    || value.contradictionDetectionDelta > 0
    || value.unsupportedMaterialClaimDelta < 0
    || value.verifierRejectionRateDelta > 0
    || (value.repairSuccessRateDelta !== null && value.repairSuccessRateDelta > 0);
}

async function main() {
  const stateDir = path.resolve(required("AQ_STATE_DIR"));
  const aggregatePath = path.resolve(required("AQ_AGGREGATE_PATH"));
  const outputPath = path.resolve(required("AQ_PROMOTION_OUTPUT_PATH"));
  const expectedShardCount = Number(required("EXPECTED_SHARD_COUNT"));
  const candidateSha = required("CANDIDATE_SHA");
  const baselineSha = required("BASELINE_SHA");

  const wrapper = JSON.parse(await readFile(aggregatePath, "utf8"));
  if (
    wrapper?.schemaVersion !== "origin.aq-local-sharded-comparison-result.v1"
    || wrapper?.ok !== true
  ) {
    throw new Error("AQ_FINAL_SUMMARY_AGGREGATE_INVALID");
  }

  const comparison = wrapper.comparison;
  if (
    comparison?.candidateGitSha !== candidateSha
    || comparison?.baselineGitSha !== baselineSha
    || comparison?.shardCount !== expectedShardCount
  ) {
    throw new Error("AQ_FINAL_SUMMARY_IDENTITY_MISMATCH");
  }

  const baseline = [];
  const candidate = [];
  for (let index = 0; index < expectedShardCount; index += 1) {
    const shard = JSON.parse(
      await readFile(path.join(stateDir, `aq-official-shard-${index}.json`), "utf8"),
    );
    if (shard?.ok !== true || shard?.shard?.shardIndex !== index) {
      throw new Error(`AQ_FINAL_SUMMARY_SHARD_INVALID:${index}`);
    }
    baseline.push(...shard.shard.baselineObservations);
    candidate.push(...shard.shard.candidateObservations);
  }

  if (baseline.length !== 40 || candidate.length !== 40) {
    throw new Error("AQ_FINAL_SUMMARY_CASECOUNT_INVALID");
  }

  const regressionFamilies = [];
  let targetedImprovementObserved = false;
  for (const family of FAMILIES) {
    const familyDelta = delta(
      baseline.filter((item) => item.category === family),
      candidate.filter((item) => item.category === family),
    );
    if (criticalRegression(familyDelta)) regressionFamilies.push(family);
    if (improved(familyDelta)) targetedImprovementObserved = true;
  }

  const hardGates = comparison.hardGates || {};
  const blockers = [];
  for (const [key, value] of Object.entries(hardGates)) {
    if (value !== true) blockers.push(`HARD_GATE:${key}`);
  }
  if (regressionFamilies.length) blockers.push("CRITICAL_FAMILY_REGRESSION");
  if (!targetedImprovementObserved) blockers.push("NO_TARGETED_IMPROVEMENT");

  const result = {
    schemaVersion: "origin.aq-live-final-promotion.v1",
    candidateSha,
    baselineSha,
    caseCount: 40,
    familyCount: 10,
    zeroCost:
      comparison.baseline?.totalCostUsd === 0
      && comparison.candidate?.totalCostUsd === 0,
    shardCount: expectedShardCount,
    aggregateDigest: comparison.aggregateDigest,
    promotionEligible: blockers.length === 0,
    blockers,
    regressionFamilies,
    targetedImprovementObserved,
    hardGates,
  };

  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(
    `AQ final promotionEligible=${result.promotionEligible}; blockers=${blockers.join(",") || "none"}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "AQ_FINAL_SUMMARY_FAILED"}\n`);
  process.exitCode = 1;
});
