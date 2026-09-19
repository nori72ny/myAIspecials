import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL } from "../src/lib/orchestration/OriginFreeModelCatalog.js";
import {
  createOriginAnswerQualityFrozenCorpus,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkCorpus.js";
import {
  planOriginAnswerQualityBenchmarkQuotaShards,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkQuotaPlan.js";
import {
  runOriginAnswerQualityOfficialShardComparison,
} from "../src/lib/orchestration/OriginAnswerQualityOfficialShardComparison.js";

const exec = promisify(execFile);
const SHA40 = /^[a-f0-9]{40}$/;
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const START_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 5_000;

interface LocalTarget {
  readonly label: "baseline" | "candidate";
  readonly root: string;
  readonly sha: string;
  readonly port: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_LOCAL_COMPARISON_ENV_MISSING:${name}`);
  return value;
}

function parseShardIndex(maxExclusive: number): number {
  const raw = requiredEnv("ORIGIN_AQ_SHARD_INDEX");
  const value = Number.parseInt(raw, 10);
  if (
    !/^\d+$/.test(raw)
    || !Number.isInteger(value)
    || value < 0
    || value >= maxExclusive
  ) {
    throw new Error("AQ_LOCAL_COMPARISON_SHARD_INDEX_INVALID");
  }
  return value;
}

function parsePort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isInteger(value) || value < PORT_MIN || value > PORT_MAX) {
    throw new Error(`AQ_LOCAL_COMPARISON_PORT_INVALID:${name}`);
  }
  return value;
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await exec("git", [...args], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    timeout: 10_000,
    maxBuffer: 16 * 1024,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function validateTarget(target: LocalTarget): Promise<void> {
  if (!SHA40.test(target.sha)) {
    throw new Error(`AQ_LOCAL_COMPARISON_SHA_INVALID:${target.label}`);
  }

  const root = await fs.realpath(target.root);
  const observed = await git(["rev-parse", "--verify", "HEAD"], root);
  if (observed !== target.sha) {
    throw new Error(`AQ_LOCAL_COMPARISON_SHA_MISMATCH:${target.label}`);
  }

  try {
    await git(["diff-index", "--quiet", "HEAD", "--"], root);
  } catch {
    throw new Error(`AQ_LOCAL_COMPARISON_DIRTY_CHECKOUT:${target.label}`);
  }

  const porcelain = await git(["status", "--porcelain=v1", "--untracked-files=all"], root);
  if (porcelain.length > 0) {
    throw new Error(`AQ_LOCAL_COMPARISON_DIRTY_CHECKOUT:${target.label}`);
  }

  await fs.access(path.join(root, "package.json"));
  await fs.access(path.join(root, "node_modules"));
}

async function buildTarget(target: LocalTarget): Promise<void> {
  const buildEnv = { ...process.env };
  delete buildEnv.OPENROUTER_API_KEY;
  delete buildEnv.GEMINI_API_KEY;
  delete buildEnv.ANTHROPIC_API_KEY;
  delete buildEnv.OPENAI_API_KEY;

  try {
    await exec("npm", ["run", "build"], {
      cwd: target.root,
      env: {
        ...buildEnv,
        NODE_ENV: "production",
        ORIGIN_RELEASE_SHA: target.sha,
      },
      timeout: 180_000,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
    });
  } catch {
    throw new Error(`AQ_LOCAL_COMPARISON_BUILD_FAILED:${target.label}`);
  }
}

function startTarget(target: LocalTarget): ChildProcess {
  return spawn(process.execPath, ["dist/server.cjs"], {
    cwd: target.root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(target.port),
      ORIGIN_RELEASE_SHA: target.sha,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

async function waitUntilHealthy(target: LocalTarget, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  const url = `http://127.0.0.1:${target.port}/api/health`;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`AQ_LOCAL_COMPARISON_SERVER_EXITED:${target.label}`);
    }
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Bounded readiness polling only; provider execution is not retried here.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`AQ_LOCAL_COMPARISON_SERVER_START_TIMEOUT:${target.label}`);
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
  await Promise.race([exited, timeout]);

  if (child.exitCode === null) child.kill("SIGKILL");
}

