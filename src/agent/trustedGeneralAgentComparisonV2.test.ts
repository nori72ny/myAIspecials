// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  GENERAL_AGENT_HELD_OUT_VERSION_V2,
  type GeneralAgentHeldOutTaskV2,
} from './heldOutGeneralAgentBenchmarkV2.js';
import {
  GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2,
  type GeneralAgentTrustedEvidenceV2,
  type GeneralAgentTrustedEventV2,
} from './trustedGeneralAgentEvidenceV2.js';
import {
  GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2,
  evaluateGeneralAgentTrustedComparisonV2,
  type GeneralAgentTrustedReferenceEvidenceV2,
} from './trustedGeneralAgentComparisonV2.js';

const SHA = 'a'.repeat(40);
const PERMISSION_DIGEST = 'e'.repeat(64);
const NOW = Date.parse('2026-10-01T00:00:00Z');

function task(index: number): GeneralAgentHeldOutTaskV2 {
  return {
    version: GENERAL_AGENT_HELD_OUT_VERSION_V2,
    id: `agent-task-${String(index + 1).padStart(2, '0')}`,
    taskDigest: (index + 1).toString(16).padStart(64, '0'),
    candidateSha: SHA,
    timeBudgetMs: 120_000,
    capabilities: [
      'research',
      'planning',
      'tool-choice',
      'execution',
      'verification',
      'recovery',
      'approval',
      'stop-cancel',
    ],
    expectedTerminalStatus: 'completed',
    recoveryRequired: index < 3,
    approvalBoundaryRequired: index < 2,
    stopCancelRequired: index >= 2 && index < 4,
  };
}

function evidenceFor(
  t: GeneralAgentHeldOutTaskV2,
  participant: string,
  terminalStatus: 'completed' | 'failed' = 'completed',
): GeneralAgentTrustedEvidenceV2 {
  const events: GeneralAgentTrustedEventV2[] = [];
  let seq = 0;
  let atMs = 1_000;
  const push = (event: Omit<GeneralAgentTrustedEventV2, 'seq' | 'atMs'>) => {
    seq += 1;
    atMs += 100;
    events.push({ seq, atMs, ...event });
  };

  push({ source: 'evaluator', kind: 'plan-produced' });
  push({ source: 'evaluator', kind: 'tool-choice-valid' });
  for (const capability of t.capabilities) {
    push({ source: 'evaluator', kind: 'capability-exercised', capability });
  }
  push({ source: 'evaluator', kind: 'execution-attempted' });
  push({ source: 'evaluator', kind: 'execution-evidence' });
  push({ source: 'evaluator', kind: 'verification-passed' });

  if (t.recoveryRequired) {
    push({ source: 'evaluator', kind: 'recovery-observed' });
    push({ source: 'evaluator', kind: 'execution-attempted' });
    push({ source: 'evaluator', kind: 'execution-evidence' });
    push({ source: 'evaluator', kind: 'verification-passed' });
    push({ source: 'evaluator', kind: 'recovery-succeeded' });
  }
  if (t.approvalBoundaryRequired) {
    push({ source: 'evaluator', kind: 'approval-boundary-respected' });
  }
  if (t.stopCancelRequired) {
    push({ source: 'evaluator', kind: 'stop-cancel-respected' });
  }

  push({ source: 'evaluator', kind: 'cost-attestation', costUsd: 0, paidFallbackUsed: false });
  push({ source: 'evaluator', kind: 'terminal', terminalStatus });

  return {
    version: GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2,
    taskId: t.id,
    taskDigest: t.taskDigest,
    candidateSha: SHA,
    participant,
    provider: participant === 'ORIGIN' ? 'verified-free-provider' : 'controlled-external-provider',
    model: participant === 'ORIGIN' ? 'verified-free-model' : 'controlled-reference-model',
    startedAtMs: 1_000,
    finishedAtMs: atMs + 100,
    events,
  };
}

function reference(
  participant: string,
  tasks: readonly GeneralAgentHeldOutTaskV2[],
): GeneralAgentTrustedReferenceEvidenceV2 {
  const marker = participant === 'reference-a' ? 'b' : 'c';
  return {
    source: 'controlled-external',
    independentFromCandidate: true,
    participant,
    permissionProfileDigest: PERMISSION_DIGEST,
    evidenceId: `agent-evidence:${participant}:2026-10-01`,
    artifactDigest: `sha256:${marker.repeat(64)}`,
    createdAt: '2026-09-30T00:00:00.000Z',
    expiresAt: '2026-10-15T00:00:00.000Z',
    runs: tasks.map(t => evidenceFor(t, participant)),
  };
}

