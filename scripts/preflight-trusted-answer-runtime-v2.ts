import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertTrustedCandidateVerificationBaselineV15,
} from "../src/release/OriginTrustedCandidateWorkspaceGuardV15.js";

const IMAGE = "node:22-bookworm-slim";
const RESULT_PREFIX = "ORIGIN_TRUSTED_ANSWER_RESULT ";
const MAX_CAPTURE_BYTES = 1024 * 1024;
const PROXY_STOP_TIMEOUT_MS = 15_000;
const CANDIDATE_TIMEOUT_MS = 90_000;
const PUBLIC_CALIBRATION_PROMPT =
  "Calibration request: reply with one short sentence confirming that you can answer this simple request. Do not use external facts, links, tools, or private information.";

type Child = ReturnType<typeof spawn>;
type Stage =
  | "configuration"
  | "candidate-workspace"
  | "provider-proxy"
  | "candidate-container"
  | "candidate-result";

interface SafeProviderFailureEvidence {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly upstreamStatus?: number;
  readonly upstreamErrorType?: string;
}

interface PreflightEvidence {
  readonly schemaVersion: "origin.trusted-answer-runtime-preflight.v2";
  readonly ok: boolean;
  readonly candidateSha: string;
  readonly promptKind: "public-calibration";
  readonly stage: Stage;
  readonly diagnostic: string;
  readonly providerRequests: number;
  readonly providerFailure?: SafeProviderFailureEvidence;
  readonly costUsd: 0;
  readonly networkBlocked: true;
  readonly providerCredentialWithheldFromCandidate: true;
  readonly sealedCorpusUsed: false;
  readonly reservationLedgerTouched: false;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_V2_PREFLIGHT_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, "utf8") >= MAX_CAPTURE_BYTES) return current;
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, "utf8") <= MAX_CAPTURE_BYTES) return next;
  return Buffer.from(next, "utf8").subarray(0, MAX_CAPTURE_BYTES).toString("utf8") + "\n[OUTPUT_TRUNCATED]";
}

function cleanHostEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    CI: "true",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
}

async function execFixed(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 120_000,
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  child.stdout.on("data", chunk => { output = appendBounded(output, chunk); });
  child.stderr.on("data", chunk => { output = appendBounded(output, chunk); });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    killTimer.unref();
  }, timeoutMs);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
  });
  return { code, output, timedOut };
}

async function waitForSocket(socketPath: string, child: Child): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error("TRUSTED_ANSWER_PROVIDER_PROXY_START_FAILED");
    try {
      const stat = await fs.stat(socketPath);
      if (stat.isSocket()) return;
    } catch {
      // bounded readiness wait
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("TRUSTED_ANSWER_PROVIDER_PROXY_START_TIMEOUT");
}

async function stopChild(child: Child): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      child.off("error", onError);
      error ? reject(error) : resolve();
    };
    const onClose = () => finish();
    const onError = () => finish(new Error("TRUSTED_ANSWER_PROVIDER_PROXY_STOP_FAILED"));
    const timer = setTimeout(
      () => finish(new Error("TRUSTED_ANSWER_PROVIDER_PROXY_STOP_TIMEOUT")),
      PROXY_STOP_TIMEOUT_MS,
    );
    child.once("close", onClose);
    child.once("error", onError);
    if (!child.kill("SIGTERM") && child.exitCode === null) {
      finish(new Error("TRUSTED_ANSWER_PROVIDER_PROXY_STOP_FAILED"));
    }
  });
}

async function assertRegularTree(root: string): Promise<void> {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw new Error("TRUSTED_ANSWER_CANDIDATE_SYMLINK_BLOCKED");
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1) {
        throw new Error("TRUSTED_ANSWER_CANDIDATE_SPECIAL_FILE_BLOCKED");
      }
    }
  }
}

