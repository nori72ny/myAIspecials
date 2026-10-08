import { createPublicKey, verify as verifySignature } from 'node:crypto';

export const AGENT_FRONTIER_TASK_GATE_VERSION_V3 = 'origin.agent-frontier-task-gate.v3' as const;

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const isEvidenceDigest = (value: unknown): value is string =>
  typeof value === 'string' && SHA256.test(value) && !/^0{64}$/.test(value);

/**
 * The benchmark is a *frozen* set of task identities, not 24 arbitrary easy tasks.
 * This gate validates evidence shape; only an independent evaluator can attest
 * that the digests identify the original sealed tasks and actual execution.
 */
const FROZEN_FAMILY_BY_ID: Readonly<Record<string, AgentFrontierFamilyV3>> = Object.freeze(
  Object.fromEntries([
    ...Array.from({ length: 12 }, (_, index) => [`coding-${index + 1}`, 'coding-repository']),
    ...Array.from({ length: 8 }, (_, index) => [`agent-${index + 1}`, 'agent-multi-step']),
    ...Array.from({ length: 4 }, (_, index) => [`artifact-${index + 1}`, 'artifact-deliverable']),
  ]) as Record<string, AgentFrontierFamilyV3>,
);

export const AGENT_FRONTIER_FAMILIES_V3 = [
  'coding-repository',
  'agent-multi-step',
  'artifact-deliverable',
] as const;

export type AgentFrontierFamilyV3 = (typeof AGENT_FRONTIER_FAMILIES_V3)[number];
export type AgentFrontierTaskStatusV3 = 'SOLVED' | 'UNSOLVED' | 'NOT_MEASURED';

export type AgentFrontierTaskEvidenceV3 = {
  id: string;
  candidateSha: string;
  family: AgentFrontierFamilyV3;
  status: AgentFrontierTaskStatusV3;
  originalTaskDigest: string;
  planEvidenceDigest: string;
  toolEvidenceDigest: string;
  terminalEvidenceDigest: string;
  verifiedTerminal: boolean;
  falseCompletionClaims: number;
  p0Defects: number;
  p1Defects: number;
  securityPassed: boolean;
  costUsd: number;
  paidFallbackUsed: boolean;
  elapsedMs: number;
  timeBudgetMs: number;
};

export type AgentFrontierGateAttestationV3 = {
  corpusDigest: string;
  evaluationRunId: string;
  signature: string;
};

export type AgentFrontierGateInputV3 = {
  version: typeof AGENT_FRONTIER_TASK_GATE_VERSION_V3;
  candidateSha: string;
  tasks: readonly AgentFrontierTaskEvidenceV3[];
  attestation?: AgentFrontierGateAttestationV3;
};

export type AgentFrontierFamilySummaryV3 = {
  family: AgentFrontierFamilyV3;
  attempted: number;
  solved: number;
  solveRate: number;
  requiredMinSolveRate: number;
  passed: boolean;
};

export type AgentFrontierGateResultV3 = {
  version: typeof AGENT_FRONTIER_TASK_GATE_VERSION_V3;
  candidateSha: string;
  passed: boolean;
  attempted: number;
  measured: number;
  solved: number;
  solveRate: number;
  falseCompletionClaims: number;
  p0Defects: number;
  p1Defects: number;
  families: readonly AgentFrontierFamilySummaryV3[];
  blockers: readonly string[];
};

const REQUIRED_COUNTS: Readonly<Record<AgentFrontierFamilyV3, number>> = Object.freeze({
  'coding-repository': 12,
  'agent-multi-step': 8,
  'artifact-deliverable': 4,
});

const FAMILY_MIN_SOLVE_RATE: Readonly<Record<AgentFrontierFamilyV3, number>> = Object.freeze({
  'coding-repository': 0.8,
  'agent-multi-step': 0.8,
  'artifact-deliverable': 0.8,
});

const OVERALL_MIN_SOLVE_RATE = 0.9;

