// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createResilientCodingPlannerV14 } from './codingPlannerResilienceV14.js';
import type { CodingContext } from './codingSessionV14.js';
import type { OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, ORIGIN_OPENROUTER_FREE_MODEL } from '../lib/orchestration/OriginExecutionPolicy.js';

const context: CodingContext = {
  goal: 'Fix addition',
  files: [{ path: 'math.js', content: 'a - b', sha256: 'snapshot' }],
  editablePaths: ['math.js'],
  creatablePaths: [],
  attempt: 0,
  failedChecks: [],
  diagnostics: [],
};

function response(text: string): OriginProviderExecutionResult {
  return {
    text,
    actualCostUsd: 0,
    usage: { costUsd: 0 },
    providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
    routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      provider: 'OpenRouter',
      strategy: 'adaptive-primary',
      attempt: 1,
      fallbackUsed: false,
    },
  };
}

const invalidMatch = response(JSON.stringify({ edits: [{ path: 'math.js', search: 'invented', replacement: 'a + b' }] }));
const valid = response(JSON.stringify({ edits: [{ path: 'math.js', search: 'a - b', replacement: 'a + b' }] }));

describe('coding planner resilience', () => {
  it('performs one bounded fresh re-plan after the strict planner exhausts edit-match correction', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(invalidMatch)
      .mockResolvedValueOnce(invalidMatch)
      .mockResolvedValueOnce(valid);
    const planner = createResilientCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(context)).resolves.toEqual({
      edits: [{ path: 'math.js', search: 'a - b', replacement: 'a + b' }],
      creates: [],
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('does not re-plan unrelated planner failures', async () => {
    const failure = Object.assign(new Error('timeout'), { code: 'PROVIDER_TIMEOUT' });
    const execute = vi.fn().mockRejectedValue(failure);
    const planner = createResilientCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    await expect(planner(context)).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