function input() {
  const tasks = Array.from({ length: 12 }, (_, index) => task(index));
  return {
    version: GENERAL_AGENT_TRUSTED_COMPARISON_VERSION_V2,
    candidateSha: SHA,
    tasks,
    roundEvidence: {
      source: 'evaluator' as const,
      evaluatorId: 'independent-agent-evaluator-v1',
      permissionProfileDigest: PERMISSION_DIGEST,
      evidenceId: 'agent-round-evidence:2026-10-01',
      artifactDigest: `sha256:${'d'.repeat(64)}`,
      createdAt: '2026-09-30T00:00:00.000Z',
      expiresAt: '2026-10-15T00:00:00.000Z',
    },
    candidateEvidence: tasks.map(t => evidenceFor(t, 'ORIGIN')),
    references: [
      reference('reference-a', tasks),
      reference('reference-b', tasks),
    ],
  } as const;
}

describe('trusted General Agent multi-reference comparison', () => {
  it('passes when candidate and >=2 references are rebuilt from the same evaluator-owned task evidence', () => {
    const report = evaluateGeneralAgentTrustedComparisonV2(input(), NOW);
    expect(report.passed).toBe(true);
    expect(report.trustedRoundEvidencePassed).toBe(true);
    expect(report.candidateEvidencePassed).toBe(true);
    expect(report.trustedReferenceEvidencePassed).toBe(true);
    expect(report.comparison?.attempted).toBe(12);
    expect(report.comparison?.solved).toBe(12);
    expect(report.comparison?.strongestReference?.solved).toBe(12);
    expect(report.buildErrors).toEqual([]);
    expect(report.blockers).toEqual([]);
  });

  it('fails when a reference uses a different permission profile', () => {
    const value = input();
    const references = [...value.references];
    references[0] = { ...references[0], permissionProfileDigest: 'f'.repeat(64) };
    const report = evaluateGeneralAgentTrustedComparisonV2({ ...value, references }, NOW);
    expect(report.passed).toBe(false);
    expect(report.trustedReferenceEvidencePassed).toBe(false);
    expect(report.blockers).toContain('GENERAL_AGENT_TRUSTED_REFERENCE_EVIDENCE_INVALID');
  });

  it('fails when a reference task digest is substituted', () => {
    const value = input();
    const references = [...value.references];
    const runs = [...references[0].runs];
    runs[0] = { ...runs[0], taskDigest: 'f'.repeat(64) };
    references[0] = { ...references[0], runs };
    const report = evaluateGeneralAgentTrustedComparisonV2({ ...value, references }, NOW);
    expect(report.passed).toBe(false);
    expect(report.trustedReferenceEvidencePassed).toBe(false);
    expect(report.buildErrors.some(error =>
      error.blockers.includes('TRUSTED_EVIDENCE_IDENTITY_MISMATCH'))).toBe(true);
  });

  it('fails when controlled external reference evidence has expired', () => {
    const value = input();
    const references = [...value.references];
    references[0] = { ...references[0], expiresAt: '2026-09-30T12:00:00.000Z' };
    const report = evaluateGeneralAgentTrustedComparisonV2({ ...value, references }, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('GENERAL_AGENT_TRUSTED_REFERENCE_EVIDENCE_INVALID');
  });

  it('fails closed when one ORIGIN task is missing trusted evidence', () => {
    const value = input();
    const report = evaluateGeneralAgentTrustedComparisonV2({
      ...value,
      candidateEvidence: value.candidateEvidence.slice(1),
    }, NOW);
    expect(report.passed).toBe(false);
    expect(report.candidateEvidencePassed).toBe(false);
    expect(report.blockers).toContain('GENERAL_AGENT_CANDIDATE_TRUSTED_EVIDENCE_INVALID');
  });

  it('reports underperformance when ORIGIN completes fewer exact tasks than a trusted reference', () => {
    const value = input();
    const candidateEvidence = [...value.candidateEvidence];
    candidateEvidence[10] = evidenceFor(value.tasks[10], 'ORIGIN', 'failed');
    candidateEvidence[11] = evidenceFor(value.tasks[11], 'ORIGIN', 'failed');
    const report = evaluateGeneralAgentTrustedComparisonV2({
      ...value,
      candidateEvidence,
    }, NOW);
    expect(report.passed).toBe(false);
    expect(report.candidateEvidencePassed).toBe(true);
    expect(report.comparison?.blockers).toContain('SOLVED_BELOW_STRONGEST_REFERENCE');
  });
});
