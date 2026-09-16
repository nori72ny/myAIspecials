// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import type { CodingProviderExecuteV14 } from './codingProviderRetryV14.js';
import {
  HELD_OUT_CODING_PROVIDER_REQUEST_LIMIT_V14,
  createHeldOutCodingProviderRequestBudgetV14,
} from './heldOutCodingProviderRequestBudgetV14.js';

const request = {} as OriginProviderExecutionRequest;
const result = {} as OriginProviderExecutionResult;

describe('final held-out provider request budget', () => {
  it('shares one actual-call budget across primary and failover executors', async () => {
    const primary = vi.fn(async () => result) as CodingProviderExecuteV14;
    const failover = vi.fn(async () => result) as CodingProviderExecuteV14;
    const budget = createHeldOutCodingProviderRequestBudgetV14();
    const wrappedPrimary = budget.wrap(primary);
    const wrappedFailover = budget.wrap(failover);

    for (let index = 0; index < HELD_OUT_CODING_PROVIDER_REQUEST_LIMIT_V14 - 1; index += 1) {
      await expect(wrappedPrimary(request, {})).resolves.toBe(result);
    }
    await expect(wrappedFailover(request, {})).resolves.toBe(result);

    expect(budget.used()).toBe(HELD_OUT_CODING_PROVIDER_REQUEST_LIMIT_V14);
    expect(budget.remaining()).toBe(0);
    await expect(wrappedPrimary(request, {})).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_EXHAUSTED' });
    expect(primary).toHaveBeenCalledTimes(HELD_OUT_CODING_PROVIDER_REQUEST_LIMIT_V14 - 1);
    expect(failover).toHaveBeenCalledTimes(1);
  });

  it('counts failed upstream executions before allowing another bounded attempt', async () => {
    const failure = Object.assign(new Error('safe provider failure'), { code: 'PROVIDER_TIMEOUT' });
    const execute = vi.fn().mockRejectedValue(failure) as CodingProviderExecuteV14;
    const budget = createHeldOutCodingProviderRequestBudgetV14(2);
    const wrapped = budget.wrap(execute);

    await expect(wrapped(request, {})).rejects.toBe(failure);
    await expect(wrapped(request, {})).rejects.toBe(failure);
    await expect(wrapped(request, {})).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_EXHAUSTED' });
    expect(budget.used()).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid evaluator budgets instead of widening the reviewed maximum', () => {
    expect(() => createHeldOutCodingProviderRequestBudgetV14(0)).toThrow('HELD_OUT_PROVIDER_REQUEST_BUDGET_INVALID');
    expect(() => createHeldOutCodingProviderRequestBudgetV14(HELD_OUT_CODING_PROVIDER_REQUEST_LIMIT_V14 + 1)).toThrow('HELD_OUT_PROVIDER_REQUEST_BUDGET_INVALID');
  });
});
