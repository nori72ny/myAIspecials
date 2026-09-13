import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODING_JOB_ID_PATTERN } from '../src/agent/codingJobCryptoV14.js';
import { buildCodingJobResultV14 } from '../src/agent/codingJobResultV14.js';
import { createCodingJobResultStoreFromEnvV14 } from '../src/agent/codingJobResultStoreV14.js';
import { runCodingJobWorkerV14, type CodingJobResolvedTargetV14, type CodingJobWorkerCheckpointV14 } from '../src/agent/codingJobWorkerV14.js';
import { createCodingJobStoreFromEnvV14 } from '../src/agent/supabaseCodingJobStoreV14.js';
import type { CodingCheck } from '../src/agent/codingSessionV14.js';
import type { VerificationKind } from '../src/agent/verificationRunner.js';
import { executeOriginProvider, type OriginProviderExecutionRequest, type OriginProviderExecutionResult } from '../src/legacy/originProviderClient.js';

const IMAGE = 'node:22-bookworm-slim';
// The container is limited to two CPUs, so Vitest must use the same bounded
// worker count instead of sizing its pool from the larger host runner. Keep the
// durable lease longer than any single check so a slow-but-bounded verification
// cannot be misclassified as lease loss.
const CHECK_TIMEOUT_MS = 180_000;
const WORKER_LEASE_SECONDS = 240;
const MAX_DIAGNOSTIC_BYTES = 32 * 1024;
const TARGET_KEY = 'origin:self';
const EXCLUDED_ROOT_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'test-results']);
const CHECK_COMMANDS: Record<VerificationKind, string> = {
  typecheck: 'tsc --noEmit',
  lint: 'mkdir -p test-results && (tsc --noEmit > test-results/lint.log 2>&1 || (cat test-results/lint.log && exit 1)) && node scripts/design-token-lock.js',
  test: "FREE_ONLY=false vitest run --configLoader runner --maxWorkers=2 --exclude 'tests/e2e/**' --exclude 'tests/api/**' --reporter=default",
  build: 'vite build --configLoader runner && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs',
};

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, 'utf8') >= MAX_DIAGNOSTIC_BYTES) return current;
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') <= MAX_DIAGNOSTIC_BYTES) return next;
  return Buffer.from(next, 'utf8').subarray(0, MAX_DIAGNOSTIC_BYTES).toString('utf8') + '\n[OUTPUT_TRUNCATED]';
}

async function executeWithSafeProviderDiagnostics(
  request: OriginProviderExecutionRequest,
  env: NodeJS.ProcessEnv,
): Promise<OriginProviderExecutionResult> {
  try {
    return await executeOriginProvider(request, env);
  } catch (error) {
    const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
    if (code === 'PROVIDER_REQUIRED_TOOL_TRUNCATED') {
      const candidate = request.requiredTool?.name;
      const requiredTool = typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(candidate) ? candidate : 'unknown';
      // This event deliberately excludes prompts, repository content, tool arguments,
      // credentials, and provider response bodies. Tool names are static code-owned IDs.
      console.warn(JSON.stringify({ event: 'coding-provider-required-tool-truncated', requiredTool, code }));
    }
    throw error;
  }
}

async function copyTrustedCheckout(source: string, destination: string): Promise<void> {
  await fs.cp(source, destination, {
    recursive: true,
    dereference: false,
    filter: (candidate) => {
      const relative = path.relative(source, candidate);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return !EXCLUDED_ROOT_NAMES.has(first) && !/^\.env(?:\.|$)/i.test(first);
    },
  });
}

