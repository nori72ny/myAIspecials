import { describe, expect, it } from 'vitest';
import { executeToolWithPermission } from '../src/agent/toolRegistry.js';

describe('tool registry capability boundary', () => {
  it('permits only the bounded grounded-research capability with approval', async () => {
    const result = await executeToolWithPermission(
      'web_search_grounding',
      {},
      { approved: true, safetyPolicyPassed: true, costInUSD: 0 },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('A research query is required.');
  });
  it('allows a registered read tool after all gates pass', async () => {
    const result = await executeToolWithPermission('image_prompt_compiler', { prompt: 'test' }, { approved: true, safetyPolicyPassed: true, costInUSD: 0 });
    expect(result.ok).toBe(true);
  });
});
