import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL } from "../src/lib/orchestration/OriginFreeModelCatalog.js";
import {
  probeOriginAnswerQualityBenchmarkEnvironment,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkEnvironmentProof.js";
import {
  runOriginAnswerQualityOfficialQuotaChunk,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkQuotaChunkRunner.js";

const exec = promisify(execFile);
const SHA40 = /^[a-f0-9]{40}$/;
const START_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 5_000;

interface Target {
  readonly label: "baseline" | "candidate";
  readonly root: string;
  readonly sha: string;
  readonly port: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_QUOTA_CHUNK_ENV_MISSING:${name}`);
  return value;
}

function port(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`AQ_QUOTA_CHUNK_PORT_INVALID:${name}`);
  }
  return value;
}

function chunkIndex(): number {
  const raw = requiredEnv("ORIGIN_AQ_CHUNK_INDEX");
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || value > 9 || String(value) !== raw) {
    throw new Error("AQ_QUOTA_CHUNK_INDEX_INVALID");
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

async function validateTarget(target: Target): Promise<void> {
  if (!SHA40.test(target.sha)) throw new Error(`AQ_QUOTA_CHUNK_SHA_INVALID:${target.label}`);
  const root = await fs.realpath(target.root);
  if (await git(["rev-parse", "--verify", "HEAD"], root) !== target.sha) {
    throw new Error(`AQ_QUOTA_CHUNK_SHA_MISMATCH:${target.label}`);
  }
  try {
    await git(["diff-index", "--quiet", "HEAD", "--"], root);
  } catch {
    throw new Error(`AQ_QUOTA_CHUNK_DIRTY_CHECKOUT:${target.label}`);
  }
  const porcelain = await git(["status", "--porcelain=v1", "--untracked-files=all"], root);
  if (porcelain.length > 0) {
    throw new Error(`AQ_QUOTA_CHUNK_DIRTY_CHECKOUT:${target.label}`);
  }
  await fs.access(path.join(root, "package.json"));
  await fs.access(path.join(root, "node_modules"));
}

async function build(target: Target): Promise<void> {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  try {
    await exec("npm", ["run", "build"], {
      cwd: target.root,
      env: {
        ...env,
        NODE_ENV: "production",
        ORIGIN_RELEASE_SHA: target.sha,
      },
      timeout: 180_000,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
    });
  } catch {
    throw new Error(`AQ_QUOTA_CHUNK_BUILD_FAILED:${target.label}`);
  }
}

function start(target: Target): ChildProcess {
  return spawn(process.execPath, ["dist/server.cjs"], {
    cwd: target.root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(target.port),
      ORIGIN_RELEASE_SHA: target.sha,
      FREE_ONLY: "true",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

async function waitHealthy(target: Target, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  const url = `http://127.0.0.1:${target.port}/api/health`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`AQ_QUOTA_CHUNK_SERVER_EXITED:${target.label}`);
    }
    try {
      const response = await fetch(url, {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Readiness polling only; no provider request is retried here.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`AQ_QUOTA_CHUNK_SERVER_TIMEOUT:${target.label}`);
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("AQ_QUOTA_CHUNK_OPENROUTER_NOT_CONFIGURED");
  }

  const index = chunkIndex();
  const baseline: Target = {
    label: "baseline",
    root: await fs.realpath(requiredEnv("ORIGIN_AQ_BASELINE_ROOT")),
    sha: requiredEnv("ORIGIN_AQ_BASELINE_SHA"),
    port: port("ORIGIN_AQ_BASELINE_PORT", 4411),
  };
  const candidate: Target = {
    label: "candidate",
    root: await fs.realpath(requiredEnv("ORIGIN_AQ_CANDIDATE_ROOT")),
    sha: requiredEnv("ORIGIN_AQ_CANDIDATE_SHA"),
    port: port("ORIGIN_AQ_CANDIDATE_PORT", 4412),
  };

  if (
    baseline.root === candidate.root
    || baseline.sha === candidate.sha
    || baseline.port === candidate.port
  ) {
    throw new Error("AQ_QUOTA_CHUNK_TARGETS_NOT_DISTINCT");
  }

  await validateTarget(baseline);
  await validateTarget(candidate);
  await build(baseline);
  await build(candidate);

  let baselineServer: ChildProcess | undefined;
  let candidateServer: ChildProcess | undefined;

  try {
    baselineServer = start(baseline);
    candidateServer = start(candidate);
    await Promise.all([
      waitHealthy(baseline, baselineServer),
      waitHealthy(candidate, candidateServer),
    ]);

    const baselineEnvironment = await probeOriginAnswerQualityBenchmarkEnvironment(
      `http://127.0.0.1:${baseline.port}/`,
      baseline.sha,
    );
    if (!baselineEnvironment.ok) {
      throw new Error(`AQ_QUOTA_CHUNK_BASELINE_ENV_INVALID:${baselineEnvironment.code}`);
    }

    const candidateEnvironment = await probeOriginAnswerQualityBenchmarkEnvironment(
      `http://127.0.0.1:${candidate.port}/`,
      candidate.sha,
    );
    if (!candidateEnvironment.ok) {
      throw new Error(`AQ_QUOTA_CHUNK_CANDIDATE_ENV_INVALID:${candidateEnvironment.code}`);
    }

    const baselineResult = await runOriginAnswerQualityOfficialQuotaChunk({
      chunkIndex: index,
      gitSha: baseline.sha,
      providerId: "openrouter-free",
      modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
      environmentProof: baselineEnvironment.value,
      sourceRoot: baseline.root,
      env: process.env,
    });
    if (!baselineResult.ok) {
      throw new Error(`AQ_QUOTA_CHUNK_BASELINE_FAILED:${baselineResult.code}:${baselineResult.detail ?? ""}`);
    }

    const candidateResult = await runOriginAnswerQualityOfficialQuotaChunk({
      chunkIndex: index,
      gitSha: candidate.sha,
      providerId: "openrouter-free",
      modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
      environmentProof: candidateEnvironment.value,
      sourceRoot: candidate.root,
      env: process.env,
    });
    if (!candidateResult.ok) {
      throw new Error(`AQ_QUOTA_CHUNK_CANDIDATE_FAILED:${candidateResult.code}:${candidateResult.detail ?? ""}`);
    }

    if (
      baselineResult.value.planDigest !== candidateResult.value.planDigest
      || baselineResult.value.scorerProvenanceDigest
        !== candidateResult.value.scorerProvenanceDigest
      || baselineResult.value.modelId !== candidateResult.value.modelId
      || baselineResult.value.providerId !== candidateResult.value.providerId
    ) {
      throw new Error("AQ_QUOTA_CHUNK_COMPARISON_IDENTITY_MISMATCH");
    }

    const outputPath = path.resolve(
      process.env.ORIGIN_AQ_OUTPUT_PATH?.trim()
        || `test-results/aq-quota-chunk-${index}.json`,
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify({
      schemaVersion: "origin.aq-quota-chunk-comparison.v1",
      chunkIndex: index,
      baseline: baselineResult.value,
      candidate: candidateResult.value,
    }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    process.stdout.write(
      `AQ quota chunk ${index} completed: baseline ${baselineResult.value.artifactDigest}, candidate ${candidateResult.value.artifactDigest}\n`,
    );
  } finally {
    await Promise.all([stop(candidateServer), stop(baselineServer)]);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "AQ_QUOTA_CHUNK_FAILED"}\n`);
  process.exitCode = 1;
});
