export const HELD_OUT_CODING_BENCHMARK_VERSION = 'origin-held-out-coding-v1' as const;

const REQUIRED_CHECKS = ['typecheck', 'lint', 'test', 'build'] as const;
type VerificationKind = (typeof REQUIRED_CHECKS)[number];

export type HeldOutCodingTaskV14 = {
  /** Opaque ID only; the task prompt/solution is intentionally not part of this public contract. */
  id: string;
  /** SHA-256 (hex) of the private task packet used by the evaluator. */
  taskDigest: string;
  /** Exact repository revision both systems must start from. */
  baseSha: string;
  /** Equal wall-clock budget used for every participant. */
  timeBudgetMs: number;
  /** Expected production paths whose behavior must change for this task. */
  requiredChangedPaths: string[];
  /** Paths the agent must never modify, including hidden tests and evaluator fixtures. */
  protectedPaths: string[];
  /** Recovery tasks require at least one failed verification attempt before final success. */
  recoveryRequired: boolean;
};

export type HeldOutCodingCheckV14 = {
  kind: VerificationKind;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
};

export type HeldOutCodingAttemptV14 = {
  attempt: number;
  changedPaths: string[];
  checks: HeldOutCodingCheckV14[];
};

export type HeldOutCodingRunV14 = {
  suite: typeof HELD_OUT_CODING_BENCHMARK_VERSION;
  taskId: string;
  taskDigest: string;
  participant: string;
  provider: string;
  model: string;
  baseSha: string;
  durationMs: number;
  costUsd: number;
  terminalStatus: 'verified' | 'blocked' | 'failed' | 'cancelled';
  /** Stable controller code only; never contains model text, prompts, tests, or diagnostics. */
  terminalCode?: string;
  attempts: HeldOutCodingAttemptV14[];
  finalChangedPaths: string[];
  gitPublished: boolean;
  deployed: boolean;
};

export type HeldOutCodingScoreV14 = {
  taskId: string;
  participant: string;
  axes: {
    heldOutIdentity: boolean;
    multiFileEditing: boolean;
    verification: boolean;
    failureRecovery: boolean;
  };
  solved: boolean;
  regressions: string[];
  durationMs: number;
  costUsd: number;
  terminalStatus: HeldOutCodingRunV14['terminalStatus'];
};

function validSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function uniquePaths(paths: string[]): boolean {
  return paths.length === new Set(paths).size && paths.every(path => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('..'));
}

function completePassingChecks(checks: HeldOutCodingCheckV14[]): boolean {
  if (!Array.isArray(checks) || checks.length !== REQUIRED_CHECKS.length) return false;
  return REQUIRED_CHECKS.every(kind => {
    const rows = checks.filter(check => check?.kind === kind);
    return rows.length === 1 && rows[0].ok === true && rows[0].exitCode === 0 && rows[0].timedOut === false;
  });
}

function attemptHasFailure(attempt: HeldOutCodingAttemptV14): boolean {
  return attempt.checks.some(check => check.ok !== true || check.exitCode !== 0 || check.timedOut === true);
}

function validateTask(task: HeldOutCodingTaskV14): void {
  if (!task || typeof task !== 'object') throw new Error('HELD_OUT_TASK_INVALID');
  if (!task.id.trim() || task.id.length > 120) throw new Error('HELD_OUT_TASK_ID_INVALID');
  if (!validSha256(task.taskDigest)) throw new Error('HELD_OUT_TASK_DIGEST_INVALID');
  if (!/^[a-f0-9]{40}$/i.test(task.baseSha)) throw new Error('HELD_OUT_BASE_SHA_INVALID');
  if (!Number.isInteger(task.timeBudgetMs) || task.timeBudgetMs < 1_000 || task.timeBudgetMs > 60 * 60 * 1_000) throw new Error('HELD_OUT_TIME_BUDGET_INVALID');
  if (!Array.isArray(task.requiredChangedPaths) || task.requiredChangedPaths.length < 2 || !uniquePaths(task.requiredChangedPaths)) throw new Error('HELD_OUT_MULTIFILE_TASK_REQUIRED');
  if (!Array.isArray(task.protectedPaths) || !uniquePaths(task.protectedPaths)) throw new Error('HELD_OUT_PROTECTED_PATHS_INVALID');
  if (task.requiredChangedPaths.some(path => task.protectedPaths.includes(path))) throw new Error('HELD_OUT_PATH_POLICY_CONFLICT');
}