async function sanitizedCandidateWorkspace(candidateCheckout: string, candidateSha: string, root: string): Promise<string> {
  const rev = await execFixed(
    "git",
    ["-C", candidateCheckout, "rev-parse", "HEAD"],
    candidateCheckout,
    cleanHostEnv(root),
    30_000,
  );
  if (rev.code !== 0 || rev.output.trim() !== candidateSha) {
    throw new Error("TRUSTED_ANSWER_CANDIDATE_SHA_MISMATCH");
  }

  const archive = path.join(root, "candidate.tar");
  const workspace = path.join(root, "candidate");
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  const archived = await execFixed(
    "git",
    ["-C", candidateCheckout, "archive", "--format=tar", "HEAD", "-o", archive],
    candidateCheckout,
    cleanHostEnv(root),
    60_000,
  );
  if (archived.code !== 0 || archived.timedOut) throw new Error("TRUSTED_ANSWER_CANDIDATE_ARCHIVE_FAILED");

  const extracted = await execFixed(
    "tar",
    ["-xf", archive, "-C", workspace, "--no-same-owner", "--no-same-permissions"],
    root,
    cleanHostEnv(root),
    60_000,
  );
  await fs.rm(archive, { force: true });
  if (extracted.code !== 0 || extracted.timedOut) throw new Error("TRUSTED_ANSWER_CANDIDATE_ARCHIVE_FAILED");

  await assertRegularTree(workspace);
  await assertTrustedCandidateVerificationBaselineV15(workspace);
  try {
    await fs.lstat(path.join(workspace, ".git"));
    throw new Error("TRUSTED_ANSWER_CANDIDATE_GIT_METADATA_EXPOSED");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return workspace;
}

function providerRequestCount(proxyOutput: string): number {
  let max = 0;
  for (const line of proxyOutput.split("\n")) {
    if (!line.includes("trusted-answer-provider-request")) continue;
    try {
      const row = JSON.parse(line);
      if (
        row?.event === "trusted-answer-provider-request"
        && Number.isInteger(row.requestCount)
        && row.requestCount >= 0
        && row.requestCount <= 1
      ) {
        max = Math.max(max, row.requestCount);
      }
    } catch {
      // ignore non-event output
    }
  }
  return max;
}

function safeProviderFailureEvidence(proxyOutput: string): SafeProviderFailureEvidence | undefined {
  let latest: SafeProviderFailureEvidence | undefined;
  for (const line of proxyOutput.split("\n")) {
    if (!line.includes("trusted-answer-provider-failure")) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (
        row.event !== "trusted-answer-provider-failure"
        || typeof row.code !== "string"
        || !/^PROVIDER_[A-Z0-9_:-]+$/.test(row.code)
        || !Number.isInteger(row.status)
        || Number(row.status) < 400
        || Number(row.status) > 599
      ) continue;

      const value: SafeProviderFailureEvidence = {
        code: row.code,
        status: Number(row.status),
      };
      if (Number.isInteger(row.retryAfterSeconds) && Number(row.retryAfterSeconds) >= 1 && Number(row.retryAfterSeconds) <= 86_400) {
        (value as { retryAfterSeconds?: number }).retryAfterSeconds = Number(row.retryAfterSeconds);
      }
      if (Number.isInteger(row.upstreamStatus) && Number(row.upstreamStatus) >= 400 && Number(row.upstreamStatus) <= 599) {
        (value as { upstreamStatus?: number }).upstreamStatus = Number(row.upstreamStatus);
      }
      if (typeof row.upstreamErrorType === "string" && /^(?:rate_limit_exceeded|timeout|provider_overloaded|provider_unavailable)$/.test(row.upstreamErrorType)) {
        (value as { upstreamErrorType?: string }).upstreamErrorType = row.upstreamErrorType;
      }
      latest = value;
    } catch {
      // ignore non-event output
    }
  }
  return latest;
}

function parseRunnerEnvelope(output: string, leaseId: string): Record<string, unknown> {
  const index = output.lastIndexOf(RESULT_PREFIX);
  if (index < 0) throw new Error("TRUSTED_ANSWER_RESULT_MISSING");
  const line = output.slice(index + RESULT_PREFIX.length).split("\n", 1)[0];
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("TRUSTED_ANSWER_RESULT_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TRUSTED_ANSWER_RESULT_INVALID");
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.schemaVersion !== "origin.trusted-answer-candidate-result.v2"
    || value.leaseId !== leaseId
    || value.httpStatus !== 200
    || typeof value.content !== "string"
    || value.content.trim().length === 0
    || value.content.length > 400_000
  ) {
    throw new Error("TRUSTED_ANSWER_RESULT_INVALID");
  }
  return value;
}

