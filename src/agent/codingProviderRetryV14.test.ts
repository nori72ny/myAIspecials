// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBoundedCodingProviderExecuteV14 } from './codingProviderRetryV14.js';
import type { OriginProviderExecutionRequest } from '../legacy/originProviderClient.js';
import { buildOriginExecutionPlan } from '../lib/orchestration/OriginExecutionPolicy.js';

const selected = buildOriginExecutionPlan(
  { goal: 'Create a fail-closed probe', taskType: 'implementation', requiresCodeChanges: true },
  { openRouterConfigured: true },
);
if (!selected.ok) throw new Error('TEST_PLAN_UNAVAILABLE');

const request: OriginProviderExecutionRequest = {
  plan: selected.plan,
  systemInstruction: 'submit one tool call',
  messages: [{ role: 'user', content: '{"goal":"probe"}' }],
};

function providerFailure(code: string) {
  return Object.assign(new Error('safe provider message'), { code });
}

describe('fail-closed Coding provider execution', () => {
  it.each([
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_TIMEOUT',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_INVALID_RESPONSE',
    'PROVIDER_REQUIRED_TOOL_TRUNCATED',
    'PROVIDER_REQUIRED_TOOL_AMBIGUOUS',
  ])('does not automatically retry %s', async code => {
    const failure = providerFailure(code);
    const execute = vi.fn().mockRejectedValue(failure);
    const observed = vi.fn();
    const alternate = vi.fn();
    const wrapped = createBoundedCodingProviderExecuteV14(execute, observed, alternate);

    await expect(wrapped(request, {})).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(alternate).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalledWith(request, code);
  });

  it('returns a successful first provider result without extra attempts', async () => {
    const result = { text: 'ok' } as never;
    const execute = vi.fn().mockResolvedValue(result);
    const wrapped = createBoundedCodingProviderExecuteV14(execute);

    await expect(wrapped(request, {})).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
