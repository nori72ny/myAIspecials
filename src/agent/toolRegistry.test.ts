import { describe, expect, it } from 'vitest';
import { executeToolWithPermission } from './toolRegistry';

describe('toolRegistry safety boundary', () => {
  const approved = { approved: true, costInUSD: 0, safetyPolicyPassed: true };

  it('fails closed without approval', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' })).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  });

  it('blocks non-zero cost evidence even when approved', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' }, { approved: true, costInUSD: 0.01 })).rejects.toThrow('SAFETY_POLICY_BLOCKED');
  });

  it('blocks an explicit safety-policy failure', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' }, { approved: true, safetyPolicyPassed: false })).rejects.toThrow('SAFETY_POLICY_BLOCKED');
  });

  it('rejects an unknown runtime tool name', async () => {
    await expect(executeToolWithPermission('shell' as never, {}, approved)).rejects.toThrow('TOOL_NOT_REGISTERED');
  });

  it('keeps the network capability fail-closed', async () => {
    await expect(executeToolWithPermission('web_search_grounding', {}, approved)).rejects.toThrow('AGENT_CAPABILITY_DENIED');
  });

  it('permits an approved zero-cost side-effect-free operation without executing supplied code', async () => {
    const result = await executeToolWithPermission('code_interpreter', { code: 'process.env.SHOULD_NOT_EXECUTE = "1"' }, approved);
    expect(result.ok).toBe(true);
    expect(result.artifact).toContain('Sandboxed analysis');
    expect(process.env.SHOULD_NOT_EXECUTE).toBeUndefined();
  });

  it('keeps repository tools pinned to the server-owned repository root', async () => {
    const tree = await executeToolWithPermission('repository_explorer', { root: '/tmp' }, approved);
    expect(tree.ok).toBe(true);
    expect(tree.tool).toBe('repository_explorer');
    const packageFile = await executeToolWithPermission('file_reader', { root: '/tmp', path: 'package.json' }, approved);
    expect(packageFile.ok).toBe(true);
    expect(packageFile.artifact).toContain('"scripts"');
    await expect(executeToolWithPermission('file_reader', { root: '/tmp', path: '.env' }, approved)).rejects.toThrow('PROTECTED_PATH');
  });
});
