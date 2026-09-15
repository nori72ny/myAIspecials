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

function providerFailure(code: string) {
  return Object.assign(new Error('safe provider message'), { code });
}

function truncated() {
  return providerFailure('PROVIDER_REQUIRED_TOOL_TRUNCATED');
}

describe('bounded Coding provider retry', () => {
  it('can recover two truncated required-tool responses for one trusted request', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(truncated())
      .mockRejectedValueOnce(truncated())
      .mockResolvedValueOnce(result);
    const observed = vi.fn();
    const wrapped = createBoundedCodingProviderExecuteV14(execute, observed);

    await expect(wrapped(request, { OPENROUTER_API_KEY: 'test-only' })).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[1][0]).toBe(request);
    expect(execute.mock.calls[2][0]).toBe(request);
    expect(observed).toHaveBeenCalledTimes(2);
  });

  it.each([
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_TIMEOUT',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_INVALID_RESPONSE',
  ])('retries one transient %s failure with the exact same trusted request', async code => {
    const execute = vi.fn()
      .mockRejectedValueOnce(providerFailure(code))
      .mockResolvedValueOnce(result);
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, { OPENROUTER_API_KEY: 'test-only' })).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toBe(request);
  });

  it('retries an ambiguous required-tool response only when a required tool is present', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(providerFailure('PROVIDER_REQUIRED_TOOL_AMBIGUOUS'))
      .mockResolvedValueOnce(result);
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the transient retry also fails', async () => {
    const execute = vi.fn().mockRejectedValue(providerFailure('PROVIDER_RATE_LIMITED'));
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('fails closed after the bounded required-tool retry budget is exhausted', async () => {
    const execute = vi.fn().mockRejectedValue(truncated());
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).rejects.toMatchObject({ code: 'PROVIDER_REQUIRED_TOOL_TRUNCATED' });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it.each([
    'PROVIDER_INTERNAL_ERROR',
    'PROVIDER_POLICY_VIOLATION',
    'PROVIDER_COST_UNVERIFIED',
    'PROVIDER_ROUTING_UNVERIFIED',
    'PROVIDER_NOT_CONFIGURED',
  ])('does not retry permanent or policy failure %s', async code => {
    const failure = providerFailure(code);
    const execute = vi.fn().mockRejectedValue(failure);
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    'PROVIDER_REQUIRED_TOOL_TRUNCATED',
    'PROVIDER_REQUIRED_TOOL_AMBIGUOUS',
  ])('does not retry required-tool failure %s when no required tool is present', async code => {
    const execute = vi.fn().mockRejectedValue(providerFailure(code));
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped({ ...request, requiredTool: undefined }, {})).rejects.toMatchObject({ code });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('preserves a bounded transient retry for a later repair request', async () => {
    const firstRequest = { ...request };
    const repairRequest = { ...request, messages: [{ role: 'user' as const, content: '{"goal":"repair"}' }] };
    const execute = vi.fn()
      .mockRejectedValueOnce(providerFailure('PROVIDER_RATE_LIMITED'))
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(providerFailure('PROVIDER_TIMEOUT'))
      .mockResolvedValueOnce(result);
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(firstRequest, {})).resolves.toBe(result);
    await expect(wrapped(repairRequest, {})).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
