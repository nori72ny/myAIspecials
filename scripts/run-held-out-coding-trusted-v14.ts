import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodingAgentV14 } from '../src/agent/codingAgentV14.js';
import { createBoundedCodingProviderExecuteV14 } from '../src/agent/codingProviderRetryV14.js';
import { CODING_CHECK_TIMEOUT_MS } from '../src/agent/codingWorkerTimingV14.js';
import type { CodingCheck } from '../src/agent/codingSessionV14.js';
import type { VerificationKind } from '../src/agent/verificationRunner.js';
import { buildOriginExecutionPlan } from '../src/lib/orchestration/OriginExecutionPolicy.js';
import { executeOriginProvider } from '../src/legacy/originProviderClient.js';
import {
  runTrustedHeldOutCodingBenchmarkV14,
  type HeldOutPrivateTaskPacketV14,
} from '../src/agent/heldOutCodingTrustedRunnerV14.js';

const IMAGE = 'node:22-bookworm-slim';
const CHECKS: VerificationKind[] = ['typecheck', 'lint', 'test', 'build'];
const MAX_OUTPUT_BYTES = 32 * 1024;
const CHECK_COMMANDS: Record<VerificationKind, string> = {
  typecheck: 'tsc --noEmit',
  lint: 'mkdir -p test-results && (tsc --noEmit > test-results/lint.log 2>&1 || (cat test-results/lint.log && exit 1)) && node scripts/design-token-lock.js',
  test: "FREE_ONLY=false vitest run --configLoader runner --maxWorkers=2 --exclude 'tests/e2e/**' --exclude 'tests/api/**' --reporter=default",
  build: 'vite build --configLoader runner && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs',
};
const HIDDEN_TEST_COMMAND = "vitest run --configLoader runner --maxWorkers=2 tests/__origin_heldout__ --reporter=default";
const COPY_EXCLUDED_ROOTS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'test-results']);

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, 'utf8') >= MAX_OUTPUT_BYTES) return current;
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') <= MAX_OUTPUT_BYTES) return next;
  return Buffer.from(next, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + '\n[OUTPUT_TRUNCATED]';
}

async function execFixed(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin' }): Promise<{ code: number | null; output: string }> {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output = appendBounded(output, chunk); });
  child.stderr.on('data', (chunk: Buffer) => { output = appendBounded(output, chunk); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  return { code, output };
}

async function fileDigest(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function copyVerificationTree(source: string, destination: string): Promise<void> {
  await fs.cp(source, destination, {
    recursive: true,
    dereference: false,
    filter: candidate => {
      const relative = path.relative(source, candidate);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return !COPY_EXCLUDED_ROOTS.has(first) && !/^\.env(?:\.|$)/i.test(first);
    },
  });
}

async function dockerCommand(sourceRoot: string, dependencyRoot: string, command: string, label: string): Promise<{ ok: boolean; exitCode: number | null; timedOut: boolean; output: string }> {
  const verifyRoot = await fs.mkdtemp(path.join(os.tmpdir(), `origin-heldout-${label}-`));
  const name = `origin-heldout-${label}-${randomUUID().slice(0, 12)}`;
  const runtimeUser = `${typeof process.getuid === 'function' ? process.getuid() : 1000}:${typeof process.getgid === 'function' ? process.getgid() : 1000}`;
  try {
    await copyVerificationTree(sourceRoot, verifyRoot);
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
      IMAGE, '/bin/sh', '-eu', '-c', command,
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
    }, CODING_CHECK_TIMEOUT_MS);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).finally(() => clearTimeout(timer));
    return { ok: !timedOut && exitCode === 0, exitCode, timedOut, output };
  } finally {
    await fs.rm(verifyRoot, { recursive: true, force: true });
  }
}

async function isolatedCheck(sourceRoot: string, dependencyRoot: string, kind: VerificationKind): Promise<CodingCheck> {
  const row = await dockerCommand(sourceRoot, dependencyRoot, CHECK_COMMANDS[kind], kind);
  return { kind, ok: row.ok, exitCode: row.exitCode, timedOut: row.timedOut, diagnostic: row.output };
}

