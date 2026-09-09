import { beforeEach, describe, expect, it } from 'vitest';
import { assertRunExecutionBinding, bindRunApproval, clearAgentRunsForTest, digestAgentGoal, getAgentRun, registerPlannedRun, transitionRegisteredRun } from './agentRunRegistry.js';

describe('v3 plan-bound run registry', () => {
  beforeEach(() => clearAgentRunsForTest());

  it('stores only a digest of the goal and expires bounded run state', () => {
    const goal = 'private customer objective';
    const run = registerPlannedRun('run-12345678', goal, 1_000);
    expect(run).toMatchObject({ protocolVersion: 3, status: 'awaiting_approval', goalDigest: digestAgentGoal(goal) });
    expect(JSON.stringify(run)).not.toContain(goal);
    expect(getAgentRun(run.runId, 1_001)?.status).toBe('awaiting_approval');
    expect(getAgentRun(run.runId, 10 * 60 * 1000 + 1_001)).toBeNull();
  });

  it('binds one planned run to the exact approved operation digest', () => {
    registerPlannedRun('run-abcdefgh', 'build a safe artifact', 2_000);
    bindRunApproval('run-abcdefgh', 'digest-a', 2_001);
    expect(() => assertRunExecutionBinding('run-abcdefgh', 'digest-b', 2_002)).toThrow('AGENT_RUN_OPERATION_MISMATCH');
    expect(assertRunExecutionBinding('run-abcdefgh', 'digest-a', 2_003).runId).toBe('run-abcdefgh');
  });

  it('allows only truthful execution lifecycle transitions', () => {
    registerPlannedRun('run-ijklmnop', 'execute safely', 3_000);
    bindRunApproval('run-ijklmnop', 'digest-a', 3_001);
    transitionRegisteredRun('run-ijklmnop', 'running', 3_002);
    expect(() => transitionRegisteredRun('run-ijklmnop', 'completed', 3_003)).toThrow('AGENT_RUN_TRANSITION_DENIED');
    transitionRegisteredRun('run-ijklmnop', 'verifying', 3_004);
    expect(transitionRegisteredRun('run-ijklmnop', 'completed', 3_005).status).toBe('completed');
    expect(() => transitionRegisteredRun('run-ijklmnop', 'running', 3_006)).toThrow('AGENT_RUN_TRANSITION_DENIED');
  });
});
