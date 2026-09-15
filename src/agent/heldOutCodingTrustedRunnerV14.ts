import { createHash } from 'node:crypto';
import { containsLikelySecret } from './safeFilePolicy.js';
import {
  HELD_OUT_CODING_BENCHMARK_VERSION,
  scoreHeldOutCodingRunV14,
  type HeldOutCodingAttemptV14,
  type HeldOutCodingRunV14,
  type HeldOutCodingTaskV14,
} from './heldOutCodingBenchmarkV14.js';
import type { CodingSessionResult } from './codingSessionV14.js';

export const HELD_OUT_PRIVATE_TASK_PACKET_VERSION = 'origin-held-out-private-task-v1' as const;

export type HeldOutPrivateTestV14 = {
  path: string;
  content: string;
};

export type HeldOutPrivateTaskPacketV14 = {
  version: typeof HELD_OUT_PRIVATE_TASK_PACKET_VERSION;
  id: string;
  baseSha: string;
  timeBudgetMs: number;
  requiredChangedPaths: string[];
  protectedPaths: string[];
  recoveryRequired: boolean;
  goal: string;
  hiddenTests: HeldOutPrivateTestV14[];
};

export type HeldOutAgentOutcomeV14 = {
  session: CodingSessionResult;
  provider: string;
  model: string;
  costUsd: number;
  durationMs: number;
};

export type HeldOutTrustedRunnerDependenciesV14 = {
  assertBaseSha: (baseSha: string) => Promise<void>;
  runAgent: (packet: HeldOutPrivateTaskPacketV14, task: HeldOutCodingTaskV14) => Promise<HeldOutAgentOutcomeV14>;
  runHiddenTests: (packet: HeldOutPrivateTaskPacketV14, session: CodingSessionResult) => Promise<{ ok: boolean }>;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value as Record<string, unknown>).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !value.startsWith('/')
    && !value.split('/').includes('..')
    && !value.includes('\\')
    && !value.includes('\0');
}

function uniqueSafePaths(paths: unknown): paths is string[] {
  return Array.isArray(paths) && paths.length === new Set(paths).size && paths.every(safeRelativePath);
}

export function validateHeldOutPrivateTaskPacketV14(packet: HeldOutPrivateTaskPacketV14): void {
  if (!packet || typeof packet !== 'object' || packet.version !== HELD_OUT_PRIVATE_TASK_PACKET_VERSION) throw new Error('HELD_OUT_PRIVATE_PACKET_INVALID');
  if (typeof packet.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(packet.id)) throw new Error('HELD_OUT_PRIVATE_TASK_ID_INVALID');
  if (typeof packet.baseSha !== 'string' || !/^[a-f0-9]{40}$/i.test(packet.baseSha)) throw new Error('HELD_OUT_PRIVATE_BASE_SHA_INVALID');
  if (!Number.isInteger(packet.timeBudgetMs) || packet.timeBudgetMs < 1_000 || packet.timeBudgetMs > 60 * 60 * 1_000) throw new Error('HELD_OUT_PRIVATE_TIME_BUDGET_INVALID');
  if (!uniqueSafePaths(packet.requiredChangedPaths) || packet.requiredChangedPaths.length < 2) throw new Error('HELD_OUT_PRIVATE_MULTIFILE_REQUIRED');
  if (!uniqueSafePaths(packet.protectedPaths)) throw new Error('HELD_OUT_PRIVATE_PROTECTED_PATHS_INVALID');
  if (packet.requiredChangedPaths.some(path => packet.protectedPaths.includes(path))) throw new Error('HELD_OUT_PRIVATE_PATH_CONFLICT');
  if (typeof packet.recoveryRequired !== 'boolean') throw new Error('HELD_OUT_PRIVATE_RECOVERY_FLAG_INVALID');
  if (typeof packet.goal !== 'string' || !packet.goal.trim() || packet.goal.length > 4_000 || containsLikelySecret(packet.goal)) throw new Error('HELD_OUT_PRIVATE_GOAL_INVALID');
  if (!Array.isArray(packet.hiddenTests) || packet.hiddenTests.length < 1 || packet.hiddenTests.length > 16) throw new Error('HELD_OUT_PRIVATE_TESTS_INVALID');
  let hiddenBytes = 0;
  const hiddenPaths = new Set<string>();
  for (const test of packet.hiddenTests) {
    if (!test || typeof test !== 'object' || !safeRelativePath(test.path) || !/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i.test(test.path)) throw new Error('HELD_OUT_PRIVATE_TEST_INVALID');
    if (hiddenPaths.has(test.path)) throw new Error('HELD_OUT_PRIVATE_TEST_DUPLICATE');
    hiddenPaths.add(test.path);
    if (typeof test.content !== 'string' || !test.content.trim()) throw new Error('HELD_OUT_PRIVATE_TEST_INVALID');
    hiddenBytes += Buffer.byteLength(test.content);
  }
  if (hiddenBytes > 256 * 1024) throw new Error('HELD_OUT_PRIVATE_TEST_BYTES_LIMIT');
  if (Buffer.byteLength(canonical(packet)) > 384 * 1024) throw new Error('HELD_OUT_PRIVATE_PACKET_BYTES_LIMIT');
}

