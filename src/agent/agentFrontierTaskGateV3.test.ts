import { describe, expect, it } from 'vitest';
import {
  AGENT_FRONTIER_TASK_GATE_VERSION_V3,
  evaluateAgentFrontierTaskGateV3,
  type AgentFrontierFamilyV3,
  type AgentFrontierTaskEvidenceV3,
} from './agentFrontierTaskGateV3.js';

const sha = 'a'.repeat(40);

function task(id: string, family: AgentFrontierFamilyV3, status: AgentFrontierTaskEvidenceV3['status'] = 'SOLVED'): AgentFrontierTaskEvidenceV3 {
  return {
    id,
    candidateSha: sha,
    family,
    status,
    verifiedTerminal: status === 'SOLVED',
    falseCompletionClaims: 0,
    p0Defects: 0,
    p1Defects: 0,
    securityPassed: true,
    costUsd: 0,
    paidFallbackUsed: false,
    elapsedMs: 1_000,
    timeBudgetMs: 60_000,
  };
}

function suite(): AgentFrontierTaskEvidenceV3[] {
  return [
    ...Array.from({ length: 12 }, (_, i) => task(`coding-${i + 1}`, 'coding-repository')),
    ...Array.from({ length: 8 }, (_, i) => task(`agent-${i + 1}`, 'agent-multi-step')),
    ...Array.from({ length: 4 }, (_, i) => task(`artifact-${i + 1}`, 'artifact-deliverable')),
  ];
}

describe('evaluateAgentFrontierTaskGateV3', () => {
  it('passes only a fully measured, verified, zero-cost 24-task suite', () => {
    const result = evaluateAgentFrontierTaskGateV3({
      version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
      candidateSha: sha,
      tasks: suite(),
    });
    expect(result.passed).toBe(true);
    expect(result.attempted).toBe(24);
    expect(result.measured).toBe(24);
    expect(result.solved).toBe(24);
    expect(result.solveRate).toBe(1);
  });

  it('treats infrastructure-not-measured as a blocker rather than a quality pass', () => {
    const tasks = suite();
    tasks[0] = task('coding-1', 'coding-repository', 'NOT_MEASURED');
    const result = evaluateAgentFrontierTaskGateV3({
      version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
      candidateSha: sha,
      tasks,
    });
    expect(result.passed).toBe(false);
    expect(result.measured).toBe(23);
    expect(result.blockers).toContain('ALL_24_TASKS_MUST_BE_MEASURED');
  });

  it('fails at 21 of 24 solved because the overall solve rate is below 90 percent', () => {
    const tasks = suite();
    tasks[0] = task('coding-1', 'coding-repository', 'UNSOLVED');
    tasks[12] = task('agent-1', 'agent-multi-step', 'UNSOLVED');
    tasks[20] = task('artifact-1', 'artifact-deliverable', 'UNSOLVED');
    const result = evaluateAgentFrontierTaskGateV3({
      version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
      candidateSha: sha,
      tasks,
    });
    expect(result.solved).toBe(21);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('OVERALL_SOLVE_RATE_BELOW_90_PERCENT');
  });

  it('requires at least 80 percent solve rate in every family', () => {
    const tasks = suite();
    tasks[20] = task('artifact-1', 'artifact-deliverable', 'UNSOLVED');
    const result = evaluateAgentFrontierTaskGateV3({
      version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
      candidateSha: sha,
      tasks,
    });
    expect(result.solveRate).toBeGreaterThan(0.9);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('FAMILY_SOLVE_RATE_BELOW_THRESHOLD:artifact-deliverable');
  });

  it('hard-fails any false completion or P0/P1 defect', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], falseCompletionClaims: 1 };
    tasks[1] = { ...tasks[1], p1Defects: 1 };
    const result = evaluateAgentFrontierTaskGateV3({
      version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
      candidateSha: sha,
      tasks,
    });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('FALSE_COMPLETION_PRESENT');
    expect(result.blockers).toContain('P1_DEFECT_PRESENT');
  });

  it('does not accept SOLVED without verified terminal evidence and exact zero-cost proof', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], verifiedTerminal: false, costUsd: 0.01 };
    const result = evaluateAgentFrontierTaskGateV3({
      version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
      candidateSha: sha,
      tasks,
    });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('ZERO_COST_GATE_FAILED');
    expect(result.blockers.some(code => code.includes('TASK_SOLVED_WITHOUT_VERIFIED_TERMINAL'))).toBe(true);
  });

  it('requires the frozen 12/8/4 family composition', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], family: 'agent-multi-step' };
    const result = evaluateAgentFrontierTaskGateV3({
      version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
      candidateSha: sha,
      tasks,
    });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('FAMILY_COUNT_INVALID:coding-repository');
    expect(result.blockers).toContain('FAMILY_COUNT_INVALID:agent-multi-step');
  });
});