function classifyCandidateFailure(output: string, code: number | null, timedOut: boolean): string {
  if (timedOut) return "TRUSTED_ANSWER_CANDIDATE_TIMEOUT";
  const index = output.lastIndexOf(RESULT_PREFIX);
  if (index >= 0) {
    const line = output.slice(index + RESULT_PREFIX.length).split("\n", 1)[0];
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const error = value?.error;
      if (typeof error === "string" && /^(?:TRUSTED_ANSWER|PROVIDER|FREE_MODEL|FREE_PROVIDER|INVALID_EXECUTION)_[A-Z0-9_:-]+$/.test(error)) {
        return error;
      }
      const status = value?.httpStatus;
      if (Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599) {
        return `TRUSTED_ANSWER_CANDIDATE_HTTP_${status}`;
      }
      return "TRUSTED_ANSWER_CANDIDATE_RESULT_INVALID";
    } catch {
      return "TRUSTED_ANSWER_CANDIDATE_RESULT_INVALID";
    }
  }
  if (code === 125) return "TRUSTED_ANSWER_DOCKER_RUNTIME_FAILED";
  if (code === 126) return "TRUSTED_ANSWER_DOCKER_COMMAND_NOT_EXECUTABLE";
  if (code === 127) return "TRUSTED_ANSWER_DOCKER_COMMAND_NOT_FOUND";
  if (/ERR_MODULE_NOT_FOUND/.test(output) && /tsx/.test(output)) {
    return "TRUSTED_ANSWER_RUNNER_BOOTSTRAP_MODULE_MISSING";
  }
  if (/EACCES|permission denied/i.test(output) && /provider\.sock|trusted-socket/i.test(output)) {
    return "TRUSTED_ANSWER_PROVIDER_SOCKET_PERMISSION_DENIED";
  }
  return "TRUSTED_ANSWER_CANDIDATE_FAILED";
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^(?:AQ_V2_PREFLIGHT|AQ_V2|TRUSTED_ANSWER|PROVIDER|FREE_MODEL|FREE_PROVIDER|INVALID_EXECUTION)_[A-Z0-9_:-]+$/.test(message)
    ? message
    : "AQ_V2_PREFLIGHT_FATAL";
}

