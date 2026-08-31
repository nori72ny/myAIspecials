import { describe, expect, it } from 'vitest';
import {
  evaluateAgentOperation,
  isRepeatedFailure,
  MAX_AGENT_TASK_STEPS,
  MAX_IDENTICAL_FAILURES,
  MAX_REPAIR_ATTEMPTS,
} from './agentContracts';

describe('Agentic Coding OS safety contract', () => {
  it('allows read-only exploration without approval', () => {
    expect(evaluateAgentOperation('read', false)).toMatchObject({ allowed: true, requiresApproval: false, risk: 'low' });
  });

  it('requires explicit intent for writes and execution', () => {
    expect(evaluateAgentOperation('write', false).allowed).toBe(false);
    expect(evaluateAgentOperation('execute', false).allowed).toBe(false);
    expect(evaluateAgentOperation('write', true).allowed).toBe(true);
    expect(evaluateAgentOperation('execute', true).allowed).toBe(true);
  });

  it('never autonomously authorizes destructive or production operations', () => {
    for (const operation of ['delete', 'production'] as const) {
      const decision = evaluateAgentOperation(operation, true);
      expect(decision).toMatchObject({ allowed: false, requiresApproval: true });
    }
  });

  it('detects repeated identical failures at the loop boundary', () => {
    expect(isRepeatedFailure(['TYPE_ERROR', 'TYPE_ERROR'], 'TYPE_ERROR')).toBe(true);
    expect(isRepeatedFailure(['TYPE_ERROR', 'BUILD_ERROR'], 'TYPE_ERROR')).toBe(false);
    expect(MAX_IDENTICAL_FAILURES).toBe(3);
  });

  it('keeps agent work and repair bounded', () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(3);
    expect(MAX_AGENT_TASK_STEPS).toBe(20);
  });
});
