import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { createOriginAnswerQualityFrozenCorpus } from "../src/lib/orchestration/OriginAnswerQualityBenchmarkCorpus.js";
import {
  planOriginAnswerQualityBenchmarkCaseShards,
  selectOriginAnswerQualityBenchmarkNextBudgetedShard,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkQuotaPlan.js";

const exec = promisify(execFile);
const DAILY_PROVIDER_BUDGET = 45;
const MAX_SHARDS_PER_DAY = 4;
const SHA40 = /^[a-f0-9]{40}$/;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_BUDGETED_DAY_ENV_MISSING:${name}`);
  return value;
}

async function readCompleted(
  stateDir: string,
  baselineSha: string,
  candidateSha: string,
): Promise<Set<number>> {
  const completed = new Set<number>();
  let names: string[] = [];
  try {
    names = await fs.readdir(stateDir);
  } catch {
    return completed;
  }

  for (const name of names) {
    const match = /^aq-official-shard-(\d+)\.json$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    const raw = await fs.readFile(path.join(stateDir, name), "utf8");
    const value = JSON.parse(raw) as {
      schemaVersion?: string;
      ok?: boolean;
      shard?: {
        schemaVersion?: string;
        shardDigest?: string;
        shardIndex?: number;
        baselineGitSha?: string;
        candidateGitSha?: string;
      };
    };
    if (
      value.schemaVersion !== "origin.aq-local-shard-result.v1"
      || value.ok !== true
      || value.shard?.shardIndex !== index
      || value.shard?.baselineGitSha !== baselineSha
      || value.shard?.candidateGitSha !== candidateSha
    ) {
      throw new Error(`AQ_BUDGETED_DAY_STATE_INVALID:${index}`);
    }
    completed.add(index);
  }
  return completed;
}

export async function runBudgetedDay(runShard = async (env: NodeJS.ProcessEnv) => {
  await exec("npm", ["run", "eval:aq-local-comparison-shard"], {
    cwd: process.cwd(), env, timeout: 20 * 60_000,
    maxBuffer: 4 * 1024 * 1024, encoding: "utf8",
  });
}): Promise<void> {
  const baselineSha = required("ORIGIN_AQ_BASELINE_SHA");
  const candidateSha = required("ORIGIN_AQ_CANDIDATE_SHA");
  const stateDir = path.resolve(required("AQ_STATE_DIR"));
  const newDir = path.resolve(required("AQ_NEW_SHARD_DIR"));

  if (!SHA40.test(baselineSha) || !SHA40.test(candidateSha) || baselineSha === candidateSha) {
    throw new Error("AQ_BUDGETED_DAY_SHA_INVALID");
  }

  const corpus = createOriginAnswerQualityFrozenCorpus();
  const plan = planOriginAnswerQualityBenchmarkCaseShards(corpus, DAILY_PROVIDER_BUDGET);
  if (plan.ok === false) {
    throw new Error(`AQ_BUDGETED_DAY_PLAN_FAILED:${plan.code}`);
  }

  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await fs.rm(newDir, { recursive: true, force: true });
  await fs.mkdir(newDir, { recursive: true, mode: 0o700 });

  const completed = await readCompleted(stateDir, baselineSha, candidateSha);
  const executed: Array<{ shardIndex: number; plannedMax: number; actualRequests: number }> = [];
  let used = 0;
  let pendingOutput: string | undefined;
  let interrupted = true;

  try {
    while (
      completed.size < plan.value.shards.length
      && executed.length < MAX_SHARDS_PER_DAY
    ) {
      const next = selectOriginAnswerQualityBenchmarkNextBudgetedShard(
        plan.value,
        completed,
        used,
        DAILY_PROVIDER_BUDGET,
      );
      if (!next) break;

      const outputPath = path.join(stateDir, `aq-official-shard-${next.shardIndex}.json`);
      pendingOutput = outputPath;
      await runShard({
          ...process.env,
          ORIGIN_AQ_SHARD_MODE: "case-isolated",
          ORIGIN_AQ_SHARD_INDEX: String(next.shardIndex),
          ORIGIN_AQ_OUTPUT_PATH: outputPath,
      });

      const raw = await fs.readFile(outputPath, "utf8");
      const value = JSON.parse(raw) as {
        schemaVersion?: string;
        ok?: boolean;
        shard?: {
          schemaVersion?: string;
          shardDigest?: string;
          shardIndex?: number;
          baselineGitSha?: string;
          candidateGitSha?: string;
          baselineRuntimeProviderRequests?: number;
          candidateRuntimeProviderRequests?: number;
          baselineEvaluatorRequests?: number;
          candidateEvaluatorRequests?: number;
          plannedPairedRequestsMax?: number;
        };
      };
      const shard = value.shard;
      const counts = [
        shard?.baselineRuntimeProviderRequests,
        shard?.candidateRuntimeProviderRequests,
        shard?.baselineEvaluatorRequests,
        shard?.candidateEvaluatorRequests,
      ];
      if (
        value.schemaVersion !== "origin.aq-local-shard-result.v1"
        || value.ok !== true
        || shard?.schemaVersion !== "origin.aq-official-shard-comparison.v1"
        || !/^sha256:[a-f0-9]{64}$/.test(shard?.shardDigest ?? "")
        || shard?.shardIndex !== next.shardIndex
        || shard?.baselineGitSha !== baselineSha
        || shard?.candidateGitSha !== candidateSha
        || shard?.plannedPairedRequestsMax !== next.pairedRequestsMax
        || counts.some((count) => !Number.isSafeInteger(count) || Number(count) < 0)
      ) {
        throw new Error(`AQ_BUDGETED_DAY_RESULT_INVALID:${next.shardIndex}`);
      }

      const actualRequests = counts.reduce((sum, count) => sum + Number(count), 0);
      if (
        actualRequests > next.pairedRequestsMax
        || used + actualRequests > DAILY_PROVIDER_BUDGET
      ) {
        throw new Error(`AQ_BUDGETED_DAY_REQUEST_BUDGET_EXCEEDED:${next.shardIndex}`);
      }

      await fs.copyFile(
        outputPath,
        path.join(newDir, `aq-official-shard-${next.shardIndex}.json`),
      );
      used += actualRequests;
      completed.add(next.shardIndex);
      executed.push({
        shardIndex: next.shardIndex,
        plannedMax: next.pairedRequestsMax,
        actualRequests,
      });
      pendingOutput = undefined;
    }

    if (executed.length === 0) {
      throw new Error("AQ_BUDGETED_DAY_NO_SAFE_SHARD_AVAILABLE");
    }
    interrupted = false;
  } finally {
    // A failed attempt may have consumed requests: never retry it in this day.
    // Only fully validated successes enter durable evidence or aggregate state.
    if (pendingOutput) await fs.rm(pendingOutput, { force: true });

    const summary = {
      schemaVersion: "origin.aq-budgeted-day.v1",
      candidateSha,
      baselineSha,
      dailyProviderBudget: DAILY_PROVIDER_BUDGET,
      actualRequestsUsed: used,
      maxShardsPerDay: MAX_SHARDS_PER_DAY,
      executed,
      completedShardCount: completed.size,
      expectedShardCount: plan.value.shards.length,
      interrupted,
      actualRequestsUsedIsLowerBound: interrupted,
    };
    await fs.writeFile(
      path.join(newDir, "aq-budgeted-day-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  process.stdout.write(
    `AQ budgeted day completed ${executed.length} shard(s), ${used}/${DAILY_PROVIDER_BUDGET} requests used, total ${completed.size}/${plan.value.shards.length}.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runBudgetedDay().catch(() => {
    // Child-process errors can include inherited credentials and raw responses.
    process.stderr.write("AQ_BUDGETED_DAY_FAILED: see sanitized checkpoint; quota remains reserved.\n");
    process.exitCode = 1;
  });
}
