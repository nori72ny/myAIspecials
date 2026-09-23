import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseOriginAnswerExperienceSealedCorpusGzipBase64V2,
} from "../src/release/OriginAnswerExperienceSealedCorpusV2.js";
import {
  assertOriginAnswerCaseLeaseIsolationV2,
  buildOriginAnswerCaseResultTrustedV2,
  leaseOriginAnswerExperienceCaseV2,
} from "../src/release/OriginAnswerTrustedCaseLeaseV2.js";
import {
  assertTrustedCandidateVerificationBaselineV15,
} from "../src/release/OriginTrustedCandidateWorkspaceGuardV15.js";
import type {
  OriginTrustedAnswerCaseEvidenceV2,
} from "../src/release/OriginTrustedAnswerRunV2.js";

const IMAGE = "node:22-bookworm-slim";
const RESULT_PREFIX = "ORIGIN_TRUSTED_ANSWER_RESULT ";
const MAX_CAPTURE_BYTES = 1024 * 1024;
const PROXY_STOP_TIMEOUT_MS = 15_000;
const CANDIDATE_TIMEOUT_MS = 90_000;

type Child = ReturnType<typeof spawn>;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`AQ_V2_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function parseOrdinal(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("AQ_V2_CASE_ORDINAL_INVALID");
  const ordinal = Number(value);
  if (!Number.isSafeInteger(ordinal)) throw new Error("AQ_V2_CASE_ORDINAL_INVALID");
  return ordinal;
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
      // keep waiting
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

function parseTrustedRunnerEnvelope(output: string, leaseId: string) {
  const index = output.lastIndexOf(RESULT_PREFIX);
  if (index < 0) throw new Error("TRUSTED_ANSWER_RESULT_MISSING");
  const tail = output.slice(index + RESULT_PREFIX.length);
  const line = tail.split("\n", 1)[0];
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
      // ignore non-event lines
    }
  }
  return max;
}

function assertNoLeak(input: {
  candidateOutput: string;
  token: string;
  apiKey: string;
  candidateSha: string;
  roundId: string;
  corpusDigest: string;
  currentPrompt: string;
  allPrompts: readonly string[];
  allNotes: readonly string[];
}): void {
  const haystack = input.candidateOutput;
  const forbidden = [
    input.token,
    input.apiKey,
    input.candidateSha,
    input.roundId,
    input.corpusDigest,
    ...input.allNotes,
    ...input.allPrompts.filter(prompt => prompt !== input.currentPrompt),
  ].filter(value => typeof value === "string" && value.length >= 12);
  if (forbidden.some(value => haystack.includes(value))) {
    throw new Error("TRUSTED_ANSWER_CANDIDATE_LEAK_DETECTED");
  }
}

async function main(): Promise<void> {
  const encodedCorpus = requiredEnv("ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64");
  const candidateSha = requiredEnv("ORIGIN_CANDIDATE_SHA").toLowerCase();
  const candidateCheckout = requiredEnv("ORIGIN_AQ_V2_CANDIDATE_CHECKOUT");
  const roundId = requiredEnv("ORIGIN_AQ_V2_ROUND_ID");
  const ordinal = parseOrdinal(requiredEnv("ORIGIN_AQ_V2_CASE_ORDINAL"));
  const apiKey = requiredEnv("OPENROUTER_API_KEY");
  const outputPath = process.env.ORIGIN_AQ_V2_CASE_RESULT_PATH
    ?? path.resolve("test-results", `trusted-answer-case-${ordinal}.json`);

  if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error("AQ_V2_CANDIDATE_SHA_INVALID");

  const prepared = parseOriginAnswerExperienceSealedCorpusGzipBase64V2(encodedCorpus);
  const leased = leaseOriginAnswerExperienceCaseV2(prepared, { candidateSha, roundId, ordinal });
  assertOriginAnswerCaseLeaseIsolationV2({
    ...leased,
    fullCorpusSerialized: JSON.stringify(prepared.privateCorpus),
  });

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "origin-aq-v2-trusted-"));
  const socketDir = path.join(root, "socket");
  const trustedDir = path.join(root, "trusted");
  await fs.mkdir(socketDir, { mode: 0o700 });
  await fs.mkdir(trustedDir, { mode: 0o700 });

  let proxy: Child | undefined;
  let proxyOutput = "";
  try {
    const workspace = await sanitizedCandidateWorkspace(candidateCheckout, candidateSha, root);
    const runnerSource = path.resolve("scripts", "trusted-answer-candidate-runner-v2.ts");
    const runnerTarget = path.join(trustedDir, "trusted-answer-candidate-runner-v2.ts");
    await fs.copyFile(runnerSource, runnerTarget);
    await fs.chmod(runnerTarget, 0o444);

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

    const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
    const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
    const containerName = `origin-aq-v2-${ordinal}-${randomUUID().slice(0, 10)}`;
    const leaseB64 = Buffer.from(JSON.stringify(leased.candidateLease), "utf8").toString("base64");
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
      "--mount", `type=bind,src=${path.resolve("node_modules")},dst=/work/node_modules,readonly`,
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
      throw new Error("TRUSTED_ANSWER_CANDIDATE_TIMEOUT");
    }

    await stopChild(proxy);
    proxy = undefined;

    assertNoLeak({
      candidateOutput: candidate.output,
      token,
      apiKey,
      candidateSha,
      roundId,
      corpusDigest: prepared.corpusDigest,
      currentPrompt: leased.candidateLease.prompt,
      allPrompts: prepared.privateCorpus.cases.map(row => row.prompt),
      allNotes: prepared.privateCorpus.cases.map(row => row.evaluatorNotes),
    });

    if (candidate.code !== 0) throw new Error("TRUSTED_ANSWER_CANDIDATE_FAILED");
    const envelope = parseTrustedRunnerEnvelope(candidate.output, leased.candidateLease.leaseId);
    const count = providerRequestCount(proxyOutput);
    const result = buildOriginAnswerCaseResultTrustedV2({
      candidateLease: leased.candidateLease,
      trustedLease: leased.trustedLease,
      answer: String(envelope.content),
      providerRequests: count,
      costUsd: 0,
    });

    const evidence: OriginTrustedAnswerCaseEvidenceV2 = {
      schemaVersion: "origin.trusted-answer-case-evidence.v2",
      candidateSha,
      corpusDigest: prepared.corpusDigest,
      roundId,
      ordinal,
      caseId: leased.trustedLease.caseId,
      family: leased.trustedLease.family,
      promptDigest: leased.trustedLease.promptDigest,
      leaseId: leased.trustedLease.leaseId,
      providerRequests: count,
      costUsd: 0,
      networkBlocked: true,
      fullCorpusWithheldFromCandidate: true,
      providerCredentialWithheldFromCandidate: true,
      gitMetadataWithheldFromCandidate: true,
      trustedProxyEnforced: true,
      leakDetected: false,
      result,
    };

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    process.stdout.write(JSON.stringify({
      event: "trusted-answer-case-complete",
      ordinal,
      caseId: leased.trustedLease.caseId,
      family: leased.trustedLease.family,
      providerRequests: count,
      costUsd: 0,
    }) + "\n");
  } finally {
    if (proxy) await stopChild(proxy).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const code = /^(?:AQ_V2|TRUSTED_ANSWER)_[A-Z0-9_:-]+$/.test(message)
    ? message
    : "TRUSTED_ANSWER_CASE_FATAL";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
