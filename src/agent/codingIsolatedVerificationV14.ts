import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CODING_CHECK_TIMEOUT_MS } from "./codingWorkerTimingV14.js";
import { copyTrustedCodingCheckoutV14 } from "./codingWorkerCheckoutV14.js";
import type { CodingCheck } from "./codingSessionV14.js";
import type { VerificationKind } from "./verificationRunner.js";

const IMAGE = "node:22-bookworm-slim";
const MAX_DIAGNOSTIC_BYTES = 32 * 1024;
const CHECK_COMMANDS: Readonly<Record<VerificationKind, string>> = Object.freeze({
  typecheck: "tsc --noEmit",
  lint: "mkdir -p test-results && (tsc --noEmit > test-results/lint.log 2>&1 || (cat test-results/lint.log && exit 1)) && node scripts/design-token-lock.js",
  test: "FREE_ONLY=false vitest run --configLoader runner --maxWorkers=2 --exclude 'tests/e2e/**' --exclude 'tests/api/**' --reporter=default",
  build: "vite build --configLoader runner && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
});
const CHECK_KINDS: readonly VerificationKind[] = ["typecheck", "lint", "test", "build"];

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, "utf8") >= MAX_DIAGNOSTIC_BYTES) return current;
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, "utf8") <= MAX_DIAGNOSTIC_BYTES) return next;
  return Buffer.from(next, "utf8").subarray(0, MAX_DIAGNOSTIC_BYTES).toString("utf8")
    + "\n[OUTPUT_TRUNCATED]";
}

export async function runIsolatedCodingCheckV14(
  sourceRoot: string,
  dependencyRoot: string,
  kind: VerificationKind,
): Promise<CodingCheck> {
  if (!Object.prototype.hasOwnProperty.call(CHECK_COMMANDS, kind)) {
    throw new Error("CODING_VERIFICATION_KIND_BLOCKED");
  }

  const verifyRoot = await fs.mkdtemp(path.join(os.tmpdir(), `origin-v14-check-${kind}-`));
  const name = `origin-v14-${kind}-${randomUUID().slice(0, 12)}`;
  const runtimeUser = `${typeof process.getuid === "function" ? process.getuid() : 1000}:${typeof process.getgid === "function" ? process.getgid() : 1000}`;

  try {
    await copyTrustedCodingCheckoutV14(sourceRoot, verifyRoot);
    const args = [
      "run", "--rm", "--name", name,
      "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--read-only", "--user", runtimeUser, "--pids-limit", "128", "--cpus", "2", "--memory", "3g",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m,mode=1777",
      "--mount", `type=bind,src=${verifyRoot},dst=/work`,
      "--mount", `type=bind,src=${path.join(dependencyRoot, "node_modules")},dst=/work/node_modules,readonly`,
      "--workdir", "/work",
      "--env", "HOME=/tmp", "--env", "CI=true", "--env", "NODE_ENV=test",
      "--env", "FREE_ONLY=false", "--env", "ORIGIN_ISOLATED_VERIFY=true",
      "--env", "PATH=/work/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      IMAGE, "/bin/sh", "-eu", "-c", CHECK_COMMANDS[kind],
    ];

    const child = spawn("docker", args, {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => { output = appendBounded(output, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { output = appendBounded(output, chunk); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      spawn("docker", ["rm", "-f", name], {
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        stdio: "ignore",
      }).unref();
    }, CODING_CHECK_TIMEOUT_MS);

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }).finally(() => clearTimeout(timer));

    return {
      kind,
      ok: !timedOut && exitCode === 0,
      exitCode,
      timedOut,
      diagnostic: output,
    };
  } finally {
    await fs.rm(verifyRoot, { recursive: true, force: true });
  }
}

export async function runIsolatedCodingVerificationV14(
  sourceRoot: string,
  dependencyRoot: string,
  checkpoint?: () => Promise<void>,
): Promise<CodingCheck[]> {
  const checks: CodingCheck[] = [];
  for (const kind of CHECK_KINDS) {
    if (checkpoint) await checkpoint();
    checks.push(await runIsolatedCodingCheckV14(sourceRoot, dependencyRoot, kind));
  }
  return checks;
}
