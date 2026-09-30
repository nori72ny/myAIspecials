import {
  GENERAL_AGENT_CAPABILITIES_V2,
  GENERAL_AGENT_HELD_OUT_VERSION_V2,
  validateGeneralAgentTaskV2,
  type GeneralAgentCapabilityV2,
  type GeneralAgentHeldOutRunV2,
  type GeneralAgentHeldOutTaskV2,
  type GeneralAgentTerminalV2,
} from './heldOutGeneralAgentBenchmarkV2';

export const GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2 = 'origin.general-agent-trusted-evidence.v1' as const;

export const GENERAL_AGENT_TRUSTED_EVENT_KINDS_V2 = [
  'plan-produced',
  'tool-choice-valid',
  'execution-attempted',
  'execution-evidence',
  'verification-passed',
  'recovery-observed',
  'recovery-succeeded',
  'approval-boundary-respected',
  'stop-cancel-respected',
  'capability-exercised',
  'terminal',
  'cost-attestation',
  'unapproved-external-write',
  'false-completion-claim',
  'regression-detected',
] as const;

export type GeneralAgentTrustedEventKindV2 = (typeof GENERAL_AGENT_TRUSTED_EVENT_KINDS_V2)[number];
export type GeneralAgentTrustedEventSourceV2 = 'evaluator' | 'origin';

export type GeneralAgentTrustedEventV2 = {
  seq: number;
  atMs: number;
  source: GeneralAgentTrustedEventSourceV2;
  kind: GeneralAgentTrustedEventKindV2;
  capability?: GeneralAgentCapabilityV2;
  terminalStatus?: GeneralAgentTerminalV2;
  costUsd?: number;
  paidFallbackUsed?: boolean;
};

export type GeneralAgentTrustedEvidenceV2 = {
  version: typeof GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2;
  taskId: string;
  taskDigest: string;
  candidateSha: string;
  participant: string;
  provider: string;
  model: string;
  startedAtMs: number;
  finishedAtMs: number;
  events: readonly GeneralAgentTrustedEventV2[];
};

export type GeneralAgentTrustedEvidenceBuildV2 =
  | { ok: true; run: GeneralAgentHeldOutRunV2 }
  | { ok: false; blockers: readonly string[] };

const TERMINAL_STATUSES = new Set<GeneralAgentTerminalV2>([
  'completed',
  'cancelled',
  'blocked',
  'failed',
  'timed_out',
]);

function isCapability(value: unknown): value is GeneralAgentCapabilityV2 {
  return typeof value === 'string'
    && (GENERAL_AGENT_CAPABILITIES_V2 as readonly string[]).includes(value);
}

function isTrustedKind(value: unknown): value is GeneralAgentTrustedEventKindV2 {
  return typeof value === 'string'
    && (GENERAL_AGENT_TRUSTED_EVENT_KINDS_V2 as readonly string[]).includes(value);
}

function hasEvaluatorEvent(
  events: readonly GeneralAgentTrustedEventV2[],
  kind: GeneralAgentTrustedEventKindV2,
): boolean {
  return events.some(event => event.source === 'evaluator' && event.kind === kind);
}

function validIdentityString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160;
}

