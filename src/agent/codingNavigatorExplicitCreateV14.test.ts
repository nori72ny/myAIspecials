// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCodingNavigatorV14 } from './codingNavigatorV14.js';
import type { CodingDiscoveryContext } from './codingSessionV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import { ORIGIN_OPENROUTER_FREE_MODEL, DEFAULT_ORIGIN_PROVIDER_DATA_POLICY } from '../lib/orchestration/OriginExecutionPolicy.js';

const result = (text: string): OriginProviderExecutionResult => ({
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
});

const files = ['package.json', 'src/App.tsx', 'src/status.ts'];
const env = { OPENROUTER_API_KEY: 'test-only' };

describe('V1.4 explicit exact create-only navigation', () => {
  it('derives the single absent create path without spending a provider call', async () => {
    const context: CodingDiscoveryContext = {
      goal: 'Create exactly one new file at src/agent/__origin_coding_smoke_v14__.ts with exact content:\nexport const ORIGIN_CODING_SMOKE_V14 = true;\nDo not modify any other file. Run all required verification checks.',
      files,
    };
    const execute = vi.fn();

    await expect(createCodingNavigatorV14('/repo', { env, execute })(context)).resolves.toEqual({
      editablePaths: [],
      contextPaths: [],
      creatablePaths: ['src/agent/__origin_coding_smoke_v14__.ts'],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not bypass model-assisted navigation for mixed edit/create work', async () => {
    const context: CodingDiscoveryContext = {
      goal: 'Create src/components/StatusBadge.tsx and wire it into src/App.tsx.',
      files,
    };
    const scope = {
      editablePaths: ['src/App.tsx'],
      contextPaths: ['src/status.ts'],
      creatablePaths: ['src/components/StatusBadge.tsx'],
    };
    const replies = [
      { queries: ['App'] },
      scope,
    ];
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => result(JSON.stringify(replies.shift())));

    await expect(createCodingNavigatorV14('/repo', { env, execute })(context)).resolves.toEqual(scope);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0].requiredTool?.name).toBe('submit_coding_search_plan_v14');
  });

  it('refuses the deterministic path when the named path already exists', async () => {
    const existingPath = 'src/agent/__origin_coding_smoke_v14__.ts';
    const context: CodingDiscoveryContext = {
      goal: `Create exactly one new file at ${existingPath} with exact content:\nexport const ORIGIN_CODING_SMOKE_V14 = true;\nDo not modify any other file.`,
      files: [...files, existingPath],
    };
    const scope = { editablePaths: [existingPath], contextPaths: [], creatablePaths: [] };
    const replies = [{ queries: ['ORIGIN_CODING_SMOKE_V14'] }, scope];
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest, _env: NodeJS.ProcessEnv) => result(JSON.stringify(replies.shift())));

    await expect(createCodingNavigatorV14('/repo', { env, execute })(context)).resolves.toEqual(scope);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
