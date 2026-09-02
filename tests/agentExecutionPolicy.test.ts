import { describe, expect, it } from 'vitest';
import { assertCapabilityAllowed, isCapabilityAllowed } from '../src/agent/agentExecutionPolicy.js';

describe('agent execution policy', () => {
  it('allows safe capabilities with explicit intent', () => {
    expect(isCapabilityAllowed({ capability: 'read_repository', explicitIntent: false, securityPolicyPassed: true })).toBe(true);
    expect(isCapabilityAllowed({ capability: 'write_repository', explicitIntent: true, securityPolicyPassed: true })).toBe(true);
  });
  it('denies privileged or unsafe capabilities', () => {
    expect(isCapabilityAllowed({ capability: 'write_repository', explicitIntent: false, securityPolicyPassed: true })).toBe(false);
    expect(isCapabilityAllowed({ capability: 'network', explicitIntent: true, securityPolicyPassed: true })).toBe(false);
    expect(isCapabilityAllowed({ capability: 'shell', explicitIntent: true, securityPolicyPassed: true })).toBe(false);
    expect(() => assertCapabilityAllowed({ capability: 'network', explicitIntent: true, securityPolicyPassed: true })).toThrow('AGENT_CAPABILITY_DENIED');
  });
});