function validateRun(run: HeldOutCodingRunV14): void {
  if (!run || typeof run !== 'object' || run.suite !== HELD_OUT_CODING_BENCHMARK_VERSION) throw new Error('HELD_OUT_RUN_INVALID');
  if (!run.taskId?.trim() || !validSha256(run.taskDigest) || !/^[a-f0-9]{40}$/i.test(run.baseSha)) throw new Error('HELD_OUT_RUN_IDENTITY_INVALID');
  if (!run.participant?.trim() || !run.provider?.trim() || !run.model?.trim()) throw new Error('HELD_OUT_RUN_PROVENANCE_REQUIRED');
  if (!Number.isFinite(run.durationMs) || run.durationMs < 0 || !Number.isFinite(run.costUsd) || run.costUsd < 0) throw new Error('HELD_OUT_RUN_METRICS_INVALID');
  if (run.terminalCode !== undefined && !/^CODING_[A-Z0-9_]{1,96}$/.test(run.terminalCode)) throw new Error('HELD_OUT_TERMINAL_CODE_INVALID');
  if (!Array.isArray(run.attempts) || run.attempts.length < 1 || run.attempts.length > 8) throw new Error('HELD_OUT_ATTEMPTS_INVALID');
  if (!Array.isArray(run.finalChangedPaths) || !uniquePaths(run.finalChangedPaths)) throw new Error('HELD_OUT_CHANGED_PATHS_INVALID');
  for (let index = 0; index < run.attempts.length; index += 1) {
    const attempt = run.attempts[index];
    if (!attempt || attempt.attempt !== index || !Array.isArray(attempt.changedPaths) || !uniquePaths(attempt.changedPaths) || !Array.isArray(attempt.checks)) throw new Error('HELD_OUT_ATTEMPT_INVALID');
  }
}

/**
 * Deterministic scorer for private/held-out coding runs.
 * It never receives the private prompt, hidden-test source, expected patch, or solution.
 */
export function scoreHeldOutCodingRunV14(task: HeldOutCodingTaskV14, run: HeldOutCodingRunV14): HeldOutCodingScoreV14 {
  validateTask(task);
  validateRun(run);

  const regressions: string[] = [];
  const heldOutIdentity = run.taskId === task.id && run.taskDigest === task.taskDigest && run.baseSha === task.baseSha && run.durationMs <= task.timeBudgetMs;
  if (!heldOutIdentity) regressions.push('identity-or-budget');

  const changed = new Set(run.finalChangedPaths);
  const protectedTouched = task.protectedPaths.filter(path => changed.has(path));
  const requiredMissing = task.requiredChangedPaths.filter(path => !changed.has(path));
  const multiFileEditing = run.finalChangedPaths.length >= 2 && requiredMissing.length === 0 && protectedTouched.length === 0;
  if (requiredMissing.length) regressions.push('required-path-missing');
  if (protectedTouched.length) regressions.push('protected-path-modified');
  if (run.finalChangedPaths.length < 2) regressions.push('single-file-only');

  const finalAttempt = run.attempts.at(-1)!;
  const verification = run.terminalStatus === 'verified' && completePassingChecks(finalAttempt.checks) && run.gitPublished === false && run.deployed === false;
  if (!verification) regressions.push('verification-incomplete');

  const priorAttempts = run.attempts.slice(0, -1);
  const observedFailure = priorAttempts.some(attemptHasFailure);
  const failureRecovery = task.recoveryRequired ? observedFailure && run.attempts.length >= 2 && verification : verification;
  if (!failureRecovery) regressions.push('recovery-not-demonstrated');

  const axes = { heldOutIdentity, multiFileEditing, verification, failureRecovery };
  return {
    taskId: task.id,
    participant: run.participant,
    axes,
    solved: Object.values(axes).every(Boolean),
    regressions,
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    terminalStatus: run.terminalStatus,
  };
}

export function summarizeHeldOutCodingRunsV14(scores: HeldOutCodingScoreV14[]) {
  if (!Array.isArray(scores) || scores.length < 1) throw new Error('HELD_OUT_SCORES_REQUIRED');
  const durations = scores.map(score => score.durationMs).sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const medianDurationMs = durations.length % 2 === 0 ? (durations[middle - 1] + durations[middle]) / 2 : durations[middle];
  return {
    attempted: scores.length,
    solved: scores.filter(score => score.solved).length,
    regressions: scores.reduce((count, score) => count + score.regressions.length, 0),
    medianDurationMs,
    totalCostUsd: scores.reduce((sum, score) => sum + score.costUsd, 0),
  };
}
