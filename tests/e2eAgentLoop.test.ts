import { describe, expect, it } from 'vitest';
import { assertAgentCompletion, runAgentEditVerifyLoop } from '../src/agent/e2eAgentLoop.js';

describe('agent edit verify loop', () => {
  it('applies, repairs, and completes after verification succeeds', async () => {
    let verified = false;
    const result = await runAgentEditVerifyLoop({
      apply: async () => undefined,
      verify: async () => verified ? { ok: true, command: 'npm run test', exitCode: 0, stderr: '' } : { ok: false, command: 'npm run test', exitCode: 1, stderr: 'TYPE_ERROR' },
      repair: async () => { verified = true; return { changed: true, diagnosis: 'fixed type' }; },
    });
    expect(result.ok).toBe(true);
    expect(() => assertAgentCompletion(result)).not.toThrow();
  });

  it('does not claim completion after exhausted repair attempts', async () => {
    const result = await runAgentEditVerifyLoop({
      apply: async () => undefined,
      verify: async () => ({ ok: false, command: 'npm run test', exitCode: 1, stderr: 'persistent' }),
      repair: async () => ({ changed: true, diagnosis: 'retry' }),
    });
    expect(result.ok).toBe(false);
    expect(() => assertAgentCompletion(result)).toThrow('AGENT_TASK_INCOMPLETE');
  });
});