async function main(): Promise<void> {
  const encoded = process.env.ORIGIN_HELDOUT_TASK_PACKET_B64 ?? '';
  const dispatchedTaskId = process.env.ORIGIN_HELDOUT_TASK_ID ?? '';
  if (!encoded || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(dispatchedTaskId)) throw new Error('HELD_OUT_HOSTED_INPUT_INVALID');
  let packet: HeldOutPrivateTaskPacketV14;
  try { packet = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as HeldOutPrivateTaskPacketV14; }
  catch { throw new Error('HELD_OUT_HOSTED_PACKET_INVALID'); }
  if (packet.id !== dispatchedTaskId) throw new Error('HELD_OUT_HOSTED_TASK_ID_MISMATCH');

  const controllerRoot = await fs.realpath(process.cwd());
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-heldout-worktree-'));
  const hiddenDir = path.join(workspace, 'tests', '__origin_heldout__');
  let worktreeAdded = false;
  try {
    const add = await execFixed('git', ['worktree', 'add', '--detach', workspace, packet.baseSha], controllerRoot);
    if (add.code !== 0) throw new Error('HELD_OUT_BASE_SHA_UNAVAILABLE');
    worktreeAdded = true;
    const resolved = await execFixed('git', ['rev-parse', 'HEAD'], workspace);
    if (resolved.code !== 0 || resolved.output.trim() !== packet.baseSha) throw new Error('HELD_OUT_BASE_SHA_MISMATCH');

    const controllerLock = path.join(controllerRoot, 'package-lock.json');
    const taskLock = path.join(workspace, 'package-lock.json');
    if (await fileDigest(controllerLock) !== await fileDigest(taskLock)) throw new Error('HELD_OUT_DEPENDENCY_SNAPSHOT_MISMATCH');

    const selected = buildOriginExecutionPlan(
      { goal: packet.goal, taskType: 'implementation', requiresCodeChanges: true },
      { openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY) },
    );
    if (selected.ok === false) throw new Error(selected.code);
    const execute = createBoundedCodingProviderExecuteV14(executeOriginProvider, () => {});

    const result = await runTrustedHeldOutCodingBenchmarkV14(packet, process.env.ORIGIN_HELDOUT_PARTICIPANT ?? 'ORIGIN', {
      assertBaseSha: async sha => { if (sha !== packet.baseSha) throw new Error('HELD_OUT_BASE_SHA_MISMATCH'); },
      runAgent: async privatePacket => {
        const startedAt = Date.now();
        const session = await runCodingAgentV14({
          goal: privatePacket.goal,
          root: workspace,
          trustedWorkspaceApproved: true,
          maxRepairs: 3,
        }, {
          verify: async root => {
            const rows: CodingCheck[] = [];
            for (const kind of CHECKS) rows.push(await isolatedCheck(root, controllerRoot, kind));
            return rows;
          },
          plannerOptions: { env: process.env, execute },
        });
        return {
          session,
          provider: selected.plan.providerId,
          model: selected.plan.modelId,
          costUsd: 0,
          durationMs: Date.now() - startedAt,
        };
      },
      runHiddenTests: async privatePacket => {
        await fs.mkdir(hiddenDir, { recursive: true });
        for (const test of privatePacket.hiddenTests) {
          const target = path.join(hiddenDir, test.path);
          const relative = path.relative(hiddenDir, target);
          if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('HELD_OUT_HIDDEN_PATH_BLOCKED');
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, test.content, { flag: 'wx' });
        }
        const hidden = await dockerCommand(workspace, controllerRoot, HIDDEN_TEST_COMMAND, 'hidden');
        if (!hidden.ok) console.warn(JSON.stringify({ event: 'held-out-hidden-tests-failed', taskId: dispatchedTaskId, exitCode: hidden.exitCode, timedOut: hidden.timedOut }));
        return { ok: hidden.ok };
      },
    });

    await fs.mkdir(path.join(controllerRoot, 'test-results'), { recursive: true });
    await fs.writeFile(path.join(controllerRoot, 'test-results', 'held-out-task-public.json'), JSON.stringify(result.task, null, 2));
    await fs.writeFile(path.join(controllerRoot, 'test-results', 'held-out-run.json'), JSON.stringify(result.run, null, 2));
    await fs.writeFile(path.join(controllerRoot, 'test-results', 'held-out-score.json'), JSON.stringify(result.score, null, 2));
    console.log(JSON.stringify({ taskId: result.task.id, solved: result.score.solved, provider: result.run.provider, model: result.run.model, durationMs: result.run.durationMs, costUsd: result.run.costUsd }));
  } finally {
    if (worktreeAdded) await execFixed('git', ['worktree', 'remove', '--force', workspace], controllerRoot).catch(() => undefined);
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : 'HELD_OUT_HOSTED_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
