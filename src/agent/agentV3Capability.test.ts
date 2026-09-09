import { describe, expect, it } from 'vitest';
import { issueApprovalCapability, issuePlanCapability, verifyApprovalCapability, verifyPlanCapability } from './agentV3Capability.js';

const env = { ORIGIN_AGENT_APPROVAL_SECRET: 'v3-capability-test-secret-at-least-32-characters' };
const otherEnv = { ORIGIN_AGENT_APPROVAL_SECRET: 'different-v3-capability-secret-at-least-32-chars' };
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

describe('v3 signed capabilities', () => {
  it('verifies across independent requests without shared memory', () => {
    const issued = issuePlanCapability('run-abcdefgh', digestA, env, 1_000);
    const verified = verifyPlanCapability(issued.token, env, 2_000);
    expect(verified).toMatchObject({ v: 3, kind: 'plan', runId: 'run-abcdefgh', digest: digestA });
  });

  it('rejects tampering, another secret, and expiry', () => {
    const issued = issuePlanCapability('run-abcdefgh', digestA, env, 1_000);
    expect(verifyPlanCapability(`${issued.token}x`, env, 2_000)).toBeNull();
    expect(verifyPlanCapability(issued.token, otherEnv, 2_000)).toBeNull();
    expect(verifyPlanCapability(issued.token, env, issued.expiresAt)).toBeNull();
  });

  it('cryptographically binds approval to one run and exact operation digest', () => {
    const issued = issueApprovalCapability('run-abcdefgh', digestA, env, 5_000);
    const verified = verifyApprovalCapability(issued.token, env, 5_001);
    expect(verified?.runId).toBe('run-abcdefgh');
    expect(verified?.digest).toBe(digestA);
    expect(verified?.digest).not.toBe(digestB);
  });
});
