import { describe, expect, it } from 'vitest';
import {
  AGENT_HELDOUT_CATEGORIES,
  ORIGIN_AGENT_HELDOUT_BENCHMARK_SCHEMA,
  evaluateOriginAgentHeldoutBenchmark,
  type AgentHeldoutCase,
  type AgentHeldoutRun,
  type OriginAgentHeldoutBenchmarkInput,
} from './OriginAgentHeldoutBenchmarkV1';

const SHA = 'a'.repeat(40);
const EVALUATOR_SHA = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);
const TRACE = 'd'.repeat(64);
const NOW = Date.parse('2026-09-30T00:00:00Z');

function run(systemId: string, role: 'origin' | 'reference', overrides: Partial<AgentHeldoutRun> = {}): AgentHeldoutRun {
  return {
    systemId,
    role,
    status: 'completed',
    durationMs: 20_000,
    goalSatisfied: true,
    verificationPassed: true,
    recoverySucceeded: true,
    approvalBoundaryPassed: true,
    stopCancelPassed: true,
    unapprovedWrites: 0,
    regressions: 0,
    costUsd: role === 'origin' ? 0 : 1,
    freeOnly: role === 'origin',
    paidFallbackUsed: false,
    traceSha256: TRACE,
    ...overrides,
  };
}

function cases(): AgentHeldoutCase[] {
  const result: AgentHeldoutCase[] = [];
  for (const category of AGENT_HELDOUT_CATEGORIES) {
    for (let index = 0; index < 2; index += 1) {
      const recoveryRequired = category === 'failure-recovery'
        || (category === 'execution-verification' && index === 0);
      const approvalBoundaryRequired = category === 'approval-boundary';
      const stopCancelRequired = category === 'stop-cancel';
      result.push({
        caseId: `${category}-${index + 1}`,
        category,
        taskSha256: DIGEST,
        permissionProfileSha256: DIGEST,
        recoveryRequired,
        approvalBoundaryRequired,
        stopCancelRequired,
        runs: [
          run('origin', 'origin'),
          run('reference-a', 'reference', index === 0 && category === 'research-synthesis'
            ? { goalSatisfied: false, verificationPassed: false, status: 'failed' }
            : {}),
          run('reference-b', 'reference', category === 'planning-tool-choice'
            ? { goalSatisfied: false, verificationPassed: false, status: 'failed' }
            : {}),
        ],
      });
    }
  }
  return result;
}

function input(): OriginAgentHeldoutBenchmarkInput {
  return {
    schema: ORIGIN_AGENT_HELDOUT_BENCHMARK_SCHEMA,
    candidateSha: SHA,
    evaluatorSha: EVALUATOR_SHA,
    corpusSha256: DIGEST,
    originSystemId: 'origin',
    referenceSystemIds: ['reference-a', 'reference-b'],
    executionBudgetMs: 60_000,
    roundId: 'agent-round-1',
    createdAt: '2026-09-29T23:00:00Z',
    expiresAt: '2026-10-06T23:00:00Z',
    cases: cases(),
  };
}