export function heldOutPrivateTaskDigestV14(packet: HeldOutPrivateTaskPacketV14): string {
  validateHeldOutPrivateTaskPacketV14(packet);
  return createHash('sha256').update(canonical(packet)).digest('hex');
}

export function publicHeldOutTaskFromPrivatePacketV14(packet: HeldOutPrivateTaskPacketV14): HeldOutCodingTaskV14 {
  return {
    id: packet.id,
    taskDigest: heldOutPrivateTaskDigestV14(packet),
    baseSha: packet.baseSha,
    timeBudgetMs: packet.timeBudgetMs,
    requiredChangedPaths: [...packet.requiredChangedPaths],
    protectedPaths: [...packet.protectedPaths],
    recoveryRequired: packet.recoveryRequired,
  };
}

function attemptsFromSession(session: CodingSessionResult, hiddenTestsOk: boolean): HeldOutCodingAttemptV14[] {
  const verificationEvents = session.audit.filter(event => event.action === 'verified');
  const maxAttempt = Math.max(0, session.repairRounds, ...verificationEvents.map(event => event.attempt));
  const attempts: HeldOutCodingAttemptV14[] = [];
  for (let attempt = 0; attempt <= maxAttempt; attempt += 1) {
    const event = verificationEvents.find(candidate => candidate.attempt === attempt);
    const changedPaths = [...new Set(session.audit
      .filter(candidate => candidate.action === 'edited' && candidate.attempt === attempt)
      .flatMap(candidate => candidate.changes?.map(change => change.path) ?? []))];
    attempts.push({
      attempt,
      changedPaths,
      checks: (event?.checks ?? []).map(check => ({ kind: check.kind, ok: check.ok, exitCode: check.exitCode, timedOut: check.timedOut })),
    });
  }
  if (!hiddenTestsOk) {
    const final = attempts.at(-1)!;
    const existing = final.checks.find(check => check.kind === 'test');
    if (existing) {
      existing.ok = false;
      existing.exitCode = existing.exitCode === 0 ? 1 : existing.exitCode;
      existing.timedOut = false;
    }
  }
  return attempts;
}

export function buildHeldOutCodingRunFromSessionV14(input: {
  packet: HeldOutPrivateTaskPacketV14;
  participant: string;
  outcome: HeldOutAgentOutcomeV14;
  hiddenTestsOk: boolean;
}): HeldOutCodingRunV14 {
  const task = publicHeldOutTaskFromPrivatePacketV14(input.packet);
  const { session } = input.outcome;
  if (!input.participant.trim() || input.participant.length > 120) throw new Error('HELD_OUT_PARTICIPANT_INVALID');
  if (!input.outcome.provider.trim() || !input.outcome.model.trim()) throw new Error('HELD_OUT_PROVENANCE_INVALID');
  if (!Number.isFinite(input.outcome.costUsd) || input.outcome.costUsd < 0 || !Number.isFinite(input.outcome.durationMs) || input.outcome.durationMs < 0) throw new Error('HELD_OUT_METRICS_INVALID');
  const terminalStatus: HeldOutCodingRunV14['terminalStatus'] = session.status === 'verified'
    ? (input.hiddenTestsOk ? 'verified' : 'failed')
    : session.status === 'blocked' ? 'blocked' : 'failed';
  return {
    suite: HELD_OUT_CODING_BENCHMARK_VERSION,
    taskId: task.id,
    taskDigest: task.taskDigest,
    participant: input.participant.trim(),
    provider: input.outcome.provider,
    model: input.outcome.model,
    baseSha: task.baseSha,
    durationMs: input.outcome.durationMs,
    costUsd: input.outcome.costUsd,
    terminalStatus,
    attempts: attemptsFromSession(session, input.hiddenTestsOk),
    finalChangedPaths: [...session.changedPaths],
    gitPublished: session.gitPublished,
    deployed: session.deployed,
  };
}

export async function runTrustedHeldOutCodingBenchmarkV14(
  packet: HeldOutPrivateTaskPacketV14,
  participant: string,
  deps: HeldOutTrustedRunnerDependenciesV14,
) {
  const task = publicHeldOutTaskFromPrivatePacketV14(packet);
  await deps.assertBaseSha(task.baseSha);
  const outcome = await deps.runAgent(packet, task);
  const hidden = outcome.session.status === 'verified' ? await deps.runHiddenTests(packet, outcome.session) : { ok: false };
  const run = buildHeldOutCodingRunFromSessionV14({ packet, participant, outcome, hiddenTestsOk: hidden.ok });
  const score = scoreHeldOutCodingRunV14(task, run);
  return { task, run, score };
}
