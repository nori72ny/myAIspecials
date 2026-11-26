// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { agentAnalyzerCapacityAllocation, createAgentModelExecutor, failoverAttemptsFromProviderError, modelCallTimingFromDispatch, providerFailureDetailFromProviderError, servingFromRoutingEvidence } from './agentModelCall.js';
import { OriginProviderError } from '../legacy/originProviderClient.js';

describe('agentModelCall (failover-backed model executor)', () => {
  it('fails closed with the plan code when no free provider is configured', async () => {
    // No network is touched: with no provider keys at all, the shared
    // execution plan itself refuses before any provider call.
    const execute = createAgentModelExecutor({});
    await expect(execute({ instruction: 'classify', userText: 'a,b\n1,2', goal: '分類して' }))
      .resolves.toEqual({ ok: false, code: 'FREE_PROVIDER_NOT_CONFIGURED' });
  });

  it('treats an empty provider key as unconfigured', async () => {
    const execute = createAgentModelExecutor({ OPENROUTER_API_KEY: '' });
    await expect(execute({ instruction: 'x', userText: 'y', goal: 'z' }))
      .resolves.toEqual({ ok: false, code: 'FREE_PROVIDER_NOT_CONFIGURED' });
  });
});

describe('servingFromRoutingEvidence (coverage observability follow-on)', () => {
  it('reduces routing evidence to the serving route and model', () => {
    expect(servingFromRoutingEvidence({
      provider: 'groq-free', servedModel: 'openai/gpt-oss-120b', requestedModel: 'openai/gpt-oss-120b', strategy: 'failover', attempt: 3, fallbackUsed: true,
    })).toEqual({ providerId: 'groq-free', modelId: 'openai/gpt-oss-120b' });
    expect(servingFromRoutingEvidence({ provider: 'cloudflare-workers-ai-free' }))
      .toEqual({ providerId: 'cloudflare-workers-ai-free' });
  });

  it('contributes nothing for absent or malformed evidence', () => {
    expect(servingFromRoutingEvidence(undefined)).toBeUndefined();
    expect(servingFromRoutingEvidence(null)).toBeUndefined();
    expect(servingFromRoutingEvidence('groq-free')).toBeUndefined();
    expect(servingFromRoutingEvidence({ servedModel: 'openai/gpt-oss-120b' })).toBeUndefined();
    expect(servingFromRoutingEvidence({ provider: '' })).toBeUndefined();
    expect(servingFromRoutingEvidence({ provider: 42 })).toBeUndefined();
  });

  it('normalizes the production display names to the slugs the record carriers accept', () => {
    // Production routing evidence carries display names, not slugs
    // (Basel coverage diagnosis 2026-11-24): before normalization
    // the serving was rejected at the analyzer's trace entrance
    // every time, so no analyzer step ever recorded its execution.
    expect(servingFromRoutingEvidence({ provider: 'Cloudflare', servedModel: '@cf/openai/gpt-oss-120b' }))
      .toEqual({ providerId: 'cloudflare', modelId: '@cf/openai/gpt-oss-120b' });
    expect(servingFromRoutingEvidence({ provider: 'Groq', servedModel: 'openai/gpt-oss-120b' }))
      .toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' });
    expect(servingFromRoutingEvidence({ provider: 'OpenRouter' }))
      .toEqual({ providerId: 'openrouter' });
    // The slug vocabulary already in use passes through unchanged.
    expect(servingFromRoutingEvidence({ provider: 'Cloudflare Workers AI' }))
      .toEqual({ providerId: 'cloudflare-workers-ai' });
  });

  it('contributes nothing when a display name leaves no slug behind', () => {
    expect(servingFromRoutingEvidence({ provider: '!!!' })).toBeUndefined();
    expect(servingFromRoutingEvidence({ provider: '123' })).toBeUndefined();
    expect(servingFromRoutingEvidence({ provider: '   ' })).toBeUndefined();
  });
});

