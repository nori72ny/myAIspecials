import { describe, expect, it } from 'vitest';
import { executeToolWithPermission } from '../src/agent/toolRegistry.js';

describe('tool registry capability boundary', () => {
  it('denies network tools even with approval', async () => {
    await expect(executeToolWithPermission('web_search_grounding', {}, { approved: true, safetyPolicyPassed: true, costInUSD: 0 })).rejects.toThrow('AGENT_CAPABILITY_DENIED');
  });
  it('allows a registered read tool after all gates pass', async () => {
    const result = await executeToolWithPermission('image_prompt_compiler', { prompt: 'test' }, { approved: true, safetyPolicyPassed: true, costInUSD: 0 });
    expect(result.ok).toBe(true);
  });
});
