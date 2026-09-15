import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodingAgentV14 } from '../src/agent/codingAgentV14.js';
import { createBoundedCodingProviderExecuteV14 } from '../src/agent/codingProviderRetryV14.js';
import { runVerification, type VerificationKind } from '../src/agent/verificationRunner.js';
import { buildOriginExecutionPlan } from '../src/lib/orchestration/OriginExecutionPolicy.js';
import { executeOriginProvider } from '../src/legacy/originProviderClient.js';
import {
  runTrustedHeldOutCodingBenchmarkV14,
  type HeldOutPrivateTaskPacketV14,
} from '../src/agent/heldOutCodingTrustedRunnerV14.js';

const CHECKS: VerificationKind[] = ['typecheck', 'lint', 'test', 'build'];
const MAX_HIDDEN_OUTPUT = 32 * 1024;

function appendBounded(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next) <= MAX_HIDDEN_OUTPUT) return next;
  return Buffer.from(next).subarray(0, MAX_HIDDEN_OUTPUT).toString('utf8') + '\n[OUTPUT_TRUNCATED]';
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

async function main(): Promise<void> {
  const encoded = process.env.ORIGIN_HELDOUT_TASK_PACKET_B64 ?? '';
  const dispatchedTaskId = process.env.ORIGIN_HELDOUT_TASK_ID ?? '';
  if (!encoded || !/^[A-Za-z0-9._-]{1,120}$/.test(dispatchedTaskId)) throw new Error('HELD_OUT_HOSTED_INPUT_INVALID');
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
    await fs.symlink(path.join(controllerRoot, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');

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
          verify: async root => Promise.all(CHECKS.map(async kind => {
            const row = await runVerification(root, kind);
            return { kind: row.kind, ok: row.ok, exitCode: row.exitCode, timedOut: row.timedOut, diagnostic: `${row.stdout}\n${row.stderr}`.slice(0, 4096) };
          })),
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
        const envPath = [path.join(controllerRoot, 'node_modules', '.bin'), process.env.PATH ?? ''].filter(Boolean).join(path.delimiter);
        const child = spawn(path.join(controllerRoot, 'node_modules', '.bin', 'vitest'), ['run', '--configLoader', 'runner', '--maxWorkers=2', 'tests/__origin_heldout__', '--reporter=default'], {
          cwd: workspace,
          env: { PATH: envPath, HOME: os.tmpdir(), TMPDIR: os.tmpdir(), CI: '1', NODE_ENV: 'test', FREE_ONLY: 'false', npm_config_ignore_scripts: 'true' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => { output = appendBounded(output, chunk); });
        child.stderr.on('data', (chunk: Buffer) => { output = appendBounded(output, chunk); });
        const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
        if (code !== 0) console.warn(JSON.stringify({ event: 'held-out-hidden-tests-failed', taskId: dispatchedTaskId, exitCode: code }));
        return { ok: code === 0 };
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
