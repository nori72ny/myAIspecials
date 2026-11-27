import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
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

// Emit only fixed, reviewed labels. Never forward child stderr, messages,
// provider payloads or arbitrary detail strings into public Actions logs.
const FAILURE_CODES = new Set([
  "AQ_BENCHMARK_SHARD_COMPARISON_INVALID_INPUT",
  "AQ_BENCHMARK_SHARD_BASELINE_ENVIRONMENT_INVALID",
  "AQ_BENCHMARK_SHARD_CANDIDATE_ENVIRONMENT_INVALID",
  "AQ_BENCHMARK_SHARD_BASELINE_SESSION_FAILED",
  "AQ_BENCHMARK_SHARD_CANDIDATE_SESSION_FAILED",
  "AQ_BENCHMARK_SHARD_SCORER_MISMATCH",
  "AQ_BENCHMARK_SHARD_SESSION_IDENTITY_MISMATCH",
]);
const LOCAL_FAILURE_CODES = new Set(
  ["BUILD_FAILED", "SERVER_EXITED", "SERVER_START_TIMEOUT", "SHA_INVALID",
    "SHA_MISMATCH", "DIRTY_CHECKOUT"].flatMap(code =>
    ["baseline", "candidate"].map(side => `AQ_LOCAL_COMPARISON_${code}:${side}`)),
);

const SESSION_FAILURE_STAGES = new Set([
  "AQ_BENCHMARK_SESSION_ENVIRONMENT_PROOF_INVALID",
  "AQ_BENCHMARK_SESSION_RUNTIME_NOT_READY",
  "AQ_BENCHMARK_SESSION_EXECUTION_FAILED",
  "AQ_BENCHMARK_SESSION_PROVENANCE_INVALID",
  "AQ_BENCHMARK_SESSION_RUN_BINDING_FAILED",
  "AQ_BENCHMARK_SESSION_SCORECARD_INVALID",
  "AQ_BENCHMARK_SESSION_MEASURED_BINDING_FAILED",
  "AQ_BENCHMARK_OFFICIAL_SCORER_PROVENANCE_INVALID",
]);

export function sanitizedSessionFailureStage(detail: unknown): string | null {
  if (typeof detail !== "string" || detail.length > 16_384) return null;
  const stage = detail.split(":", 1)[0];
  return SESSION_FAILURE_STAGES.has(stage) ? stage : null;
}

async function classifyFailure(outputPath: string | undefined, error: unknown): Promise<string> {
  if (outputPath) {
    try {
      // Open once: validation and the bounded read refer to the same inode.
      // Reject symlinks and avoid blocking on a substituted FIFO.
      const file = await fs.open(outputPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await file.stat();
        if (stat.isFile() && stat.size <= 16_384) {
          const buffer = Buffer.alloc(16_385);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          if (bytesRead <= 16_384) {
            const value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
            if (value?.schemaVersion === "origin.aq-local-shard-result.v1"
              && value.ok === false && FAILURE_CODES.has(value.code)) {
            if (value.code === "AQ_BENCHMARK_SHARD_BASELINE_SESSION_FAILED"
              || value.code === "AQ_BENCHMARK_SHARD_CANDIDATE_SESSION_FAILED") {
              const stage = sanitizedSessionFailureStage(value.detail);
              if (stage) process.stdout.write(`AQ session failure stage ${stage}\n`);
            }
            return value.code;
          }
          }
        }
      } finally {
        await file.close();
      }
    } catch { /* Missing or invalid output is not evidence of a provider error. */ }
  }
  const stderr = error && typeof error === "object" && "stderr" in error
    && typeof error.stderr === "string" ? error.stderr : "";
  for (const line of stderr.slice(0, 65_536).split(/\r?\n/)) {
    if (LOCAL_FAILURE_CODES.has(line)) return line;
  }
  return "AQ_FAILURE_UNCLASSIFIED";
}

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
  let attemptedShardIndex: number | null = null;
  let failureCode: string | null = null;

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
      attemptedShardIndex = next.shardIndex;
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
  } catch (error) {
    failureCode = await classifyFailure(pendingOutput, error);
    throw error;
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
      failureCode,
      attemptedShardIndex,
    };
    await fs.writeFile(
      path.join(newDir, "aq-budgeted-day-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    if (interrupted) {
      // This also survives a first-shard failure, when no success batch exists.
      process.stdout.write(`AQ failure checkpoint ${JSON.stringify({
        candidateSha, baselineSha, attemptedShardIndex, failureCode,
        completedShardCount: completed.size, actualRequestsUsedLowerBound: used,
        providerRequestCountKnown: false, qualificationStatus: "NOT_MEASURED",
      })}\n`);
    }
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
