import { describe, expect, it } from 'vitest';
import { AGENT_SECURITY_POLICY, assertSafeAgentPolicy } from '../src/agent/securityPolicy.js';

describe('agent security policy', () => {
  it('keeps dangerous capabilities disabled', () => {
    expect(AGENT_SECURITY_POLICY.allowArbitraryShell).toBe(false);
    expect(AGENT_SECURITY_POLICY.allowNetworkFromSandbox).toBe(false);
    expect(AGENT_SECURITY_POLICY.allowProtectedPathWrites).toBe(false);
    expect(AGENT_SECURITY_POLICY.maxRepairAttempts).toBe(3);
    expect(() => assertSafeAgentPolicy()).not.toThrow();
  });
});
