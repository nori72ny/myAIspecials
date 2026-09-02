import { describe, expect, it } from 'vitest';
import { executeToolWithPermission, toolRegistry, type ToolName } from '../../src/agent/toolRegistry.js';

describe('Agent tool registry security contract', () => {
  const expectedTools: ToolName[] = [
    'code_interpreter',
    'document_generator',
    'web_search_grounding',
    'image_prompt_compiler',
    'repository_explorer',
    'file_reader',
    'file_writer',
    'verification_runner',
  ];

  it('enumerates every registered tool and requires approval', () => {
    expect(Object.keys(toolRegistry).sort()).toEqual([...expectedTools].sort());
    for (const name of expectedTools) {
      expect(toolRegistry[name].name).toBe(name);
      expect(toolRegistry[name].requiresApproval).toBe(true);
    }
  });

  it('keeps network and shell capabilities out of executable registry entries', () => {
    for (const tool of Object.values(toolRegistry)) {
      expect(tool.capability).not.toBe('shell');
      if (tool.name === 'web_search_grounding') {
        expect(tool.capability).toBe('network');
      } else {
        expect(tool.capability).not.toBe('network');
      }
    }
  });

  it('blocks execution without approval, failed safety policy, or non-zero cost', async () => {
    await expect(executeToolWithPermission('file_reader', { path: 'README.md' })).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
    await expect(executeToolWithPermission('file_reader', { path: 'README.md' }, { approved: true, safetyPolicyPassed: false })).rejects.toThrow('SAFETY_POLICY_BLOCKED');
    await expect(executeToolWithPermission('file_reader', { path: 'README.md' }, { approved: true, costInUSD: 0.000001 })).rejects.toThrow('ZERO_COST_BOUNDARY_BLOCKED');
  });

  it('fails closed for the disabled network capability', async () => {
    await expect(
      executeToolWithPermission('web_search_grounding', {}, { approved: true, costInUSD: 0 }),
    ).rejects.toThrow('AGENT_CAPABILITY_DENIED');
  });
});