export function buildTrustedGeneralAgentRunV2(
  task: GeneralAgentHeldOutTaskV2,
  evidence: GeneralAgentTrustedEvidenceV2,
): GeneralAgentTrustedEvidenceBuildV2 {
  const blockers = [...validateGeneralAgentTaskV2(task)];

  const evidenceTaskId = typeof evidence?.taskId === 'string' ? evidence.taskId : '';
  const evidenceTaskDigest = typeof evidence?.taskDigest === 'string' ? evidence.taskDigest : '';
  const evidenceCandidateSha = typeof evidence?.candidateSha === 'string' ? evidence.candidateSha : '';

  if (evidence?.version !== GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2) blockers.push('TRUSTED_EVIDENCE_VERSION_INVALID');
  if (
    evidenceTaskId !== task.id
    || evidenceTaskDigest.toLowerCase() !== task.taskDigest.toLowerCase()
    || evidenceCandidateSha.toLowerCase() !== task.candidateSha.toLowerCase()
  ) {
    blockers.push('TRUSTED_EVIDENCE_IDENTITY_MISMATCH');
  }

  if (![evidence?.participant, evidence?.provider, evidence?.model].every(validIdentityString)) {
    blockers.push('TRUSTED_EVIDENCE_PARTICIPANT_INVALID');
  }

  const validTimeWindow = Number.isInteger(evidence?.startedAtMs)
    && Number.isInteger(evidence?.finishedAtMs)
    && evidence.startedAtMs >= 0
    && evidence.finishedAtMs >= evidence.startedAtMs;
  if (!validTimeWindow) blockers.push('TRUSTED_EVIDENCE_TIME_WINDOW_INVALID');

  const startedAtMs = validTimeWindow ? evidence.startedAtMs : 0;
  const finishedAtMs = validTimeWindow ? evidence.finishedAtMs : startedAtMs;
  const durationMs = finishedAtMs - startedAtMs;
  if (validTimeWindow && durationMs > task.timeBudgetMs) blockers.push('TRUSTED_EVIDENCE_TIME_BUDGET_EXCEEDED');

  const events: GeneralAgentTrustedEventV2[] = [];
  if (!Array.isArray(evidence?.events)) {
    blockers.push('TRUSTED_EVIDENCE_EVENTS_INVALID');
  } else {
    let previousSeq = 0;
    let previousAt = startedAtMs;

    for (const rawEvent of evidence.events as readonly unknown[]) {
      if (!rawEvent || typeof rawEvent !== 'object') {
        blockers.push('TRUSTED_EVENT_INVALID');
        continue;
      }

      const event = rawEvent as GeneralAgentTrustedEventV2;
      events.push(event);

      if (!Number.isInteger(event.seq) || event.seq <= previousSeq) blockers.push('TRUSTED_EVENT_SEQUENCE_INVALID');
      if (!Number.isInteger(event.atMs) || event.atMs < startedAtMs || event.atMs > finishedAtMs || event.atMs < previousAt) {
        blockers.push('TRUSTED_EVENT_TIME_INVALID');
      }
      if (!['evaluator', 'origin'].includes(event.source)) blockers.push('TRUSTED_EVENT_SOURCE_INVALID');
      if (!isTrustedKind(event.kind)) blockers.push('TRUSTED_EVENT_KIND_INVALID');
      if (event.kind === 'capability-exercised' && !isCapability(event.capability)) blockers.push('TRUSTED_EVENT_CAPABILITY_INVALID');
      if (event.kind === 'terminal' && !TERMINAL_STATUSES.has(event.terminalStatus as GeneralAgentTerminalV2)) {
        blockers.push('TRUSTED_EVENT_TERMINAL_INVALID');
      }
      if (event.kind === 'cost-attestation') {
        if (
          event.source !== 'evaluator'
          || !Number.isFinite(event.costUsd)
          || (event.costUsd ?? -1) < 0
          || typeof event.paidFallbackUsed !== 'boolean'
        ) {
          blockers.push('TRUSTED_COST_ATTESTATION_INVALID');
        }
      }

      if (Number.isInteger(event.seq)) previousSeq = event.seq;
      if (Number.isInteger(event.atMs)) previousAt = event.atMs;
    }
  }

  const evaluatorTerminals = events.filter(event => event.source === 'evaluator' && event.kind === 'terminal');
  if (evaluatorTerminals.length !== 1) blockers.push('TRUSTED_TERMINAL_ATTESTATION_COUNT_INVALID');

  const evaluatorCost = events.filter(event => event.source === 'evaluator' && event.kind === 'cost-attestation');
  if (evaluatorCost.length !== 1) blockers.push('TRUSTED_COST_ATTESTATION_COUNT_INVALID');

  if (blockers.length > 0) return { ok: false, blockers: [...new Set(blockers)] };

  const terminalStatus = evaluatorTerminals[0]?.terminalStatus as GeneralAgentTerminalV2;
  const cost = evaluatorCost[0];
  const capabilitiesExercised = [...new Set(
    events
      .filter(event => event.source === 'evaluator' && event.kind === 'capability-exercised' && isCapability(event.capability))
      .map(event => event.capability as GeneralAgentCapabilityV2),
  )];

  return {
    ok: true,
    run: {
      version: GENERAL_AGENT_HELD_OUT_VERSION_V2,
      taskId: task.id,
      taskDigest: task.taskDigest,
      candidateSha: task.candidateSha,
      participant: evidence.participant.trim(),
      provider: evidence.provider.trim(),
      model: evidence.model.trim(),
      durationMs,
      costUsd: cost?.costUsd as number,
      paidFallbackUsed: cost?.paidFallbackUsed as boolean,
      terminalStatus,
      planProduced: hasEvaluatorEvent(events, 'plan-produced'),
      toolChoiceValid: hasEvaluatorEvent(events, 'tool-choice-valid'),
      executionAttempted: hasEvaluatorEvent(events, 'execution-attempted'),
      executionEvidencePresent: hasEvaluatorEvent(events, 'execution-evidence'),
      verificationPassed: hasEvaluatorEvent(events, 'verification-passed'),
      recoveryObserved: hasEvaluatorEvent(events, 'recovery-observed'),
      recoverySucceeded: hasEvaluatorEvent(events, 'recovery-succeeded'),
      approvalBoundaryRespected: hasEvaluatorEvent(events, 'approval-boundary-respected'),
      stopCancelRespected: hasEvaluatorEvent(events, 'stop-cancel-respected'),
      unapprovedExternalWrites: events.filter(event => event.kind === 'unapproved-external-write').length,
      falseCompletionClaims: events.filter(event => event.kind === 'false-completion-claim').length,
      regressionDetected: events.some(event => event.kind === 'regression-detected'),
      capabilitiesExercised,
    },
  };
}
