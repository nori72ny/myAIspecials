import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildHeldOutCodingRunFromSessionV14,
} from '../src/agent/heldOutCodingTrustedRunnerV14.js';
import {
  publicHeldOutTaskFromPrivatePacketV14,
  type HeldOutPrivateTaskPacketV14,
} from '../src/agent/heldOutCodingTrustedRunnerV14.js';
import { scoreHeldOutCodingRunV14 } from '../src/agent/heldOutCodingBenchmarkV14.js';
import {
  parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15,
} from '../src/release/OriginHeldOutCandidateBindingV15.js';
import { ORIGIN_OPENROUTER_FREE_MODEL } from '../src/lib/orchestration/OriginExecutionPolicy.js';
import {
  assertTrustedCandidateDiffScopeV15,
  assertTrustedCandidatePathNoSymlinksV15,
  writeTrustedCandidateHiddenTestV15,
} from '../src/release/OriginTrustedCandidateWorkspaceGuardV15.js';

const IMAGE = 'node:22-bookworm-slim';
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 180_000;
const PROXY_STOP_TIMEOUT_MS = 15_000;
const CHECKS = ['typecheck', 'lint', 'test', 'build'] as const;
type CheckKind = (typeof CHECKS)[number];
const CHECK_COMMANDS: Record<CheckKind, string> = {
  typecheck: 'tsc --noEmit',
  lint: 'tsc --noEmit && node scripts/design-token-lock.js',
  test: "FREE_ONLY=false vitest run --configLoader runner --maxWorkers=2 --exclude 'tests/e2e/**' --exclude 'tests/api/**' --reporter=default",
  build: 'rm -rf /tmp/origin-dist && vite build --configLoader runner --outDir /tmp/origin-dist && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=/tmp/origin-dist/server.cjs',
};
const HIDDEN_TEST_COMMAND = "vitest run --configLoader runner --maxWorkers=2 tests/__origin_heldout__ --reporter=default";

type Child = ReturnType<typeof spawn>;
type GitFileSnapshot = { content: string; mode: number; size: number };

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, 'utf8') >= MAX_OUTPUT_BYTES) return current;
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') <= MAX_OUTPUT_BYTES) return next;
  return Buffer.from(next, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + '\n[OUTPUT_TRUNCATED]';
}

async function execFixed(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 600_000,
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  child.stdout.on('data', chunk => { output = appendBounded(output, chunk); });
  child.stderr.on('data', chunk => { output = appendBounded(output, chunk); });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    killTimer.unref();
  }, timeoutMs);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  }).finally(() => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
  });
  return { code, output, timedOut };
}

function cleanHostEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    CI: 'true',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
}

async function waitForSocket(socketPath: string, child: Child, code: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${code}_START_FAILED`);
    try {
      const stat = await fs.stat(socketPath);
      if (stat.isSocket()) return;
    } catch { /* keep waiting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${code}_START_TIMEOUT`);
}

async function stopChild(child: Child, code: string): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => finish();
    const onError = () => finish(new Error(`${code}_STOP_FAILED`));
    const timer = setTimeout(() => finish(new Error(`${code}_STOP_TIMEOUT`)), PROXY_STOP_TIMEOUT_MS);
    child.once('close', onClose);
    child.once('error', onError);
    if (!child.kill('SIGTERM') && child.exitCode === null) finish(new Error(`${code}_STOP_FAILED`));
  });
}

