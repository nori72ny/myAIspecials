import {
  GENERAL_AGENT_COMPARISON_VERSION_V2,
  GENERAL_AGENT_HELD_OUT_VERSION_V2,
  evaluateGeneralAgentComparisonV2,
  scoreGeneralAgentHeldOutRunV2,
  type GeneralAgentComparisonReportV2,
  type GeneralAgentHeldOutScoreV2,
  type GeneralAgentHeldOutTaskV2,
  type GeneralAgentReferenceSummaryV2,
} from './heldOutGeneralAgentBenchmarkV2.js';
import {
  buildTrustedGeneralAgentRunV2,
  type GeneralAgentTrustedEvidenceV2,
} from './trustedGeneralAgentEvidenceV2.js';

export const GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2 =
  'origin.general-agent-trusted-comparison.v1' as const;

const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
const MAX_EVIDENCE_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type GeneralAgentTrustedRoundEvidenceV2 = {
  source: 'evaluator';
  candidateSha: string;
  evaluatorId: string;
  permissionProfileDigest: string;
  evidenceId: string;
  artifactDigest: string;
  createdAt: string;
  expiresAt: string;
};

export type GeneralAgentTrustedReferenceEvidenceV2 = {
  source: 'controlled-external';
  independentFromCandidate: true;
  participant: string;
  permissionProfileDigest: string;
  evidenceId: string;
  artifactDigest: string;
  createdAt: string;
  expiresAt: string;
  runs: readonly GeneralAgentTrustedEvidenceV2[];
};

export type GeneralAgentTrustedComparisonInputV2 = {
  version: typeof GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2;
  candidateSha: string;
  tasks: readonly GeneralAgentHeldOutTaskV2[];
  roundEvidence: GeneralAgentTrustedRoundEvidenceV2;
  candidateEvidence: readonly GeneralAgentTrustedEvidenceV2[];
  references: readonly GeneralAgentTrustedReferenceEvidenceV2[];
};

export type GeneralAgentTrustedComparisonReportV2 = {
  version: typeof GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2;
  candidateSha: string;
  permissionProfileDigest: string | null;
  trustedRoundEvidencePassed: boolean;
  candidateEvidencePassed: boolean;
  trustedReferenceEvidencePassed: boolean;
  candidateScores: readonly GeneralAgentHeldOutScoreV2[];
  comparison: GeneralAgentComparisonReportV2 | null;
  buildErrors: readonly { participant: string; taskId: string; blockers: readonly string[] }[];
  passed: boolean;
  blockers: readonly string[];
};

function validWindow(createdAtValue: string, expiresAtValue: string, nowMs: number): boolean {
  const createdAt = Date.parse(createdAtValue);
  const expiresAt = Date.parse(expiresAtValue);
  return Number.isFinite(createdAt)
    && Number.isFinite(expiresAt)
    && createdAt <= nowMs + MAX_CLOCK_SKEW_MS
    && expiresAt > nowMs
    && expiresAt >= createdAt
    && expiresAt - createdAt <= MAX_EVIDENCE_LIFETIME_MS;
}

function validArtifactDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function validRoundEvidence(
  evidence: GeneralAgentTrustedRoundEvidenceV2 | null | undefined,
  candidateSha: string,
  nowMs: number,
): evidence is GeneralAgentTrustedRoundEvidenceV2 {
  return Boolean(
    evidence?.source === 'evaluator'
    && SHA40.test(evidence.candidateSha)
    && evidence.candidateSha.toLowerCase() === candidateSha.toLowerCase()
    && SAFE_ID.test(evidence.evaluatorId)
    && SHA256.test(evidence.permissionProfileDigest)
    && SAFE_ID.test(evidence.evidenceId)
    && validArtifactDigest(evidence.artifactDigest)
    && validWindow(evidence.createdAt, evidence.expiresAt, nowMs)
  );
}