async function dockerCheck(sourceRoot: string, dependencyRoot: string, kind: VerificationKind): Promise<CodingCheck> {
  const verifyRoot = await fs.mkdtemp(path.join(os.tmpdir(), `origin-v14-check-${kind}-`));
  const name = `origin-v14-${kind}-${randomUUID().slice(0, 12)}`;
  const runtimeUser = `${typeof process.getuid === 'function' ? process.getuid() : 1000}:${typeof process.getgid === 'function' ? process.getgid() : 1000}`;
  try {
    await copyTrustedCheckout(sourceRoot, verifyRoot);
    const args = [
      'run', '--rm', '--name', name,
      '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--read-only', '--user', runtimeUser, '--pids-limit', '128', '--cpus', '2', '--memory', '3g',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
      '--mount', `type=bind,src=${verifyRoot},dst=/work`,
      '--mount', `type=bind,src=${path.join(dependencyRoot, 'node_modules')},dst=/work/node_modules,readonly`,
      '--workdir', '/work',
      '--env', 'HOME=/tmp', '--env', 'CI=true', '--env', 'NODE_ENV=test', '--env', 'FREE_ONLY=false',
      '--env', 'ORIGIN_ISOLATED_VERIFY=true',
      '--env', 'PATH=/work/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      IMAGE, '/bin/sh', '-eu', '-c', CHECK_COMMANDS[kind],
    ];
    const child = spawn('docker', args, { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => { output = appendBounded(output, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { output = appendBounded(output, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      spawn('docker', ['rm', '-f', name], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: 'ignore' }).unref();
    }, CHECK_TIMEOUT_MS);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).finally(() => clearTimeout(timer));
    return { kind, ok: !timedOut && exitCode === 0, exitCode, timedOut, diagnostic: output };
  } finally {
    await fs.rm(verifyRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const jobId = process.env.ORIGIN_CODING_JOB_ID ?? '';
  if (!CODING_JOB_ID_PATTERN.test(jobId)) throw new Error('CODING_WORKER_JOB_ID_INVALID');
  const checkout = await fs.realpath(process.cwd());
  const store = createCodingJobStoreFromEnvV14(process.env);
  if (!store) throw new Error('CODING_WORKER_STORE_NOT_CONFIGURED');
  const resultStore = createCodingJobResultStoreFromEnvV14(process.env);
  if (!resultStore) throw new Error('CODING_WORKER_RESULT_STORE_NOT_CONFIGURED');
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `origin-v14-${jobId}-`));
  const workerId = `gha-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  try {
    await copyTrustedCheckout(checkout, workspace);
    const resolveTarget = async (targetKey: string): Promise<CodingJobResolvedTargetV14> => {
      if (targetKey !== TARGET_KEY) throw new Error('CODING_WORKER_TARGET_BLOCKED');
      return { root: workspace, trustedWorkspaceApproved: true };
    };
    const verify = async (root: string, checkpoint?: CodingJobWorkerCheckpointV14): Promise<CodingCheck[]> => {
      const realRoot = await fs.realpath(root);
      if (realRoot !== await fs.realpath(workspace)) throw new Error('CODING_WORKER_ROOT_BLOCKED');
      const kinds: VerificationKind[] = ['typecheck', 'lint', 'test', 'build'];
      const checks: CodingCheck[] = [];
      for (const kind of kinds) {
        if (checkpoint) await checkpoint();
        const check = await dockerCheck(realRoot, checkout, kind);
        checks.push(check);
        if (!check.ok || check.exitCode !== 0 || check.timedOut) {
          // Only code-owned check metadata is emitted. Repository output and
          // diagnostics can contain private source or secrets and stay inside
          // the encrypted result/repair path.
          console.warn(JSON.stringify({
            event: 'coding-verification-check-failed',
            kind: check.kind,
            exitCode: check.exitCode,
            timedOut: check.timedOut,
          }));
        }
      }
      return checks;
    };
    const outcome = await runCodingJobWorkerV14(jobId, workerId, {
      store,
      resultStore,
      resolveTarget,
      verify,
      captureResult: (session, root) => buildCodingJobResultV14(session, checkout, root),
      env: process.env,
      execute: executeWithSafeProviderDiagnostics,
      leaseSeconds: WORKER_LEASE_SECONDS,
    });
    console.log(JSON.stringify({ jobId: outcome.jobId, state: outcome.state, code: outcome.code }));
    if (outcome.state === 'retryable' || outcome.state === 'lease_lost') process.exitCode = 2;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^CODING_[A-Z0-9_]+$/.test(error.message) ? error.message : 'CODING_WORKER_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