async function snapshotGitFile(workspace: string): Promise<GitFileSnapshot> {
  const gitFile = path.join(workspace, '.git');
  const stat = await fs.lstat(gitFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('TRUSTED_CANDIDATE_GIT_METADATA_INVALID');
  const content = await fs.readFile(gitFile, 'utf8');
  if (!/^gitdir: .+\n?$/.test(content)) throw new Error('TRUSTED_CANDIDATE_GIT_METADATA_INVALID');
  return { content, mode: stat.mode & 0o777, size: stat.size };
}

async function assertGitFileUnchanged(workspace: string, expected: GitFileSnapshot): Promise<void> {
  const gitFile = path.join(workspace, '.git');
  let stat;
  try { stat = await fs.lstat(gitFile); }
  catch { throw new Error('TRUSTED_CANDIDATE_GIT_METADATA_TAMPERED'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('TRUSTED_CANDIDATE_GIT_METADATA_TAMPERED');
  const content = await fs.readFile(gitFile, 'utf8');
  if (content !== expected.content || stat.size !== expected.size || (stat.mode & 0o777) !== expected.mode) {
    throw new Error('TRUSTED_CANDIDATE_GIT_METADATA_TAMPERED');
  }
}

async function dockerCheck(
  workspace: string,
  dependencyRoot: string,
  command: string,
  label: string,
): Promise<{ ok: boolean; exitCode: number | null; timedOut: boolean }> {
  const name = `origin-trusted-verify-${label}-${randomUUID().slice(0, 10)}`;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  const args = [
    'run', '--rm', '--name', name,
    '--network', 'none',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--user', `${uid}:${gid}`,
    '--pids-limit', '128',
    '--cpus', '2',
    '--memory', '3g',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
    '--mount', `type=bind,src=${workspace},dst=/work,readonly`,
    '--mount', `type=bind,src=${path.join(dependencyRoot, 'node_modules')},dst=/work/node_modules,readonly`,
    '--workdir', '/work',
    '--env', 'HOME=/tmp',
    '--env', 'CI=true',
    '--env', 'NODE_ENV=test',
    '--env', 'FREE_ONLY=false',
    '--env', 'ORIGIN_ISOLATED_VERIFY=true',
    '--env', 'PATH=/work/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    IMAGE, '/bin/sh', '-eu', '-c', command,
  ];
  const row = await execFixed('docker', args, process.cwd(), cleanHostEnv('/tmp'), CHECK_TIMEOUT_MS + 30_000);
  return { ok: !row.timedOut && row.code === 0, exitCode: row.code, timedOut: row.timedOut };
}

async function actualChangedPaths(workspace: string): Promise<string[]> {
  const diff = await execFixed('git', ['diff', '--name-only', '-z', 'HEAD', '--'], workspace, cleanHostEnv('/tmp'));
  if (diff.code !== 0) throw new Error('TRUSTED_CANDIDATE_DIFF_FAILED');
  const untracked = await execFixed('git', ['ls-files', '--others', '-z'], workspace, cleanHostEnv('/tmp'));
  if (untracked.code !== 0) throw new Error('TRUSTED_CANDIDATE_DIFF_FAILED');
  const values = [...diff.output.split('\0'), ...untracked.output.split('\0')]
    .filter(value => value.length > 0);
  return [...new Set(values)].sort();
}

function visiblePacket(packet: HeldOutPrivateTaskPacketV14) {
  return {
    id: packet.id,
    baseSha: packet.baseSha,
    requiredChangedPaths: packet.requiredChangedPaths,
    goal: packet.goal,
  };
}

type TrustedVerificationJournalRow = {
  attempt: number;
  checks: Array<{ kind: 'typecheck' | 'lint' | 'test' | 'build'; ok: boolean; exitCode: number | null; timedOut: boolean }>;
};

async function readTrustedVerificationJournal(file: string): Promise<TrustedVerificationJournalRow[]> {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch { throw new Error('TRUSTED_VERIFIER_JOURNAL_MISSING'); }
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length < 1 || lines.length > 4) throw new Error('TRUSTED_VERIFIER_JOURNAL_INVALID');
  const rows: TrustedVerificationJournalRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let value: any;
    try { value = JSON.parse(lines[index]); }
    catch { throw new Error('TRUSTED_VERIFIER_JOURNAL_INVALID'); }
    if (value?.attempt !== index || !Array.isArray(value.checks) || value.checks.length !== 4) throw new Error('TRUSTED_VERIFIER_JOURNAL_INVALID');
    const expected = ['typecheck', 'lint', 'test', 'build'];
    for (let checkIndex = 0; checkIndex < expected.length; checkIndex += 1) {
      const check = value.checks[checkIndex];
      if (
        check?.kind !== expected[checkIndex]
        || typeof check.ok !== 'boolean'
        || !(check.exitCode === null || Number.isInteger(check.exitCode))
        || typeof check.timedOut !== 'boolean'
      ) throw new Error('TRUSTED_VERIFIER_JOURNAL_INVALID');
    }
    rows.push(value as TrustedVerificationJournalRow);
  }
  return rows;
}

function trustedSessionForScoring(candidateSession: any, actualPaths: string[], journal: TrustedVerificationJournalRow[]) {
  if (!candidateSession || !['verified', 'blocked', 'repair_limit'].includes(candidateSession.status)) {
    throw new Error('TRUSTED_CANDIDATE_RESULT_INVALID');
  }
  const finalChecks = journal.at(-1)?.checks ?? [];
  const finalPassing = finalChecks.length === 4 && finalChecks.every(check => check.ok && check.exitCode === 0 && check.timedOut === false);
  const status = candidateSession.status === 'verified' && finalPassing ? 'verified' : candidateSession.status;
  return {
    runId: typeof candidateSession.runId === 'string' ? candidateSession.runId : 'trusted-candidate-run',
    status,
    code: typeof candidateSession.code === 'string' && /^CODING_[A-Z0-9_]{1,96}$/.test(candidateSession.code)
      ? candidateSession.code
      : (status === 'verified' ? 'CODING_CHECKS_PASSED' : 'CODING_NOT_VERIFIED'),
    repairRounds: Math.max(0, journal.length - 1),
    changedPaths: actualPaths,
    audit: journal.map(row => ({
      sequence: row.attempt + 1,
      action: 'verified' as const,
      attempt: row.attempt,
      checks: row.checks,
    })),
    gitPublished: false as const,
    deployed: false as const,
  };
}

async function main(): Promise<void> {
  const controllerRoot = await fs.realpath(process.cwd());
  const candidateSha = (process.env.ORIGIN_CANDIDATE_SHA ?? '').toLowerCase();
  const taskId = process.env.ORIGIN_HELDOUT_TASK_ID ?? '';
  const encodedCorpus = process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64 ?? '';
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error('TRUSTED_CANDIDATE_SHA_INVALID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(taskId)) throw new Error('TRUSTED_CANDIDATE_TASK_ID_INVALID');
  if (!encodedCorpus || !apiKey) throw new Error('TRUSTED_CANDIDATE_SECRET_CONFIG_MISSING');

  const binding = parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15(encodedCorpus, candidateSha);
  const row = binding.rebound.privateCorpus.tasks.find(item => item.packet.id === taskId);
  if (!row) throw new Error('TRUSTED_CANDIDATE_TASK_NOT_FOUND');
  const packet = row.packet;

  delete process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64;
  delete process.env.OPENROUTER_API_KEY;

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-candidate-worktree-'));
  const dependencyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-candidate-deps-'));
  const socketDir = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-provider-socket-'));
  const verifierSocketDir = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-verifier-socket-'));
  const envDir = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-candidate-env-'));
  const socketPath = path.join(socketDir, 'provider.sock');
  const verifierSocketPath = path.join(verifierSocketDir, 'verifier.sock');
  const verifierJournalPath = path.join(envDir, 'verifier-journal.jsonl');
  const token = randomBytes(32).toString('hex');
  const verifierToken = randomBytes(32).toString('hex');
  const containerName = `origin-trusted-candidate-${randomUUID().slice(0, 12)}`;
  let worktreeAdded = false;
  let proxy: Child | null = null;
  let verifierProxy: Child | null = null;
  let gitFileSnapshot: GitFileSnapshot | null = null;

  try {
    const repoUrl = `https://github.com/${process.env.GITHUB_REPOSITORY ?? ''}.git`;
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repoUrl)) {
      throw new Error('TRUSTED_CANDIDATE_REPOSITORY_INVALID');
    }
    const fetched = await execFixed('git', ['fetch', '--no-tags', repoUrl, candidateSha], controllerRoot, cleanHostEnv('/tmp'));
    if (fetched.code !== 0) throw new Error('TRUSTED_CANDIDATE_FETCH_FAILED');
    const added = await execFixed('git', ['worktree', 'add', '--detach', workspace, candidateSha], controllerRoot, cleanHostEnv('/tmp'));
    if (added.code !== 0) throw new Error('TRUSTED_CANDIDATE_WORKTREE_FAILED');
    worktreeAdded = true;

    const resolved = await execFixed('git', ['rev-parse', 'HEAD'], workspace, cleanHostEnv('/tmp'));
    if (resolved.code !== 0 || resolved.output.trim() !== candidateSha) throw new Error('TRUSTED_CANDIDATE_SHA_MISMATCH');
    gitFileSnapshot = await snapshotGitFile(workspace);

    const installed = await execFixed('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], workspace, cleanHostEnv('/tmp'), 600_000);
    if (installed.code !== 0 || installed.timedOut) throw new Error('TRUSTED_CANDIDATE_DEPENDENCY_INSTALL_FAILED');
    await fs.rename(path.join(workspace, 'node_modules'), path.join(dependencyRoot, 'node_modules'));

    proxy = spawn(process.execPath, ['--import', 'tsx', 'scripts/trusted-heldout-provider-proxy-v15.ts'], {
      cwd: controllerRoot,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: '/tmp',
        OPENROUTER_API_KEY: apiKey,
        ORIGIN_TRUSTED_PROVIDER_SOCKET: socketPath,
        ORIGIN_TRUSTED_PROVIDER_TOKEN: token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForSocket(socketPath, proxy, 'TRUSTED_PROVIDER_PROXY');
    await fs.chmod(socketDir, 0o555);

    verifierProxy = spawn(process.execPath, ['--import', 'tsx', 'scripts/trusted-heldout-verifier-proxy-v15.ts'], {
      cwd: controllerRoot,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: '/tmp',
        ORIGIN_TRUSTED_VERIFIER_SOCKET: verifierSocketPath,
        ORIGIN_TRUSTED_VERIFIER_TOKEN: verifierToken,
        ORIGIN_TRUSTED_VERIFIER_WORKSPACE: workspace,
        ORIGIN_TRUSTED_VERIFIER_DEPENDENCY_ROOT: dependencyRoot,
        ORIGIN_TRUSTED_VERIFIER_JOURNAL: verifierJournalPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForSocket(verifierSocketPath, verifierProxy, 'TRUSTED_VERIFIER_PROXY');
    await fs.chmod(verifierSocketDir, 0o555);

    const envFile = path.join(envDir, 'candidate.env');
    const encodedVisible = Buffer.from(JSON.stringify(visiblePacket(packet)), 'utf8').toString('base64');
    await fs.writeFile(envFile, [
      `ORIGIN_VISIBLE_PACKET_B64=${encodedVisible}`,
      'ORIGIN_PROVIDER_PROXY_SOCKET=/proxy/provider.sock',
      `ORIGIN_PROVIDER_PROXY_TOKEN=${token}`,
      'ORIGIN_VERIFIER_PROXY_SOCKET=/verifier/verifier.sock',
      `ORIGIN_VERIFIER_PROXY_TOKEN=${verifierToken}`,
      '',
    ].join('\n'), { mode: 0o600 });

    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
    const dockerArgs = [
      'run', '--rm', '--name', containerName,
      '--network', 'none',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--read-only',
      '--user', `${uid}:${gid}`,
      '--pids-limit', '128',
      '--cpus', '2',
      '--memory', '3g',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
      '--mount', `type=bind,src=${controllerRoot},dst=/controller,readonly`,
      '--mount', `type=bind,src=${workspace},dst=/work`,
      '--mount', `type=bind,src=${path.join(workspace, '.git')},dst=/work/.git,readonly`,
      '--mount', `type=bind,src=${path.join(dependencyRoot, 'node_modules')},dst=/work/node_modules,readonly`,
      '--mount', `type=bind,src=${socketDir},dst=/proxy,readonly`,
      '--mount', `type=bind,src=${verifierSocketDir},dst=/verifier,readonly`,
      '--env-file', envFile,
      '--workdir', '/controller',
      IMAGE,
      '/bin/sh', '-eu', '-c',
      'node --import tsx scripts/trusted-heldout-candidate-runner-v15.ts',
    ];

    const candidate = await execFixed(
      'docker',
      dockerArgs,
      controllerRoot,
      cleanHostEnv('/tmp'),
      Math.min(packet.timeBudgetMs + 120_000, 3_600_000),
    );
    if (candidate.timedOut) {
      await execFixed('docker', ['rm', '-f', containerName], controllerRoot, cleanHostEnv('/tmp'), 30_000).catch(() => undefined);
      throw new Error('TRUSTED_CANDIDATE_TIME_BUDGET_EXCEEDED');
    }

    const resultLine = candidate.output.split('\n').reverse().find(line => line.startsWith('ORIGIN_TRUSTED_CANDIDATE_RESULT '));
    if (!resultLine) throw new Error('TRUSTED_CANDIDATE_RESULT_MISSING');
    let candidateResult: any;
    try { candidateResult = JSON.parse(resultLine.slice('ORIGIN_TRUSTED_CANDIDATE_RESULT '.length)); }
    catch { throw new Error('TRUSTED_CANDIDATE_RESULT_INVALID'); }
    if (candidateResult?.schemaVersion !== 'origin-trusted-candidate-agent-result-v1') throw new Error('TRUSTED_CANDIDATE_RESULT_INVALID');
    if (candidateResult?.error) throw new Error(String(candidateResult.error));
    if (candidateResult?.taskId !== taskId || candidateResult?.candidateSha !== candidateSha || !candidateResult?.session) {
      throw new Error('TRUSTED_CANDIDATE_RESULT_IDENTITY_MISMATCH');
    }

    if (proxy) {
      await stopChild(proxy, 'TRUSTED_PROVIDER_PROXY');
      proxy = null;
    }
    if (verifierProxy) {
      await stopChild(verifierProxy, 'TRUSTED_VERIFIER_PROXY');
      verifierProxy = null;
    }

    if (!gitFileSnapshot) throw new Error('TRUSTED_CANDIDATE_GIT_METADATA_INVALID');
    await assertGitFileUnchanged(workspace, gitFileSnapshot);

    const trustedJournal = await readTrustedVerificationJournal(verifierJournalPath);
    const actualPaths = await actualChangedPaths(workspace);
    const reportedPaths = candidateResult.session.changedPaths;
    if (!Array.isArray(reportedPaths) || reportedPaths.some((value: unknown) => typeof value !== 'string')) {
      throw new Error('TRUSTED_CANDIDATE_RESULT_INVALID');
    }
    const sessionPaths = [...new Set(reportedPaths as string[])].sort();
    assertTrustedCandidateDiffScopeV15({
      actualPaths,
      reportedPaths: sessionPaths,
      requiredPaths: packet.requiredChangedPaths,
    });
    for (const changedPath of actualPaths) {
      await assertTrustedCandidatePathNoSymlinksV15(workspace, changedPath);
    }
    const trustedSession = trustedSessionForScoring(candidateResult.session, actualPaths, trustedJournal);
    const changedPathsVerified = true;

    for (const hidden of packet.hiddenTests) {
      await writeTrustedCandidateHiddenTestV15(workspace, hidden.path, hidden.content);
    }

    const hidden = await dockerCheck(workspace, dependencyRoot, HIDDEN_TEST_COMMAND, 'hidden');
    const trustedChecks = [];
    for (const kind of CHECKS) trustedChecks.push({ kind, ...(await dockerCheck(workspace, dependencyRoot, CHECK_COMMANDS[kind], kind)) });
    await assertGitFileUnchanged(workspace, gitFileSnapshot);
    const trustedVerificationPassed = hidden.ok && trustedChecks.every(check => check.ok) && changedPathsVerified;

    const run = buildHeldOutCodingRunFromSessionV14({
      packet,
      participant: 'ORIGIN',
      outcome: {
        session: trustedSession,
        provider: 'OpenRouter',
        model: ORIGIN_OPENROUTER_FREE_MODEL,
        costUsd: 0,
        durationMs: Number(candidateResult.durationMs) || 0,
      },
      hiddenTestsOk: trustedVerificationPassed,
    });
    const score = scoreHeldOutCodingRunV14(publicHeldOutTaskFromPrivatePacketV14(packet), run);
    const publicTask = publicHeldOutTaskFromPrivatePacketV14(packet);
    const publicEvidence = {
      schemaVersion: 'origin-trusted-candidate-task-evidence-v1',
      candidateSha,
      taskId,
      sourceCorpusDigest: binding.sourceCorpusDigest,
      candidateCorpusDigest: binding.candidateCorpusDigest,
      changedPathsVerified,
      hiddenTestsPassed: hidden.ok,
      trustedVerificationChecks: trustedChecks.map(check => ({
        kind: check.kind,
        ok: check.ok,
        exitCode: check.exitCode,
        timedOut: check.timedOut,
      })),
      zeroCost: true,
      networkMode: 'candidate:none; verification:none; provider:unix-socket-trusted-host; verifier:unix-socket-trusted-host',
      trustedVerificationAttempts: trustedJournal.length,
      trustedRecoveryObserved: trustedJournal.slice(0, -1).some(row => row.checks.some(check => !check.ok || check.exitCode !== 0 || check.timedOut)),
    };

    await fs.mkdir(path.join(controllerRoot, 'test-results'), { recursive: true });
    await fs.writeFile(path.join(controllerRoot, 'test-results', 'held-out-task-public.json'), JSON.stringify(publicTask, null, 2));
    await fs.writeFile(path.join(controllerRoot, 'test-results', 'held-out-run.json'), JSON.stringify(run, null, 2));
    await fs.writeFile(path.join(controllerRoot, 'test-results', 'held-out-score.json'), JSON.stringify(score, null, 2));
    await fs.writeFile(path.join(controllerRoot, 'test-results', 'trusted-candidate-task-evidence.json'), JSON.stringify(publicEvidence, null, 2));

    process.stdout.write(JSON.stringify({
      taskId,
      solved: score.solved,
      regressions: score.regressions.length,
      durationMs: score.durationMs,
      costUsd: score.costUsd,
    }) + '\n');
  } finally {
    if (proxy) {
      proxy.kill('SIGKILL');
      proxy = null;
    }
    if (verifierProxy) {
      verifierProxy.kill('SIGKILL');
      verifierProxy = null;
    }
    await fs.chmod(socketDir, 0o700).catch(() => undefined);
    await fs.chmod(verifierSocketDir, 0o700).catch(() => undefined);
    if (worktreeAdded) await execFixed('git', ['worktree', 'remove', '--force', workspace], controllerRoot, cleanHostEnv('/tmp'), 60_000).catch(() => undefined);
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(dependencyRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(socketDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(verifierSocketDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(envDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const code = /^(?:CODING|PROVIDER|TRUSTED|HELD_OUT)_[A-Z0-9_:-]+$/.test(message)
    ? message
    : 'TRUSTED_CANDIDATE_CONTROLLER_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