function validReferenceEnvelope(
  reference: GeneralAgentTrustedReferenceEvidenceV2,
  permissionProfileDigest: string,
  nowMs: number,
): boolean {
  return Boolean(
    reference?.source === 'controlled-external'
    && reference.independentFromCandidate === true
    && SAFE_ID.test(reference.participant)
    && reference.permissionProfileDigest === permissionProfileDigest
    && SHA256.test(reference.permissionProfileDigest)
    && SAFE_ID.test(reference.evidenceId)
    && validArtifactDigest(reference.artifactDigest)
    && validWindow(reference.createdAt, reference.expiresAt, nowMs)
    && Array.isArray(reference.runs)
  );
}

function evidenceByTask(
  evidence: readonly GeneralAgentTrustedEvidenceV2[],
  tasks: readonly GeneralAgentHeldOutTaskV2[],
  participant: string,
): {
  scores: GeneralAgentHeldOutScoreV2[];
  errors: { participant: string; taskId: string; blockers: readonly string[] }[];
  complete: boolean;
} {
  const expectedIds = new Set(tasks.map(task => task.id));
  const byId = new Map<string, GeneralAgentTrustedEvidenceV2>();
  const errors: { participant: string; taskId: string; blockers: readonly string[] }[] = [];

  if (evidence.length !== tasks.length) {
    errors.push({ participant, taskId: 'round', blockers: ['TRUSTED_EVIDENCE_COUNT_MISMATCH'] });
  }

  for (const row of evidence) {
    const taskId = typeof row?.taskId === 'string' ? row.taskId : '';
    if (!taskId || !expectedIds.has(taskId) || byId.has(taskId)) {
      errors.push({ participant, taskId: taskId || 'malformed', blockers: ['TRUSTED_EVIDENCE_TASK_SET_INVALID'] });
      continue;
    }
    if (typeof row.participant !== 'string' || row.participant.trim().toLowerCase() !== participant.trim().toLowerCase()) {
      errors.push({ participant, taskId, blockers: ['TRUSTED_EVIDENCE_PARTICIPANT_MISMATCH'] });
      continue;
    }
    byId.set(taskId, row);
  }

  const scores: GeneralAgentHeldOutScoreV2[] = [];
  for (const task of tasks) {
    const row = byId.get(task.id);
    if (!row) {
      errors.push({ participant, taskId: task.id, blockers: ['TRUSTED_EVIDENCE_MISSING'] });
      continue;
    }
    const built = buildTrustedGeneralAgentRunV2(task, row);
    if ("blockers" in built) {
      errors.push({ participant, taskId: task.id, blockers: built.blockers });
      continue;
    }
    scores.push(scoreGeneralAgentHeldOutRunV2(task, built.run));
  }

  return {
    scores,
    errors,
    complete: errors.length === 0 && scores.length === tasks.length,
  };
}

function summarizeReference(
  participant: string,
  tasks: readonly GeneralAgentHeldOutTaskV2[],
  scores: readonly GeneralAgentHeldOutScoreV2[],
): GeneralAgentReferenceSummaryV2 {
  const byTask = new Map(scores.map(score => [score.taskId, score]));
  const recoveryTasks = tasks.filter(task => task.recoveryRequired);
  return {
    participant,
    attempted: tasks.length,
    solved: scores.filter(score => score.solved).length,
    regressions: scores.filter(score => !score.regressionFree).length,
    unsafeActions: scores.filter(score =>
      !score.safetyPassed || !score.approvalPassed || !score.stopCancelPassed).length,
    recoveryTasksAttempted: recoveryTasks.length,
    recoveryTasksSolved: recoveryTasks.filter(task =>
      byTask.get(task.id)?.solved === true && byTask.get(task.id)?.recoveryPassed === true).length,
  };
}

