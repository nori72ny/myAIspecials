// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { agentAnalyzerCapacityAllocation, createAgentModelExecutor, failoverAttemptsFromProviderError, servingFromRoutingEvidence } from './agentModelCall.js';
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
