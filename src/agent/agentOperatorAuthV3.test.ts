import { describe, expect, it } from 'vitest';
import {
  agentOperatorAuthorizationModeV3,
  agentOperatorConfiguredV3,
  authenticateAgentOperatorV3,
} from './agentOperatorAuthV3.js';

const approvalSecret = 'a'.repeat(48);
const operatorSecret = 'o'.repeat(48);

function requestWithAuth(value: string) {
  return { get: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${value}` : undefined } as never;
}

describe('Agent V3 operator authentication', () => {
  it('uses a dedicated operator credential when configured', () => {
    const env = {
      ORIGIN_AGENT_APPROVAL_SECRET: approvalSecret,
      ORIGIN_AGENT_OPERATOR_SECRET: operatorSecret,
    };
    expect(agentOperatorAuthorizationModeV3(env)).toBe('agent-operator');
    expect(agentOperatorConfiguredV3(env)).toBe(true);
    expect(authenticateAgentOperatorV3(requestWithAuth(operatorSecret), env)).toBe(true);
    expect(authenticateAgentOperatorV3(requestWithAuth(approvalSecret), env)).toBe(false);
  });

  it('keeps current deployments working in explicit legacy compatibility mode', () => {
    const env = { ORIGIN_AGENT_APPROVAL_SECRET: approvalSecret };
    expect(agentOperatorAuthorizationModeV3(env)).toBe('legacy-approval-compat');
    expect(agentOperatorConfiguredV3(env)).toBe(true);
    expect(authenticateAgentOperatorV3(requestWithAuth(approvalSecret), env)).toBe(true);
  });

  it('fails closed instead of falling back when a dedicated credential is malformed', () => {
    const env = {
      ORIGIN_AGENT_APPROVAL_SECRET: approvalSecret,
      ORIGIN_AGENT_OPERATOR_SECRET: 'short',
    };
    expect(agentOperatorAuthorizationModeV3(env)).toBe('unconfigured');
    expect(agentOperatorConfiguredV3(env)).toBe(false);
    expect(authenticateAgentOperatorV3(requestWithAuth(approvalSecret), env)).toBe(false);
  });

  it('rejects missing, empty, oversized, and incorrect bearer credentials', () => {
    const env = { ORIGIN_AGENT_OPERATOR_SECRET: operatorSecret };
    expect(authenticateAgentOperatorV3({ get: () => undefined } as never, env)).toBe(false);
    expect(authenticateAgentOperatorV3(requestWithAuth(''), env)).toBe(false);
    expect(authenticateAgentOperatorV3(requestWithAuth('x'.repeat(513)), env)).toBe(false);
    expect(authenticateAgentOperatorV3(requestWithAuth('x'.repeat(48)), env)).toBe(false);
  });
});
