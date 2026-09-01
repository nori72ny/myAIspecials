import { describe, expect, it } from 'vitest';
import { assertCanReportCompleted, canReportCompleted } from '../src/agent/taskExecutionGate.js';

describe('task execution completion gate', () => {
  it('requires actual tool execution and verification', () => {
    expect(canReportCompleted({ state: 'completed', verified: true, toolExecuted: true, repairAttempts: 0 })).toBe(true);
    expect(canReportCompleted({ state: 'completed', verified: false, toolExecuted: true, repairAttempts: 0 })).toBe(false);
    expect(() => assertCanReportCompleted({ state: 'completed', verified: false, toolExecuted: true, repairAttempts: 0 })).toThrow('AGENT_COMPLETION_GATE_BLOCKED');
  });
  it('rejects excessive repair attempts', () => {
    expect(canReportCompleted({ state: 'completed', verified: true, toolExecuted: true, repairAttempts: 4 })).toBe(false);
  });
});