export function evaluateGeneralAgentTrustedComparisonV2(
  input: GeneralAgentTrustedComparisonInputV2,
  nowMs: number = Date.now(),
): GeneralAgentTrustedComparisonReportV2 {
  const blockers: string[] = [];
  const buildErrors: { participant: string; taskId: string; blockers: readonly string[] }[] = [];
  const candidateSha = typeof input?.candidateSha === 'string' ? input.candidateSha.toLowerCase() : '';
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  const roundEvidence = input?.roundEvidence;

  if (
    input?.version !== GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2
    || !SHA40.test(candidateSha)
  ) {
    blockers.push('GENERAL_AGENT_TRUSTED_COMPARISON_INPUT_INVALID');
  }

  const trustedRoundEvidencePassed = validRoundEvidence(roundEvidence, candidateSha, nowMs);
  if (!trustedRoundEvidencePassed) blockers.push('GENERAL_AGENT_TRUSTED_ROUND_EVIDENCE_INVALID');
  const permissionProfileDigest = trustedRoundEvidencePassed ? roundEvidence.permissionProfileDigest : null;

  const candidateEvidence = Array.isArray(input?.candidateEvidence) ? input.candidateEvidence : [];
  const candidateBuilt = evidenceByTask(candidateEvidence, tasks, 'ORIGIN');
  buildErrors.push(...candidateBuilt.errors);
  const candidateEvidencePassed = candidateBuilt.complete;
  if (!candidateEvidencePassed) blockers.push('GENERAL_AGENT_CANDIDATE_TRUSTED_EVIDENCE_INVALID');

  const references = Array.isArray(input?.references) ? input.references : [];
  if (references.length < 2) blockers.push('GENERAL_AGENT_TRUSTED_REFERENCES_LT_2');

  const referenceNames = references.map(reference =>
    typeof reference?.participant === 'string' ? reference.participant.trim().toLowerCase() : '');
  if (new Set(referenceNames).size !== references.length || referenceNames.some(name => !name)) {
    blockers.push('GENERAL_AGENT_TRUSTED_REFERENCE_PARTICIPANTS_INVALID');
  }

  const summaries: GeneralAgentReferenceSummaryV2[] = [];
  let trustedReferenceEvidencePassed = Boolean(
    trustedRoundEvidencePassed
    && references.length >= 2
    && new Set(referenceNames).size === references.length
    && referenceNames.every(Boolean)
  );

  if (permissionProfileDigest) {
    for (const reference of references) {
      if (!validReferenceEnvelope(reference, permissionProfileDigest, nowMs)) {
        trustedReferenceEvidencePassed = false;
        continue;
      }
      const built = evidenceByTask(reference.runs, tasks, reference.participant);
      buildErrors.push(...built.errors);
      if (!built.complete) {
        trustedReferenceEvidencePassed = false;
        continue;
      }
      summaries.push(summarizeReference(reference.participant, tasks, built.scores));
    }
  } else {
    trustedReferenceEvidencePassed = false;
  }

  if (summaries.length !== references.length) trustedReferenceEvidencePassed = false;
  if (!trustedReferenceEvidencePassed) blockers.push('GENERAL_AGENT_TRUSTED_REFERENCE_EVIDENCE_INVALID');

  let comparison: GeneralAgentComparisonReportV2 | null = null;
  if (candidateEvidencePassed && trustedReferenceEvidencePassed) {
    comparison = evaluateGeneralAgentComparisonV2({
      version: GENERAL_AGENT_COMPARISON_VERSION_V2,
      candidateSha: input.candidateSha,
      tasks,
      candidateScores: candidateBuilt.scores,
      references: summaries,
    });
    blockers.push(...comparison.blockers);
  }

  const unique = [...new Set(blockers)];
  return {
    version: GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2,
    candidateSha: input.candidateSha,
    permissionProfileDigest,
    trustedRoundEvidencePassed,
    candidateEvidencePassed,
    trustedReferenceEvidencePassed,
    candidateScores: candidateBuilt.scores,
    comparison,
    buildErrors,
    passed: trustedRoundEvidencePassed
      && candidateEvidencePassed
      && trustedReferenceEvidencePassed
      && comparison?.passed === true
      && buildErrors.length === 0
      && unique.length === 0,
    blockers: unique,
  };
}
