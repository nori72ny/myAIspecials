// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  executeOriginCodingFreeFailoverV14,
  ORIGIN_CODING_FREE_FAILOVER_MODEL_V14,
  ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14,
} from './codingFreeModelFailoverV14.js';
import { createBoundedCodingProviderExecuteV14 } from './codingProviderRetryV14.js';
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
import {
  buildOriginExecutionPlan,
  DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
} from '../lib/orchestration/OriginExecutionPolicy.js';

const selected = buildOriginExecutionPlan(
  { goal: 'Implement a bounded coding change', taskType: 'implementation', requiresCodeChanges: true },
  { openRouterConfigured: true },
);
if (!selected.ok) throw new Error('TEST_PLAN_UNAVAILABLE');

const request: OriginProviderExecutionRequest = {
  plan: selected.plan,
  systemInstruction: 'Use the required coding function.',
  messages: [{ role: 'user', content: '{"goal":"probe"}' }],
  requiredTool: {
    name: 'submit_coding_proposal_v14',
    description: 'Submit a bounded coding proposal.',
    parameters: { type: 'object', additionalProperties: false },
  },
};

function response(args = '{"edits":[],"creates":[]}') {
  return new Response(JSON.stringify({
    model: ORIGIN_CODING_FREE_FAILOVER_MODEL_V14,
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        tool_calls: [{ type: 'function', function: { name: request.requiredTool?.name, arguments: args } }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, cost: 0 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function failure(code: string) {
  return Object.assign(new Error('safe provider failure'), { code });
}

describe('V1.4 explicit free coding model failover', () => {
  it('keeps the failover request zero-cost, ZDR-only and required-tool constrained', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(ORIGIN_CODING_FREE_FAILOVER_MODEL_V14);
      expect(body.tools).toEqual([{ type: 'function', function: request.requiredTool }]);
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: request.requiredTool?.name } });
      expect(body.provider).toEqual({
        allow_fallbacks: false,
        data_collection: 'deny',
        zdr: true,
        max_price: { prompt: 0, completion: 0, request: 0 },
      });
      return response();
    });

    const result = await executeOriginCodingFreeFailoverV14(
      request,
      { OPENROUTER_API_KEY: 'synthetic-test-key' },
      fetchMock as unknown as typeof fetch,
      Date.parse(ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14) + 1,
    );
    expect(result.text).toBe('{"edits":[],"creates":[]}');
    expect(result.actualCostUsd).toBe(0);
    expect(result.routingEvidence).toMatchObject({
      requestedModel: ORIGIN_CODING_FREE_FAILOVER_MODEL_V14,
      fallbackUsed: true,
    });
  });

  it('fails closed on non-zero reported cost or substituted model', async () => {
    const paid = vi.fn(async () => new Response(JSON.stringify({
      model: ORIGIN_CODING_FREE_FAILOVER_MODEL_V14,
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: request.requiredTool?.name, arguments: '{}' } }] } }],
      usage: { cost: 0.001 },
    }), { status: 200 }));
    await expect(executeOriginCodingFreeFailoverV14(request, { OPENROUTER_API_KEY: 'x' }, paid as unknown as typeof fetch, Date.parse(ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14) + 1))
      .rejects.toMatchObject({ code: 'PROVIDER_POLICY_VIOLATION' });

    const substituted = vi.fn(async () => new Response(JSON.stringify({
      model: 'paid-model',
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: request.requiredTool?.name, arguments: '{}' } }] } }],
      usage: { cost: 0 },
    }), { status: 200 }));
    await expect(executeOriginCodingFreeFailoverV14(request, { OPENROUTER_API_KEY: 'x' }, substituted as unknown as typeof fetch, Date.parse(ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14) + 1))
      .rejects.toMatchObject({ code: 'PROVIDER_ROUTING_UNVERIFIED' });
  });

  it.each([
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_TIMEOUT',
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_INVALID_RESPONSE',
    'PROVIDER_REQUIRED_TOOL_TRUNCATED',
    'PROVIDER_REQUIRED_TOOL_AMBIGUOUS',
    'PROVIDER_POLICY_VIOLATION',
  ])('never performs automatic model failover after %s', async code => {
    const primary = vi.fn().mockRejectedValue(failure(code));
    const wrapped = createBoundedCodingProviderExecuteV14(primary);

    await expect(wrapped(request, {})).rejects.toMatchObject({ code });
    expect(primary).toHaveBeenCalledTimes(1);
  });

});