describe('failoverAttemptsFromProviderError (AGORA observability)', () => {
  it('returns the whitelisted attempt evidence of a provider error', () => {
    const error = new OriginProviderError('PROVIDER_TIMEOUT', 'internal', 504, false, undefined, {
      failoverAttempts: [
        { providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b', outcome: 'availability-error', errorCode: 'PROVIDER_TIMEOUT', durationMs: 25_000, transportRequestCount: 2 },
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_TIMEOUT', durationMs: 45_000, transportRequestCount: 1 },
      ],
    });
    expect(failoverAttemptsFromProviderError(error)).toEqual([
      { providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b', outcome: 'availability-error', errorCode: 'PROVIDER_TIMEOUT', durationMs: 25_000, transportRequestCount: 2 },
      { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_TIMEOUT', durationMs: 45_000, transportRequestCount: 1 },
    ]);
  });

  it('drops poisoned attempt values through the provider layer whitelist', () => {
    const error = new OriginProviderError('PROVIDER_UNAVAILABLE', 'internal', 503, false, undefined, {
      failoverAttempts: [
        {
          providerId: 'groq-free',
          modelId: 'openai/gpt-oss-120b',
          outcome: 'failed',
          errorCode: 'PROVIDER_UNAVAILABLE',
          skipReason: 'Authorization: Bearer <redacted>',
        } as never,
      ],
    });
    const attempts = failoverAttemptsFromProviderError(error);
    expect(attempts).toHaveLength(1);
    expect(JSON.stringify(attempts)).not.toContain('supersecretvalue');
    expect(attempts?.[0]?.skipReason).toBeUndefined();
  });

  it('returns undefined when no attempts were recorded, and for non-provider errors', () => {
    expect(failoverAttemptsFromProviderError(new OriginProviderError('PROVIDER_TIMEOUT', 'internal', 504, false))).toBeUndefined();
    expect(failoverAttemptsFromProviderError(new OriginProviderError('PROVIDER_TIMEOUT', 'internal', 504, false, undefined, { failoverAttempts: [] }))).toBeUndefined();
    expect(failoverAttemptsFromProviderError(new Error('boom'))).toBeUndefined();
    expect(failoverAttemptsFromProviderError(undefined)).toBeUndefined();
  });
});

describe('providerFailureDetailFromProviderError (Basel diagnosis 2026-11-26, 案C)', () => {
  it('carries the finish reason and reasoning tokens of the final failure', () => {
    // The production Basel shape: the last route's completion
    // ended at "length" with every completion token spent on
    // reasoning and an empty body. Until now the executor built
    // this diagnostic for its attempt evidence and discarded
    // exactly these fields, so the shape was invisible afterwards.
    const error = new OriginProviderError('PROVIDER_INVALID_RESPONSE', 'internal', 502, true, undefined, {
      finishReason: 'length',
      usagePromptTokens: 2_582,
      usageCompletionTokens: 2_400,
      usageReasoningTokens: 2_400,
      failoverAttempts: [
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_INVALID_RESPONSE', durationMs: 8_268, transportRequestCount: 2 },
      ],
    });
    expect(providerFailureDetailFromProviderError(error)).toEqual({
      finishReason: 'length',
      usageReasoningTokens: 2_400,
    });
  });

  it('carries either field on its own', () => {
    expect(providerFailureDetailFromProviderError(new OriginProviderError(
      'PROVIDER_INVALID_RESPONSE', 'internal', 502, true, undefined, { finishReason: 'stop' },
    ))).toEqual({ finishReason: 'stop' });
    expect(providerFailureDetailFromProviderError(new OriginProviderError(
      'PROVIDER_INVALID_RESPONSE', 'internal', 502, true, undefined, { usageReasoningTokens: 0 },
    ))).toEqual({ usageReasoningTokens: 0 });
  });

  it('drops values outside the provider layer whitelist', () => {
    const error = new OriginProviderError('PROVIDER_INVALID_RESPONSE', 'internal', 502, true, undefined, {
      finishReason: 'length\ninjected: free text',
      usageReasoningTokens: -5,
    } as never);
    expect(providerFailureDetailFromProviderError(error)).toBeUndefined();
  });

  it('returns undefined when the diagnostic carries neither field, and for non-provider errors', () => {
    expect(providerFailureDetailFromProviderError(new OriginProviderError('PROVIDER_TIMEOUT', 'internal', 504, false))).toBeUndefined();
    expect(providerFailureDetailFromProviderError(new OriginProviderError('PROVIDER_TIMEOUT', 'internal', 504, false, undefined, { transportRequestCount: 2 }))).toBeUndefined();
    expect(providerFailureDetailFromProviderError(new Error('boom'))).toBeUndefined();
    expect(providerFailureDetailFromProviderError(undefined)).toBeUndefined();
  });
});

describe('agentAnalyzerCapacityAllocation (design §2-C)', () => {
  const on = { ORIGIN_AGENT_ANALYZER_ALTERNATING_ALLOCATION_ENABLED: 'true' } as NodeJS.ProcessEnv;

  it('keeps the original D-1 hint for every call while the switch is off', () => {
    expect(agentAnalyzerCapacityAllocation(0, {})).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(1, {})).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(7, {})).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(1, { ORIGIN_AGENT_ANALYZER_ALTERNATING_ALLOCATION_ENABLED: 'TRUE' })).toBe('agent-analyzer-chunk');
  });

  it('alternates deterministically by the chunk global index while the switch is on', () => {
    expect(agentAnalyzerCapacityAllocation(0, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(1, on)).toBe('agent-analyzer-chunk-primary');
    expect(agentAnalyzerCapacityAllocation(2, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(3, on)).toBe('agent-analyzer-chunk-primary');
    expect(agentAnalyzerCapacityAllocation(36, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(37, on)).toBe('agent-analyzer-chunk-primary');
  });

  it('falls back to the D-1 hint when the index is absent or unusable', () => {
    expect(agentAnalyzerCapacityAllocation(undefined, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(-1, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(1.5, on)).toBe('agent-analyzer-chunk');
    expect(agentAnalyzerCapacityAllocation(Number.NaN, on)).toBe('agent-analyzer-chunk');
  });
});

describe('modelCallTimingFromDispatch (D7 countermeasure A)', () => {
  it('attributes a success to its serving, the duration floored to an integer', () => {
    expect(modelCallTimingFromDispatch({
      serving: { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b' },
      durationMs: 1234.7,
    })).toEqual({ providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'succeeded', durationMs: 1234 });
  });

  it('attributes an invalid response to its serving as a failure carrying the code', () => {
    expect(modelCallTimingFromDispatch({
      serving: { providerId: 'cloudflare-workers-ai-free' },
      code: 'PROVIDER_INVALID_RESPONSE',
      durationMs: 25_000,
    })).toEqual({ providerId: 'cloudflare-workers-ai-free', outcome: 'failed', errorCode: 'PROVIDER_INVALID_RESPONSE', durationMs: 25_000 });
  });

  it('attributes a provider failure to the last dispatched (non-skipped) attempt', () => {
    expect(modelCallTimingFromDispatch({
      providerAttempts: [
        { providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b', outcome: 'availability-error', errorCode: 'PROVIDER_TIMEOUT', durationMs: 25_000 },
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'skipped' },
      ],
      code: 'PROVIDER_TIMEOUT',
      durationMs: 25_100,
    })).toEqual({ providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_TIMEOUT', durationMs: 25_100 });
  });

  it('returns undefined when the dispatch has no attributable route', () => {
    expect(modelCallTimingFromDispatch({ durationMs: 10 })).toBeUndefined();
    expect(modelCallTimingFromDispatch({ providerAttempts: [], code: 'PROVIDER_UNAVAILABLE', durationMs: 10 })).toBeUndefined();
    expect(modelCallTimingFromDispatch({
      providerAttempts: [{ providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'skipped' }],
      code: 'PROVIDER_UNAVAILABLE',
      durationMs: 10,
    })).toBeUndefined();
  });

  it('clamps a negative duration to zero', () => {
    expect(modelCallTimingFromDispatch({ serving: { providerId: 'groq-free' }, durationMs: -5 })?.durationMs).toBe(0);
  });
});
