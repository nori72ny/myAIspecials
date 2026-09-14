// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBoundedCodingProviderExecuteV14 } from './codingProviderRetryV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import {
  buildOriginExecutionPlan,
  DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
  ORIGIN_OPENROUTER_FREE_MODEL,
} from '../lib/orchestration/OriginExecutionPolicy.js';

const selected = buildOriginExecutionPlan(
  { goal: 'Create a bounded probe', taskType: 'implementation', requiresCodeChanges: true },
  { openRouterConfigured: true },
);
if (!selected.ok) throw new Error('TEST_PLAN_UNAVAILABLE');

const request: OriginProviderExecutionRequest = {
  plan: selected.plan,
  systemInstruction: 'submit one tool call',
  messages: [{ role: 'user', content: '{"goal":"probe"}' }],
  requiredTool: {
    name: 'submit_coding_proposal_v14',
    description: 'test tool',
    parameters: { type: 'object', additionalProperties: false },
  },
};

const result: OriginProviderExecutionResult = {
  text: '{"creates":[]}',
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

function truncated() {
  return Object.assign(new Error('safe provider message'), { code: 'PROVIDER_REQUIRED_TOOL_TRUNCATED' });
}

describe('bounded Coding provider retry', () => {
  it('retries one truncated required-tool response with the exact same request', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(truncated())
      .mockResolvedValueOnce(result);
    const observed = vi.fn();
    const wrapped = createBoundedCodingProviderExecuteV14(execute, observed);

    await expect(wrapped(request, { OPENROUTER_API_KEY: 'test-only' })).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toBe(request);
    expect(observed).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the one retry is also truncated', async () => {
    const execute = vi.fn().mockRejectedValue(truncated());
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).rejects.toMatchObject({ code: 'PROVIDER_REQUIRED_TOOL_TRUNCATED' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry other provider failures', async () => {
    const failure = Object.assign(new Error('safe provider message'), { code: 'PROVIDER_INTERNAL_ERROR' });
    const execute = vi.fn().mockRejectedValue(failure);
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry truncation when no required tool is present', async () => {
    const execute = vi.fn().mockRejectedValue(truncated());
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped({ ...request, requiredTool: undefined }, {})).rejects.toMatchObject({ code: 'PROVIDER_REQUIRED_TOOL_TRUNCATED' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('allows only one truncation retry across an entire Coding session adapter', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(truncated())
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(truncated());
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).resolves.toBe(result);
    await expect(wrapped(request, {})).rejects.toMatchObject({ code: 'PROVIDER_REQUIRED_TOOL_TRUNCATED' });
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
