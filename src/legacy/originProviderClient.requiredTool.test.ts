import { describe, expect, it, vi } from 'vitest';
import { executeOriginProvider, type OriginFetch, type OriginProviderExecutionRequest } from './originProviderClient.js';
import { ORIGIN_OPENROUTER_FREE_MODEL, type OriginExecutionPlan } from '../lib/orchestration/OriginExecutionPolicy.js';

const plan: OriginExecutionPlan = {
  providerId: 'openrouter-free',
  providerLabel: 'ORIGIN 無料AI',
  modelId: ORIGIN_OPENROUTER_FREE_MODEL,
  taskType: 'implementation',
  freeOnly: true,
  estimatedCostUsd: 0,
  timeoutMs: 20_000,
  requiresOwnerApproval: false,
  reason: 'test',
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: 'deny', requireZeroDataRetention: true },
  modelEvidence: {
    providerId: 'openrouter-free',
    verifiedAt: '2026-09-07T00:00:00.000Z',
    reviewAfter: '2026-09-17T00:00:00.000Z',
    sourceUrl: 'https://openrouter.ai/inclusionai/ling-3.0-flash-sante:free',
  },
};

const requiredTool = {
  name: 'submit_coding_proposal_v14',
  description: 'Submit a bounded coding proposal.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['edits', 'creates'],
    properties: {
      edits: { type: 'array', items: { type: 'object' } },
      creates: { type: 'array', items: { type: 'object' } },
    },
  },
};

const request: OriginProviderExecutionRequest = {
  plan,
  systemInstruction: 'Use the required proposal function.',
  messages: [{ role: 'user', content: '{"goal":"create one file"}' }],
  requiredTool,
};

function response(message: Record<string, unknown>, finish_reason = 'tool_calls') {
  return new Response(JSON.stringify({
    model: ORIGIN_OPENROUTER_FREE_MODEL,
    choices: [{ message, finish_reason }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, cost: 0 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('required OpenRouter tool contract', () => {
  it('requires one named function and returns only its arguments as provider text', async () => {
    const args = JSON.stringify({ edits: [], creates: [{ path: 'new.ts', content: 'export const ok = true;\n' }] });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.response_format).toBeUndefined();
      expect(body.tools).toEqual([{ type: 'function', function: requiredTool }]);
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: requiredTool.name } });
      expect(body.provider).toEqual({ allow_fallbacks: false, data_collection: 'deny', zdr: true, max_price: { prompt: 0, completion: 0, request: 0 } });
      return response({
        content: null,
        tool_calls: [{ type: 'function', function: { name: requiredTool.name, arguments: args } }],
      });
    });

    const result = await executeOriginProvider(request, { OPENROUTER_API_KEY: 'synthetic-test-key' }, fetchMock as unknown as OriginFetch);
    expect(result.text).toBe(args);
    expect(result.actualCostUsd).toBe(0);
    expect(result.usage.costUsd).toBe(0);
    expect(result.routingEvidence.fallbackUsed).toBe(false);
  });

  it('fails closed when a required tool request returns only prose', async () => {
    const fetchMock = vi.fn(async () => response({ content: 'Here is the proposal.' }, 'stop'));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: 'synthetic-test-key' }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed on the wrong tool or multiple tool calls', async () => {
    const args = JSON.stringify({ edits: [], creates: [{ path: 'new.ts', content: 'x' }] });
    const wrong = vi.fn(async () => response({ tool_calls: [{ type: 'function', function: { name: 'other_tool', arguments: args } }] }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: 'synthetic-test-key' }, wrong as unknown as OriginFetch))
      .rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });

    const multiple = vi.fn(async () => response({ tool_calls: [
      { type: 'function', function: { name: requiredTool.name, arguments: args } },
      { type: 'function', function: { name: requiredTool.name, arguments: args } },
    ] }));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: 'synthetic-test-key' }, multiple as unknown as OriginFetch))
      .rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });

  it('fails closed instead of continuing a truncated required tool call', async () => {
    const fetchMock = vi.fn(async () => response({
      tool_calls: [{ type: 'function', function: { name: requiredTool.name, arguments: '{"edits":[' } }],
    }, 'length'));
    await expect(executeOriginProvider(request, { OPENROUTER_API_KEY: 'synthetic-test-key' }, fetchMock as unknown as OriginFetch))
      .rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
