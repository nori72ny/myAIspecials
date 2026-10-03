import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_FINAL_STATUS_ENV_MISSING:${name}`);
  return value;
}

async function main() {
  const stateDir = path.resolve(required("AQ_STATE_DIR"));
  const outputPath = path.resolve(required("AQ_STATUS_OUTPUT_PATH"));
  const promotionPath = path.resolve(required("AQ_PROMOTION_PATH"));
  const expectedShardCount = Number(required("EXPECTED_SHARD_COUNT"));
  const candidateSha = required("CANDIDATE_SHA");
  const baselineSha = required("BASELINE_SHA");

  let completedShardCount = 0;
  try {
    const names = await readdir(stateDir);
    completedShardCount = names.filter((name) => /^aq-official-shard-\d+\.json$/.test(name)).length;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    completedShardCount = 0;
  }

  let promotion = null;
  try {
    const raw = await readFile(promotionPath, "utf8");
    try {
      promotion = JSON.parse(raw);
    } catch {
      throw new Error("AQ_FINAL_STATUS_PROMOTION_INVALID_JSON");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    promotion = null;
  }

  if (promotion) {
    if (
      promotion.schemaVersion !== "origin.aq-live-final-promotion.v1"
      || promotion.candidateSha !== candidateSha
      || promotion.baselineSha !== baselineSha
      || promotion.shardCount !== expectedShardCount
      || completedShardCount !== expectedShardCount
      || promotion.caseCount !== 40
      || promotion.familyCount !== 10
      || promotion.zeroCost !== true
      || typeof promotion.promotionEligible !== "boolean"
      || !Array.isArray(promotion.blockers)
      || promotion.promotionEligible !== (promotion.blockers.length === 0)
    ) {
      throw new Error("AQ_FINAL_STATUS_PROMOTION_IDENTITY_INVALID");
    }
  }

  const measured = promotion !== null;
  const qualificationStatus = measured
    ? (promotion.promotionEligible ? "QUALIFIED" : "FAILED")
    : "NOT_MEASURED";
  const blockers = measured
    ? promotion.blockers
    : ["AQ_FINAL_EVIDENCE_INCOMPLETE"];

  const result = {
    schemaVersion: "origin.aq-live-final-status.v1",
    candidateSha,
    baselineSha,
    expectedShardCount,
    completedShardCount,
    caseCount: measured ? 40 : 0,
    familyCount: measured ? 10 : 0,
    zeroCost: measured ? true : null,
    qualificationStatus,
    measured,
    promotionEligible: measured ? promotion.promotionEligible : false,
    blockers,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `AQ qualificationStatus=${qualificationStatus}; shards=${completedShardCount}/${expectedShardCount}; promotionEligible=${result.promotionEligible}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "AQ_FINAL_STATUS_FAILED"}\n`);
  process.exitCode = 1;
});
