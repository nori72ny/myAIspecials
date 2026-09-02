import { describe, expect, it } from 'vitest';
import { agentApprovalConfigured, approvalDigest, authenticateAgentRequest, consumeApproval, issueApproval, type AgentApprovalOperation } from './agentApproval.js';

const operation: AgentApprovalOperation = { action: 'execute', toolName: 'file_writer', params: { path: 'src/example.ts', content: 'safe' } };
const secret = 'origin-agent-test-secret-with-at-least-32-bytes';

function requestWithAuth(value: string) {
  return { get: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${value}` : undefined } as never;
}

describe('agent approval security boundary', () => {
  it('fails closed when the approval secret is absent or too short', () => {
    expect(agentApprovalConfigured({})).toBe(false);
    expect(agentApprovalConfigured({ ORIGIN_AGENT_APPROVAL_SECRET: 'short' })).toBe(false);
  });

  it('uses constant-time authentication semantics and rejects wrong credentials', () => {
    const env = { ORIGIN_AGENT_APPROVAL_SECRET: secret };
    expect(authenticateAgentRequest(requestWithAuth(secret), env)).toBe(true);
    expect(authenticateAgentRequest(requestWithAuth('wrong-secret-with-at-least-32-bytes'), env)).toBe(false);
    expect(authenticateAgentRequest(requestWithAuth('', env.ORIGIN_AGENT_APPROVAL_SECRET) as never, env)).toBe(false);
  });

  it('binds approval to the exact normalized operation', () => {
    const token = issueApproval(operation, 1_000);
    expect(consumeApproval(token, operation, 1_001)).toBe(true);
    expect(consumeApproval(token, operation, 1_002)).toBe(false);

    const changed = { ...operation, params: { ...operation.params as Record<string, unknown>, content: 'changed' } };
    const token2 = issueApproval(operation, 2_000);
    expect(approvalDigest(operation)).not.toBe(approvalDigest(changed));
    expect(consumeApproval(token2, changed, 2_001)).toBe(false);
    expect(consumeApproval(token2, operation, 2_002)).toBe(true);
  });

  it('expires approvals and prevents cross-action reuse', () => {
    const token = issueApproval({ action: 'rollback', checkpointId: 'cp-1' }, 10_000);
    expect(consumeApproval(token, { action: 'rollback', checkpointId: 'cp-1' }, 130_001)).toBe(false);

    const executeToken = issueApproval(operation, 20_000);
    expect(consumeApproval(executeToken, { action: 'rollback', checkpointId: 'cp-1' }, 20_001)).toBe(false);
    expect(consumeApproval(executeToken, operation, 20_002)).toBe(true);
  });
});
