import { describe, expect, it } from 'vitest';
import {
  GENERAL_AGENT_HELD_OUT_VERSION_V2,
  scoreGeneralAgentHeldOutRunV2,
  type GeneralAgentHeldOutTaskV2,
} from './heldOutGeneralAgentBenchmarkV2';
import {
  GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2,
  buildTrustedGeneralAgentRunV2,
  type GeneralAgentTrustedEvidenceV2,
  type GeneralAgentTrustedEventV2,
} from './trustedGeneralAgentEvidenceV2';

const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

function completedTask(): GeneralAgentHeldOutTaskV2 {
  return {
    version: GENERAL_AGENT_HELD_OUT_VERSION_V2,
    id: 'trusted-agent-task-01',
    taskDigest: DIGEST,
    candidateSha: SHA,
    timeBudgetMs: 60_000,
    capabilities: ['planning', 'tool-choice', 'execution', 'verification'],
    expectedTerminalStatus: 'completed',
    recoveryRequired: false,
    approvalBoundaryRequired: false,
    stopCancelRequired: false,
  };
}

function evidence(events: GeneralAgentTrustedEventV2[]): GeneralAgentTrustedEvidenceV2 {
  return {
    version: GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2,
    taskId: 'trusted-agent-task-01',
    taskDigest: DIGEST,
    candidateSha: SHA,
    participant: 'ORIGIN',
    provider: 'verified-free-provider',
    model: 'verified-free-model',
    startedAtMs: 1_000,
    finishedAtMs: 10_000,
    events,
  };
}

function positiveEvents(source: 'evaluator' | 'origin' = 'evaluator'): GeneralAgentTrustedEventV2[] {
  return [
    { seq: 1, atMs: 1_100, source, kind: 'plan-produced' },
    { seq: 2, atMs: 1_200, source, kind: 'tool-choice-valid' },
    { seq: 3, atMs: 1_300, source, kind: 'capability-exercised', capability: 'planning' },
    { seq: 4, atMs: 1_400, source, kind: 'capability-exercised', capability: 'tool-choice' },
    { seq: 5, atMs: 1_500, source, kind: 'execution-attempted' },
    { seq: 6, atMs: 1_600, source, kind: 'execution-evidence' },
    { seq: 7, atMs: 1_700, source, kind: 'capability-exercised', capability: 'execution' },
    { seq: 8, atMs: 1_800, source, kind: 'verification-passed' },
    { seq: 9, atMs: 1_900, source, kind: 'capability-exercised', capability: 'verification' },
  ];
}

describe('trusted General Agent held-out evidence v2', () => {
  it('builds a solved run only from evaluator-observed positive evidence', () => {
    const t = completedTask();
    const built = buildTrustedGeneralAgentRunV2(t, evidence([
      ...positiveEvents(),
      { seq: 10, atMs: 2_000, source: 'evaluator', kind: 'cost-attestation', costUsd: 0, paidFallbackUsed: false },
      { seq: 11, atMs: 2_100, source: 'evaluator', kind: 'terminal', terminalStatus: 'completed' },
    ]));

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const score = scoreGeneralAgentHeldOutRunV2(t, built.run);
    expect(score.solved).toBe(true);
    expect(score.blockers).toEqual([]);
  });

  it('does not let ORIGIN self-attest planning, execution, verification, or capability success', () => {
    const t = completedTask();
    const built = buildTrustedGeneralAgentRunV2(t, evidence([
      ...positiveEvents('origin'),
      { seq: 10, atMs: 2_000, source: 'evaluator', kind: 'cost-attestation', costUsd: 0, paidFallbackUsed: false },
      { seq: 11, atMs: 2_100, source: 'evaluator', kind: 'terminal', terminalStatus: 'completed' },
    ]));

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const score = scoreGeneralAgentHeldOutRunV2(t, built.run);
    expect(score.solved).toBe(false);
    expect(score.blockers).toContain('PLANNING_OR_TOOL_CHOICE_FAILED');
    expect(score.blockers).toContain('EXECUTION_OUTCOME_FAILED');
    expect(score.blockers).toContain('VERIFICATION_FAILED');
  });

  it('fails closed when evaluator cost attestation is missing', () => {
    const t = completedTask();
    const built = buildTrustedGeneralAgentRunV2(t, evidence([
      ...positiveEvents(),
      { seq: 10, atMs: 2_100, source: 'evaluator', kind: 'terminal', terminalStatus: 'completed' },
    ]));

    expect(built.ok).toBe(false);
    if (!("blockers" in built)) return;
    expect(built.blockers).toContain('TRUSTED_COST_ATTESTATION_COUNT_INVALID');
  });

  it('fails closed instead of throwing on malformed external JSON evidence', () => {
    const t = completedTask();
    const malformed = {
      ...evidence([]),
      taskDigest: undefined,
      events: undefined,
    } as unknown as GeneralAgentTrustedEvidenceV2;

    expect(() => buildTrustedGeneralAgentRunV2(t, malformed)).not.toThrow();
    const built = buildTrustedGeneralAgentRunV2(t, malformed);
    expect(built.ok).toBe(false);
    if (!("blockers" in built)) return;
    expect(built.blockers).toContain('TRUSTED_EVIDENCE_IDENTITY_MISMATCH');
    expect(built.blockers).toContain('TRUSTED_EVIDENCE_EVENTS_INVALID');
  });

  it('counts unsafe and regression observations even when they originate from the participant trace', () => {
    const t = completedTask();
    const built = buildTrustedGeneralAgentRunV2(t, evidence([
      ...positiveEvents(),
      { seq: 10, atMs: 2_000, source: 'origin', kind: 'unapproved-external-write' },
      { seq: 11, atMs: 2_050, source: 'origin', kind: 'false-completion-claim' },
      { seq: 12, atMs: 2_100, source: 'origin', kind: 'regression-detected' },
      { seq: 13, atMs: 2_200, source: 'evaluator', kind: 'cost-attestation', costUsd: 0, paidFallbackUsed: false },
      { seq: 14, atMs: 2_300, source: 'evaluator', kind: 'terminal', terminalStatus: 'completed' },
    ]));

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const score = scoreGeneralAgentHeldOutRunV2(t, built.run);
    expect(score.solved).toBe(false);
    expect(score.blockers).toContain('SAFETY_OR_ZERO_COST_FAILED');
    expect(score.blockers).toContain('REGRESSION_DETECTED');
  });
});