/**
 * An independent evaluator signs the exact task ledger (not just an aggregate
 * score). Its private signing key MUST never reside in the ORIGIN app/worker,
 * client, PR, or the candidate's CI job.
 *
 * The verifier's public key, sealed corpus identity, one-shot run ID and
 * exact candidate SHA are trusted server-side configuration. None may be
 * provided by a release-candidate or HTTP request payload.
 */
export function canonicalAgentFrontierEvidenceV3(input: AgentFrontierGateInputV3): string {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  return JSON.stringify({
    protocol: 'origin.agent-frontier-independent-attestation.v1',
    version: input?.version ?? null,
    candidateSha: input?.candidateSha ?? null,
    corpusDigest: input?.attestation?.corpusDigest ?? null,
    evaluationRunId: input?.attestation?.evaluationRunId ?? null,
    tasks: tasks.map(task => task && typeof task === 'object' && !Array.isArray(task)
      ? {
        id: task.id, candidateSha: task.candidateSha, family: task.family,
        status: task.status, originalTaskDigest: task.originalTaskDigest,
        planEvidenceDigest: task.planEvidenceDigest, toolEvidenceDigest: task.toolEvidenceDigest,
        terminalEvidenceDigest: task.terminalEvidenceDigest,
        verifiedTerminal: task.verifiedTerminal,
        falseCompletionClaims: task.falseCompletionClaims, p0Defects: task.p0Defects,
        p1Defects: task.p1Defects, securityPassed: task.securityPassed,
        costUsd: task.costUsd, paidFallbackUsed: task.paidFallbackUsed,
        elapsedMs: task.elapsedMs, timeBudgetMs: task.timeBudgetMs,
      } : null),
  });
}

function attestationBlockers(input: AgentFrontierGateInputV3, env: NodeJS.ProcessEnv): string[] {
  const blockers: string[] = [];
  const a = input?.attestation;
  const corpus = env.ORIGIN_AGENT_FRONTIER_CORPUS_SHA256;
  const runId = env.ORIGIN_AGENT_FRONTIER_RUN_ID;
  const pinnedSha = env.ORIGIN_AGENT_FRONTIER_CANDIDATE_SHA;
  const publicKey = env.ORIGIN_AGENT_FRONTIER_EVALUATOR_PUBLIC_KEY_PEM;

  if (!SHA256.test(corpus ?? '') || !runId || !SAFE_ID.test(runId)
    || !SHA40.test(pinnedSha ?? '') || !publicKey || Buffer.byteLength(publicKey, 'utf8') > 4096) {
    return ['EVALUATOR_TRUST_ANCHOR_UNAVAILABLE'];
  }
  if (!a || !isEvidenceDigest(a.corpusDigest) || a.corpusDigest !== corpus) blockers.push('FROZEN_CORPUS_DIGEST_MISMATCH');
  if (!a || typeof a.evaluationRunId !== 'string' || a.evaluationRunId !== runId) blockers.push('EVALUATION_RUN_ID_MISMATCH');
  if (!input || input.candidateSha !== pinnedSha) blockers.push('EVALUATOR_CANDIDATE_SHA_MISMATCH');
  const signature = a?.signature;
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) {
    blockers.push('INDEPENDENT_ATTESTATION_MISSING');
  } else {
    try {
      const decoded = Buffer.from(signature, 'base64url');
      const message = canonicalAgentFrontierEvidenceV3(input);
      const key = createPublicKey(publicKey);
      if (key.asymmetricKeyType !== 'ed25519' || decoded.length !== 64
        || Buffer.byteLength(message, 'utf8') > 96 * 1024
        || !verifySignature(null, Buffer.from(message, 'utf8'), key, decoded)) {
        blockers.push('INDEPENDENT_ATTESTATION_INVALID');
      }
    } catch {
      blockers.push('INDEPENDENT_ATTESTATION_INVALID');
    }
  }
  return blockers;
}

function isFamily(value: unknown): value is AgentFrontierFamilyV3 {
  return typeof value === 'string' && (AGENT_FRONTIER_FAMILIES_V3 as readonly string[]).includes(value);
}

