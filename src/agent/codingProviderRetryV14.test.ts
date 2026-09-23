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

describe('fail-closed Coding provider execution', () => {
  it.each([
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_INVALID_RESPONSE',
    'PROVIDER_REQUIRED_TOOL_TRUNCATED',
    'PROVIDER_REQUIRED_TOOL_AMBIGUOUS',
  ])('never repeats the same provider request after %s', async code => {
    const execute = vi.fn().mockRejectedValue(providerFailure(code));
    const alternate = vi.fn().mockResolvedValue(result);
    const observed = vi.fn();
    const wrapped = createBoundedCodingProviderExecuteV14(execute, observed, alternate);

    await expect(wrapped(request, { OPENROUTER_API_KEY: 'test-only' })).rejects.toMatchObject({ code });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(alternate).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalledTimes(1);
  });

  it.each([
    'PROVIDER_TIMEOUT',
    'PROVIDER_UNAVAILABLE',
  ])('uses one separately evidenced free-model failover without retrying the primary after %s', async code => {
    const execute = vi.fn().mockRejectedValue(providerFailure(code));
    const alternate = vi.fn().mockResolvedValue(result);
    const wrapped = createBoundedCodingProviderExecuteV14(execute, undefined, alternate);

    await expect(wrapped(request, {})).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(alternate).toHaveBeenCalledTimes(1);
    expect(alternate.mock.calls[0][0]).toBe(request);
  });

  it.each([
    'PROVIDER_INTERNAL_ERROR',
    'PROVIDER_POLICY_VIOLATION',
    'PROVIDER_COST_UNVERIFIED',
    'PROVIDER_ROUTING_UNVERIFIED',
    'PROVIDER_NOT_CONFIGURED',
  ])('fails closed immediately on permanent or policy failure %s', async code => {
    const failure = providerFailure(code);
    const execute = vi.fn().mockRejectedValue(failure);
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not use the coding failover without the required-tool implementation boundary', async () => {
    const execute = vi.fn().mockRejectedValue(providerFailure('PROVIDER_TIMEOUT'));
    const alternate = vi.fn().mockResolvedValue(result);
    const wrapped = createBoundedCodingProviderExecuteV14(execute, undefined, alternate);

    await expect(wrapped({ ...request, requiredTool: undefined }, {})).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(alternate).not.toHaveBeenCalled();
  });

  it('treats later repair requests as new requests without hidden provider retries', async () => {
    const firstRequest = { ...request };
    const repairRequest = { ...request, messages: [{ role: 'user' as const, content: '{"goal":"repair"}' }] };
    const execute = vi.fn()
      .mockRejectedValueOnce(providerFailure('PROVIDER_RATE_LIMITED'))
      .mockRejectedValueOnce(providerFailure('PROVIDER_RATE_LIMITED'));
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(firstRequest, {})).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    await expect(wrapped(repairRequest, {})).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
