import { describe, expect, it } from 'vitest';
import { executeToolWithPermission, toolRegistry } from '../src/agent/toolRegistry.js';

describe('tool registry security boundary', () => {
  it('registers only known tools and requires approval', () => {
    expect(Object.keys(toolRegistry).sort()).toEqual([
      'code_interpreter',
      'document_generator',
      'file_reader',
      'image_prompt_compiler',
      'repository_explorer',
      'web_search_grounding',
    ]);
    expect(executeToolWithPermission('repository_explorer', {}, { approved: false })).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  });

  it('fails closed for network and non-zero cost', async () => {
    await expect(executeToolWithPermission('web_search_grounding', {}, { approved: true, safetyPolicyPassed: true, costInUSD: 0 }))
      .rejects.toThrow('AGENT_CAPABILITY_DENIED');
    await expect(executeToolWithPermission('code_interpreter', { code: '1 + 1' }, { approved: true, safetyPolicyPassed: true, costInUSD: 0.01 }))
      .rejects.toThrow('ZERO_COST_BOUNDARY_BLOCKED');
  });
});