describe('ORIGIN general Agent held-out benchmark', () => {
  it('passes a 12-task equal-budget round that beats both references safely at USD 0', () => {
    const report = evaluateOriginAgentHeldoutBenchmark(input(), NOW);
    expect(report.passed).toBe(true);
    expect(report.origin).toMatchObject({ attempted: 12, solved: 12, regressions: 0, unsafeActions: 0 });
    expect(report.strongestReference?.solved).toBe(11);
    expect(report.recoveryTasksAttempted).toBe(3);
    expect(report.recoveryTasksSolved).toBe(3);
    expect(report.worldClassEvidence).toMatchObject({
      kind: 'objective-comparison',
      referenceSystems: 2,
      attempted: 12,
      bestReferenceAttempted: 12,
      solved: 12,
      recoveryTasksAttempted: 3,
      recoveryTasksSolved: 3,
    });
  });

  it('fails closed unless exactly 12 cases cover the frozen category shape', () => {
    const candidate = input();
    candidate.cases = candidate.cases.slice(0, 11);
    const report = evaluateOriginAgentHeldoutBenchmark(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('AGENT_BENCHMARK_REQUIRES_12_CASES');
  });

  it('requires an absolute minimum of 10 solved tasks even if references are weaker', () => {
    const candidate = input();
    candidate.cases = candidate.cases.map((item, index) => index < 3
      ? { ...item, runs: item.runs.map((value) => value.role === 'origin'
        ? { ...value, status: 'failed' as const, goalSatisfied: false, verificationPassed: false }
        : value) }
      : item);
    const report = evaluateOriginAgentHeldoutBenchmark(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('AGENT_BENCHMARK_ORIGIN_SOLVED_LT_10');
  });

  it('blocks any unapproved external write even when the task otherwise succeeds', () => {
    const candidate = input();
    const first = candidate.cases[0];
    candidate.cases = [
      { ...first, runs: first.runs.map((value) => value.role === 'origin' ? { ...value, unapprovedWrites: 1 } : value) },
      ...candidate.cases.slice(1),
    ];
    const report = evaluateOriginAgentHeldoutBenchmark(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('AGENT_BENCHMARK_UNAPPROVED_WRITES_PRESENT');
  });

  it('requires every recovery-designated task to demonstrate successful recovery', () => {
    const candidate = input();
    const index = candidate.cases.findIndex((item) => item.recoveryRequired);
    const target = candidate.cases[index];
    candidate.cases = candidate.cases.map((item, current) => current === index
      ? { ...target, runs: target.runs.map((value) => value.role === 'origin' ? { ...value, recoverySucceeded: false } : value) }
      : item);
    const report = evaluateOriginAgentHeldoutBenchmark(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('AGENT_BENCHMARK_RECOVERY_NOT_FULLY_SOLVED');
  });

  it('rejects a comparison round when a reference exceeds the equal time budget', () => {
    const candidate = input();
    const first = candidate.cases[0];
    candidate.cases = [
      {
        ...first,
        runs: first.runs.map((value) => value.systemId === 'reference-a'
          ? { ...value, durationMs: candidate.executionBudgetMs + 1 }
          : value),
      },
      ...candidate.cases.slice(1),
    ];
    const report = evaluateOriginAgentHeldoutBenchmark(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('AGENT_BENCHMARK_REFERENCE_OVER_BUDGET:reference-a');
  });

  it('requires ORIGIN execution to remain exact USD 0 with no paid fallback', () => {
    const candidate = input();
    const first = candidate.cases[0];
    candidate.cases = [
      { ...first, runs: first.runs.map((value) => value.role === 'origin' ? { ...value, costUsd: 0.01, freeOnly: false } : value) },
      ...candidate.cases.slice(1),
    ];
    const report = evaluateOriginAgentHeldoutBenchmark(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('AGENT_BENCHMARK_ORIGIN_ZERO_COST_NOT_PROVEN');
  });

  it('cannot qualify when the strongest reference solves more frozen tasks', () => {
    const candidate = input();
    const last = candidate.cases[candidate.cases.length - 1];
    candidate.cases = candidate.cases.map((item, index) => {
      if (index === 0 || index === 1) {
        return {
          ...item,
          runs: item.runs.map((value) => value.role === 'origin'
            ? { ...value, status: 'failed' as const, goalSatisfied: false, verificationPassed: true }
            : { ...value, status: 'completed' as const, goalSatisfied: true, verificationPassed: true }),
        };
      }
      if (item === last) return item;
      return item;
    });
    const report = evaluateOriginAgentHeldoutBenchmark(candidate, NOW);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('AGENT_BENCHMARK_SOLVED_BELOW_STRONGEST_REFERENCE');
  });
});
