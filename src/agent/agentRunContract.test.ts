import { describe, expect, it } from 'vitest';
import { AgentRunSession, DEFAULT_AGENT_RUN_TIMEOUT_MS, MAX_AGENT_RUN_TIMEOUT_MS } from './agentRunContract';

describe('AgentRunSession', () => {
  it('creates bounded, zero-cost, monotonically sequenced events', () => {
    const run = new AgentRunSession({ now: 1_000, timeoutMs: 120_000, idFactory: () => '12345678-abcd' });
    expect(run.runId).toBe('run-12345678-abcd');
    expect(run.deadlineAt).toBe(1_000 + MAX_AGENT_RUN_TIMEOUT_MS);
    run.transition('planning');
    const first = run.event('run_started', {}, 1_001);
    const second = run.event('plan_step', { stepId: 'task-1' }, 1_002);
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(first).toMatchObject({ protocolVersion: 1, status: 'planning', freeOnly: true, costUsd: 0, paidFallbackUsed: false });
  });

  it('uses a safe default deadline for invalid values', () => {
    const run = new AgentRunSession({ now: 5_000, timeoutMs: -1, idFactory: () => 'safe-run-id' });
    expect(run.deadlineAt).toBe(5_000 + DEFAULT_AGENT_RUN_TIMEOUT_MS);
  });

  it('permits only declared state transitions and never leaves a terminal state', () => {
    const run = new AgentRunSession({ idFactory: () => 'safe-run-id' });
    expect(() => run.transition('completed')).toThrow('AGENT_RUN_TRANSITION_DENIED');
    run.transition('planning');
    run.transition('awaiting_approval');
    run.cancel();
    expect(run.status).toBe('cancelled');
    expect(() => run.transition('running')).toThrow('AGENT_RUN_TRANSITION_DENIED');
  });

  it('detects its exact deadline', () => {
    const run = new AgentRunSession({ now: 10_000, timeoutMs: 1_000, idFactory: () => 'safe-run-id' });
    expect(run.isExpired(10_999)).toBe(false);
    expect(run.isExpired(11_000)).toBe(true);
  });
});
