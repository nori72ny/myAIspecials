import { describe, expect, it } from 'vitest';
import { executeToolWithPermission } from './toolRegistry';

describe('toolRegistry safety boundary', () => {
  const approved = { approved: true, costInUSD: 0, safetyPolicyPassed: true };

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
    const result = await executeToolWithPermission('code_interpreter', { code: 'const x = 1' }, approved);
    expect(result.ok).toBe(true);
  });

  it('exposes repository exploration and protected file reading through the same gate', async () => {
    const tree = await executeToolWithPermission('repository_explorer', { root: process.cwd() }, approved);
    expect(tree.ok).toBe(true);
    expect(tree.tool).toBe('repository_explorer');
    const packageFile = await executeToolWithPermission('file_reader', { root: process.cwd(), path: 'package.json' }, approved);
    expect(packageFile.ok).toBe(true);
    expect(packageFile.artifact).toContain('"scripts"');
    await expect(executeToolWithPermission('file_reader', { root: process.cwd(), path: '.env' }, approved)).rejects.toThrow('PROTECTED_PATH');
  });
});