function sanitizedResult(
  result: Awaited<ReturnType<typeof runOriginAnswerQualityOfficialShardComparison>>,
) {
  if (result.ok === false) {
    return {
      schemaVersion: "origin.aq-local-shard-result.v1",
      ok: false,
      code: result.code,
      ...(result.detail ? { detail: result.detail } : {}),
    };
  }

  return {
    schemaVersion: "origin.aq-local-shard-result.v1",
    ok: true,
    shard: result.value,
  };
}

async function main(): Promise<void> {
  const baselineRoot = await fs.realpath(requiredEnv("ORIGIN_AQ_BASELINE_ROOT"));
  const candidateRoot = await fs.realpath(requiredEnv("ORIGIN_AQ_CANDIDATE_ROOT"));
  const baselineSha = requiredEnv("ORIGIN_AQ_BASELINE_SHA");
  const candidateSha = requiredEnv("ORIGIN_AQ_CANDIDATE_SHA");
  const outputPath = path.resolve(
    process.env.ORIGIN_AQ_OUTPUT_PATH?.trim() || "test-results/aq-official-comparison.json",
  );

  const baseline: LocalTarget = {
    label: "baseline",
    root: baselineRoot,
    sha: baselineSha,
    port: parsePort("ORIGIN_AQ_BASELINE_PORT", 4311),
  };
  const candidate: LocalTarget = {
    label: "candidate",
    root: candidateRoot,
    sha: candidateSha,
    port: parsePort("ORIGIN_AQ_CANDIDATE_PORT", 4312),
  };

  if (baseline.root === candidate.root || baseline.sha === candidate.sha || baseline.port === candidate.port) {
    throw new Error("AQ_LOCAL_COMPARISON_TARGETS_NOT_DISTINCT");
  }

  const fullCorpus = createOriginAnswerQualityFrozenCorpus();
  const quotaPlan = planOriginAnswerQualityBenchmarkQuotaShards(fullCorpus, 45);
  if (quotaPlan.ok === false) {
    throw new Error(`AQ_LOCAL_COMPARISON_QUOTA_PLAN_FAILED:${quotaPlan.code}`);
  }
  const shardIndex = parseShardIndex(quotaPlan.value.shards.length);
  const shard = quotaPlan.value.shards[shardIndex];

  await validateTarget(baseline);
  await validateTarget(candidate);
  await buildTarget(baseline);
  await buildTarget(candidate);

  let baselineServer: ChildProcess | undefined;
  let candidateServer: ChildProcess | undefined;

  try {
    baselineServer = startTarget(baseline);
    candidateServer = startTarget(candidate);
    await Promise.all([
      waitUntilHealthy(baseline, baselineServer),
      waitUntilHealthy(candidate, candidateServer),
    ]);

    const result = await runOriginAnswerQualityOfficialShardComparison({
      fullCorpus,
      shard,
      providerId: "openrouter-free",
      modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
      baseline: {
        runId: `baseline-${baseline.sha.slice(0, 12)}-s${shardIndex}`,
        gitSha: baseline.sha,
        baseUrl: `http://127.0.0.1:${baseline.port}/`,
        sourceRoot: baseline.root,
      },
      candidate: {
        runId: `candidate-${candidate.sha.slice(0, 12)}-s${shardIndex}`,
        gitSha: candidate.sha,
        baseUrl: `http://127.0.0.1:${candidate.port}/`,
        sourceRoot: candidate.root,
      },
      env: process.env,
    });

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      `${JSON.stringify(sanitizedResult(result), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    if (result.ok === false) {
      throw new Error(`AQ_LOCAL_COMPARISON_FAILED:${result.code}`);
    }

    process.stdout.write(
      `AQ official shard ${shardIndex}/${quotaPlan.value.shards.length - 1} completed: ${result.value.shardDigest}\n`,
    );
  } finally {
    await Promise.all([stop(candidateServer), stop(baselineServer)]);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "AQ_LOCAL_COMPARISON_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