async function writeEvidence(outputPath: string, evidence: PreflightEvidence): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function main(): Promise<void> {
  const candidateSha = requiredEnv("ORIGIN_CANDIDATE_SHA").toLowerCase();
  const candidateCheckout = requiredEnv("ORIGIN_AQ_V2_CANDIDATE_CHECKOUT");
  const apiKey = requiredEnv("OPENROUTER_API_KEY");
  const outputPath = process.env.ORIGIN_AQ_V2_PREFLIGHT_RESULT_PATH
    ?? path.resolve("test-results", "trusted-answer-runtime-preflight-v2.json");
  if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error("AQ_V2_PREFLIGHT_CANDIDATE_SHA_INVALID");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "origin-aq-v2-preflight-"));
  const socketDir = path.join(root, "socket");
  const trustedDir = path.join(root, "trusted");
  await fs.mkdir(socketDir, { mode: 0o700 });
  await fs.mkdir(trustedDir, { mode: 0o700 });

  let stage: Stage = "configuration";
  let proxy: Child | undefined;
  let proxyOutput = "";
  let providerRequests = 0;
  try {
    stage = "candidate-workspace";
    const workspace = await sanitizedCandidateWorkspace(candidateCheckout, candidateSha, root);
    const runnerSource = path.resolve("scripts", "trusted-answer-candidate-runner-v2.ts");
    const runnerTarget = path.join(trustedDir, "trusted-answer-candidate-runner-v2.ts");
    await fs.copyFile(runnerSource, runnerTarget);
    await fs.chmod(runnerTarget, 0o444);

    stage = "provider-proxy";
    const token = randomBytes(32).toString("hex");
    const socketPath = path.join(socketDir, "provider.sock");
    proxy = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/trusted-answer-provider-proxy-v2.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...cleanHostEnv(root),
          OPENROUTER_API_KEY: apiKey,
          ORIGIN_TRUSTED_ANSWER_PROVIDER_SOCKET: socketPath,
          ORIGIN_TRUSTED_ANSWER_PROVIDER_TOKEN: token,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    proxy.stdout.on("data", chunk => { proxyOutput = appendBounded(proxyOutput, chunk); });
    proxy.stderr.on("data", chunk => { proxyOutput = appendBounded(proxyOutput, chunk); });
    await waitForSocket(socketPath, proxy);

    stage = "candidate-container";
    const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
    const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
    const containerName = `origin-aq-v2-preflight-${randomUUID().slice(0, 10)}`;
    const leaseId = randomBytes(16).toString("hex");
    const leaseB64 = Buffer.from(JSON.stringify({
      schemaVersion: "origin.answer-case-lease-candidate.v2",
      leaseId,
      prompt: PUBLIC_CALIBRATION_PROMPT,
    }), "utf8").toString("base64");
    const args = [
      "run", "--rm", "--name", containerName,
      "--network", "none",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--read-only",
      "--user", `${uid}:${gid}`,
      "--pids-limit", "128",
      "--cpus", "2",
      "--memory", "2g",
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777",
      "--mount", `type=bind,src=${workspace},dst=/work,readonly`,
      "--mount", `type=bind,src=${path.resolve("node_modules")},dst=/node_modules,readonly`,
      "--mount", `type=bind,src=${trustedDir},dst=/trusted,readonly`,
      "--mount", `type=bind,src=${socketDir},dst=/trusted-socket,readonly`,
      "--workdir", "/work",
      "--env", "HOME=/tmp",
      "--env", "CI=true",
      "--env", "NODE_ENV=test",
      "--env", "ORIGIN_CANDIDATE_ROOT=/work",
      "--env", `ORIGIN_AQ_V2_CASE_LEASE_B64=${leaseB64}`,
      "--env", "ORIGIN_TRUSTED_ANSWER_PROVIDER_SOCKET=/trusted-socket/provider.sock",
      "--env", `ORIGIN_TRUSTED_ANSWER_PROVIDER_TOKEN=${token}`,
      IMAGE,
      "node", "--import", "tsx", "/trusted/trusted-answer-candidate-runner-v2.ts",
    ];

    const candidate = await execFixed(
      "docker",
      args,
      process.cwd(),
      cleanHostEnv(root),
      CANDIDATE_TIMEOUT_MS,
    );
    if (candidate.timedOut) {
      await execFixed("docker", ["rm", "-f", containerName], process.cwd(), cleanHostEnv(root), 15_000).catch(() => undefined);
    }

    await stopChild(proxy);
    proxy = undefined;
    providerRequests = providerRequestCount(proxyOutput);

    if (candidate.code !== 0 || candidate.timedOut) {
      throw new Error(classifyCandidateFailure(candidate.output, candidate.code, candidate.timedOut));
    }

    stage = "candidate-result";
    const envelope = parseRunnerEnvelope(candidate.output, leaseId);
    const routing = envelope.routing && typeof envelope.routing === "object"
      ? envelope.routing as Record<string, unknown>
      : {};
    if (providerRequests !== 1) throw new Error("AQ_V2_PREFLIGHT_PROVIDER_REQUEST_COUNT_INVALID");
    if (routing.freeOnly !== true || routing.actualCostUsd !== 0) {
      throw new Error("AQ_V2_PREFLIGHT_ZERO_COST_EVIDENCE_INVALID");
    }

    await writeEvidence(outputPath, {
      schemaVersion: "origin.trusted-answer-runtime-preflight.v2",
      ok: true,
      candidateSha,
      promptKind: "public-calibration",
      stage,
      diagnostic: "AQ_V2_PREFLIGHT_PASS",
      providerRequests,
      costUsd: 0,
      networkBlocked: true,
      providerCredentialWithheldFromCandidate: true,
      sealedCorpusUsed: false,
      reservationLedgerTouched: false,
    });
    process.stdout.write(JSON.stringify({
      event: "trusted-answer-runtime-preflight-complete",
      candidateSha,
      providerRequests,
      costUsd: 0,
    }) + "\n");
  } catch (error) {
    const diagnostic = safeErrorCode(error);
    providerRequests = Math.max(providerRequests, providerRequestCount(proxyOutput));
    const providerFailure = safeProviderFailureEvidence(proxyOutput);
    await writeEvidence(outputPath, {
      schemaVersion: "origin.trusted-answer-runtime-preflight.v2",
      ok: false,
      candidateSha,
      promptKind: "public-calibration",
      stage,
      diagnostic,
      providerRequests,
      ...(providerFailure ? { providerFailure } : {}),
      costUsd: 0,
      networkBlocked: true,
      providerCredentialWithheldFromCandidate: true,
      sealedCorpusUsed: false,
      reservationLedgerTouched: false,
    }).catch(() => undefined);
    throw error;
  } finally {
    if (proxy) await stopChild(proxy).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(safeErrorCode(error) + "\n");
  process.exitCode = 1;
});