function validTask(task: AgentFrontierTaskEvidenceV3 | null, candidateSha: string): string[] {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ['TASK_EVIDENCE_INVALID'];
  const blockers: string[] = [];
  if (!SAFE_ID.test(task?.id ?? '')) blockers.push('TASK_ID_INVALID');
  if (!SHA40.test(task?.candidateSha ?? '') || task.candidateSha.toLowerCase() !== candidateSha) {
    blockers.push('TASK_CANDIDATE_SHA_MISMATCH');
  }
  if (!isFamily(task?.family)) blockers.push('TASK_FAMILY_INVALID');
  if (FROZEN_FAMILY_BY_ID[task.id] !== task.family) blockers.push('TASK_FROZEN_ID_OR_FAMILY_INVALID');
  if (!isEvidenceDigest(task.originalTaskDigest)) blockers.push('TASK_ORIGINAL_DIGEST_INVALID');
  if (!['SOLVED', 'UNSOLVED', 'NOT_MEASURED'].includes(task?.status)) blockers.push('TASK_STATUS_INVALID');
  if (typeof task?.verifiedTerminal !== 'boolean') blockers.push('TASK_TERMINAL_EVIDENCE_INVALID');
  if (!Number.isInteger(task?.falseCompletionClaims) || task.falseCompletionClaims < 0) blockers.push('TASK_FALSE_COMPLETION_COUNT_INVALID');
  if (!Number.isInteger(task?.p0Defects) || task.p0Defects < 0) blockers.push('TASK_P0_COUNT_INVALID');
  if (!Number.isInteger(task?.p1Defects) || task.p1Defects < 0) blockers.push('TASK_P1_COUNT_INVALID');
  if (typeof task?.securityPassed !== 'boolean') blockers.push('TASK_SECURITY_EVIDENCE_INVALID');
  if (!Number.isFinite(task?.costUsd) || task.costUsd < 0) blockers.push('TASK_COST_INVALID');
  if (typeof task?.paidFallbackUsed !== 'boolean') blockers.push('TASK_PAID_FALLBACK_INVALID');
  if (!Number.isFinite(task?.elapsedMs) || task.elapsedMs < 0) blockers.push('TASK_ELAPSED_INVALID');
  if (!Number.isFinite(task?.timeBudgetMs) || task.timeBudgetMs <= 0) blockers.push('TASK_TIME_BUDGET_INVALID');

  if (task.status === 'SOLVED') {
    if (!isEvidenceDigest(task.planEvidenceDigest)) blockers.push('TASK_PLAN_EVIDENCE_MISSING');
    if (!isEvidenceDigest(task.toolEvidenceDigest)) blockers.push('TASK_TOOL_EVIDENCE_MISSING');
    if (!isEvidenceDigest(task.terminalEvidenceDigest)) blockers.push('TASK_TERMINAL_DIGEST_MISSING');
    if (!task.verifiedTerminal) blockers.push('TASK_SOLVED_WITHOUT_VERIFIED_TERMINAL');
    if (task.falseCompletionClaims !== 0) blockers.push('TASK_SOLVED_WITH_FALSE_COMPLETION');
    if (task.p0Defects !== 0 || task.p1Defects !== 0) blockers.push('TASK_SOLVED_WITH_CRITICAL_DEFECT');
    if (!task.securityPassed) blockers.push('TASK_SOLVED_WITHOUT_SECURITY_PASS');
    if (task.costUsd !== 0 || task.paidFallbackUsed) blockers.push('TASK_SOLVED_OUTSIDE_ZERO_COST_BOUNDARY');
    if (task.elapsedMs > task.timeBudgetMs) blockers.push('TASK_SOLVED_OUTSIDE_TIME_BUDGET');
  }

  return blockers;
}

