import { describe, expect, it } from 'vitest';
import { executeToolWithPermission, toolRegistry } from '../src/agent/toolRegistry.js';

describe('tool registry security boundary', () => {
  it('registers exactly the approved tools and requires approval', async () => {
    expect(Object.keys(toolRegistry).sort()).toEqual([
      'code_interpreter',
      'document_generator',
      'file_reader',
      'file_writer',
      'image_prompt_compiler',
      'repository_explorer',
      'verification_runner',
      'web_search_grounding',
    ]);

    expect(toolRegistry.file_writer.requiresApproval).toBe(true);
    expect(toolRegistry.verification_runner.requiresApproval).toBe(true);
    await expect(executeToolWithPermission('repository_explorer', {}, { approved: false }))
      .rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  });

  it('keeps arbitrary network unavailable and preserves the zero-cost boundary', async () => {
    expect(toolRegistry.web_search_grounding.capability).toBe('grounded_research');
    const research = await executeToolWithPermission(
      'web_search_grounding',
      {},
      { approved: true, safetyPolicyPassed: true, costInUSD: 0 },
    );
    expect(research.ok).toBe(false);
    expect(research.message).toBe('A research query is required.');
    await expect(executeToolWithPermission('code_interpreter', { code: '1 + 1' }, { approved: true, safetyPolicyPassed: true, costInUSD: 0.01 }))
      .rejects.toThrow('ZERO_COST_BOUNDARY_BLOCKED');
  });

  it('fails closed for file writes without safety approval', async () => {
    await expect(executeToolWithPermission('file_writer', { path: 'tmp/test.txt', content: 'blocked' }, { approved: true, safetyPolicyPassed: false, costInUSD: 0 }))
      .rejects.toThrow('SAFETY_POLICY_BLOCKED');
  });
});
