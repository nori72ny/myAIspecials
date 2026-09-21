import { promises as fs } from "node:fs";
import path from "node:path";

import {
  createOriginAnswerQualityFrozenCorpus,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkCorpus.js";
import {
  planOriginAnswerQualityBenchmarkQuotaShards,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkQuotaPlan.js";
import {
  parseOriginAnswerQualityOfficialShardComparison,
  type OriginAnswerQualityOfficialShardComparison,
} from "../src/lib/orchestration/OriginAnswerQualityOfficialShardComparison.js";
import {
  aggregateOriginAnswerQualityOfficialShards,
} from "../src/lib/orchestration/OriginAnswerQualityOfficialShardedComparison.js";

function exactWrapper(value: unknown): OriginAnswerQualityOfficialShardComparison {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AQ_LOCAL_SHARD_WRAPPER_INVALID");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 3
    || !keys.includes("schemaVersion")
    || !keys.includes("ok")
    || !keys.includes("shard")
    || record.schemaVersion !== "origin.aq-local-shard-result.v1"
    || record.ok !== true
  ) {
    throw new Error("AQ_LOCAL_SHARD_WRAPPER_INVALID");
  }

  const parsed = parseOriginAnswerQualityOfficialShardComparison(record.shard);
  if (parsed.ok === false) {
    throw new Error(`AQ_LOCAL_SHARD_PARSE_FAILED:${parsed.code}`);
  }
  return parsed.value;
}

async function main(): Promise<void> {
  const shardDir = path.resolve(
    process.env.ORIGIN_AQ_SHARD_DIR?.trim() || "test-results",
  );
  const outputPath = path.resolve(
    process.env.ORIGIN_AQ_AGGREGATE_OUTPUT_PATH?.trim()
      || "test-results/aq-official-sharded-comparison.json",
  );

  const corpus = createOriginAnswerQualityFrozenCorpus();
  const plan = planOriginAnswerQualityBenchmarkQuotaShards(corpus, 45);
  if (plan.ok === false) {
    throw new Error(`AQ_LOCAL_SHARD_PLAN_FAILED:${plan.code}`);
  }

  const shards: OriginAnswerQualityOfficialShardComparison[] = [];
  for (const planned of plan.value.shards) {
    const filePath = path.join(
      shardDir,
      `aq-official-shard-${planned.shardIndex}.json`,
    );
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      throw new Error(
        `AQ_LOCAL_SHARD_FILE_MISSING:${planned.shardIndex}`,
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(
        `AQ_LOCAL_SHARD_FILE_INVALID_JSON:${planned.shardIndex}`,
      );
    }

    const shard = exactWrapper(parsedJson);
    if (shard.shardIndex !== planned.shardIndex) {
      throw new Error(
        `AQ_LOCAL_SHARD_INDEX_MISMATCH:${planned.shardIndex}`,
      );
    }
    shards.push(shard);
  }

  const aggregate = aggregateOriginAnswerQualityOfficialShards(
    corpus,
    plan.value,
    shards,
  );
  if (aggregate.ok === false) {
    throw new Error(
      `AQ_LOCAL_SHARD_AGGREGATION_FAILED:${aggregate.code}`
      + (aggregate.detail ? `:${aggregate.detail}` : ""),
    );
  }

  const output = {
    schemaVersion: "origin.aq-local-sharded-comparison-result.v1",
    ok: true,
    comparison: aggregate.value,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(output, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  process.stdout.write(
    `AQ official sharded comparison completed: ${aggregate.value.aggregateDigest}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : "AQ_LOCAL_SHARD_AGGREGATION_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