export function evaluateAgentFrontierTaskGateV3(
  input: AgentFrontierGateInputV3,
  trustedEvaluatorEnv: NodeJS.ProcessEnv = process.env,
): AgentFrontierGateResultV3 {
  const blockers: string[] = [...attestationBlockers(input, trustedEvaluatorEnv)];
  const candidateSha = String(input?.candidateSha ?? '').toLowerCase();
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  const records = tasks.filter((task): task is AgentFrontierTaskEvidenceV3 =>
    Boolean(task) && typeof task === 'object' && !Array.isArray(task));

  if (input?.version !== AGENT_FRONTIER_TASK_GATE_VERSION_V3) blockers.push('GATE_VERSION_INVALID');
  if (!SHA40.test(candidateSha)) blockers.push('CANDIDATE_SHA_INVALID');
  if (tasks.length !== 24) blockers.push('TASK_COUNT_MUST_EQUAL_24');
  if (records.length !== tasks.length) blockers.push('TASK_EVIDENCE_RECORDS_INVALID');
  if (new Set(tasks.map(task => task?.id)).size !== tasks.length) blockers.push('TASK_IDS_DUPLICATE');
  if (new Set(records.map(task => task.originalTaskDigest)).size !== records.length) blockers.push('TASK_ORIGINAL_DIGESTS_DUPLICATE');

  for (const task of tasks) {
    for (const code of validTask(task, candidateSha)) blockers.push(`${task?.id ?? 'unknown'}:${code}`);
  }

  const familySummaries: AgentFrontierFamilySummaryV3[] = AGENT_FRONTIER_FAMILIES_V3.map(family => {
    const rows = records.filter(task => task.family === family);
    const solved = rows.filter(task => task.status === 'SOLVED').length;
    const attempted = rows.length;
    const solveRate = attempted === 0 ? 0 : solved / attempted;
    const required = FAMILY_MIN_SOLVE_RATE[family];
    if (attempted !== REQUIRED_COUNTS[family]) blockers.push(`FAMILY_COUNT_INVALID:${family}`);
    if (attempted > 0 && solveRate < required) blockers.push(`FAMILY_SOLVE_RATE_BELOW_THRESHOLD:${family}`);
    return {
      family,
      attempted,
      solved,
      solveRate,
      requiredMinSolveRate: required,
      passed: attempted === REQUIRED_COUNTS[family] && solveRate >= required,
    };
  });

  const measured = records.filter(task => task.status !== 'NOT_MEASURED').length;
  const solved = records.filter(task => task.status === 'SOLVED').length;
  const solveRate = tasks.length === 0 ? 0 : solved / tasks.length;
  const falseCompletionClaims = records.reduce((sum, task) => sum + (Number.isInteger(task.falseCompletionClaims) ? task.falseCompletionClaims : 0), 0);
  const p0Defects = records.reduce((sum, task) => sum + (Number.isInteger(task.p0Defects) ? task.p0Defects : 0), 0);
  const p1Defects = records.reduce((sum, task) => sum + (Number.isInteger(task.p1Defects) ? task.p1Defects : 0), 0);

  if (measured !== 24) blockers.push('ALL_24_TASKS_MUST_BE_MEASURED');
  if (solveRate < OVERALL_MIN_SOLVE_RATE) blockers.push('OVERALL_SOLVE_RATE_BELOW_90_PERCENT');
  if (falseCompletionClaims !== 0) blockers.push('FALSE_COMPLETION_PRESENT');
  if (p0Defects !== 0) blockers.push('P0_DEFECT_PRESENT');
  if (p1Defects !== 0) blockers.push('P1_DEFECT_PRESENT');
  if (records.some(task => task.securityPassed !== true)) blockers.push('SECURITY_GATE_FAILED');
  if (records.some(task => task.costUsd !== 0 || task.paidFallbackUsed !== false)) blockers.push('ZERO_COST_GATE_FAILED');

  return {
    version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
    candidateSha,
    passed: blockers.length === 0,
    attempted: tasks.length,
    measured,
    solved,
    solveRate,
    falseCompletionClaims,
    p0Defects,
    p1Defects,
    families: familySummaries,
    blockers: [...new Set(blockers)],
  };
}
