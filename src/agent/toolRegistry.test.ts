import { describe, expect, it } from 'vitest';
import { executeToolWithPermission } from './toolRegistry';

describe('toolRegistry safety boundary', () => {
  it('fails closed without approval', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' })).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  });

  it('blocks non-zero cost evidence even when approved', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' }, { approved: true, costInUSD: 0.01 })).rejects.toThrow('ZERO_COST_BOUNDARY_BLOCKED');
  });

  it('blocks an explicit safety-policy failure', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' }, { approved: true, safetyPolicyPassed: false })).rejects.toThrow('SAFETY_POLICY_BLOCKED');
  });

  it('permits an approved zero-cost side-effect-free operation', async () => {
    const result = await executeToolWithPermission('code_interpreter', { code: 'const x = 1' }, { approved: true, costInUSD: 0, safetyPolicyPassed: true });
    expect(result.ok).toBe(true);
  });
});
