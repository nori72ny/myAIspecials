// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCodingPlannerV14 } from './codingPlannerV14.js';
import { classifyCodingSessionFailureV14 } from './codingSessionFailureCodeV14.js';
import type { CodingContext } from './codingSessionV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, ORIGIN_OPENROUTER_FREE_MODEL } from '../lib/orchestration/OriginExecutionPolicy.js';

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

const editOnly: CodingContext = {
  goal: 'Repair probe',
  files: [{ path: 'src/agent/probe.ts', content: 'export const probe = false;\n', sha256: 'snapshot' }],
  editablePaths: ['src/agent/probe.ts'],
  creatablePaths: [],
  attempt: 1,
  failedChecks: ['test'],
  diagnostics: [],
};

describe('safe schema stage diagnostics', () => {
  it('preserves bounded correction while exposing only a structural stage after the final failure', async () => {
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest) => response(JSON.stringify({
      edits: [{ path: 'src/agent/probe.ts', search: 'false', replacement: 'true', explanation: 'extra' }],
    })));
    const planner = createCodingPlannerV14({ env: { OPENROUTER_API_KEY: 'test-only' }, execute });

    const error = await planner(editOnly).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('CODING_MODEL_SCHEMA_INVALID:edit-item-keys');
    expect(classifyCodingSessionFailureV14(error)).toBe('CODING_MODEL_SCHEMA_INVALID_EDIT_ITEM_KEYS');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
