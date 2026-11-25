// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Both mocks spread the real module and replace only the one
// export under control: other modules in the import graph (the
// provider client above all) read constants from the policy
// module, and a wholesale replacement would starve them.
vi.mock('../lib/orchestration/OriginExecutionPolicy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/orchestration/OriginExecutionPolicy.js')>();
  return {
    ...actual,
    buildOriginExecutionPlan: () => ({ ok: true, plan: { providerId: 'groq-free' } }),
  };
});
vi.mock('../legacy/originProviderFailover.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../legacy/originProviderFailover.js')>();
  return { ...actual, executeOriginProviderWithFailover: vi.fn() };
});

import { createAgentModelExecutor } from './agentModelCall.js';
import { executeOriginProviderWithFailover } from '../legacy/originProviderFailover.js';
import { OriginProviderError } from '../legacy/originProviderClient.js';

const failover = vi.mocked(executeOriginProviderWithFailover);

/**
 * Dispatch timing at the executor seam (D7 countermeasure A,
 * diagnosis AGENT_D7_DIAGNOSIS_2026-11-25 §6): every dispatch the
 * shared executor makes carries the route it is attributable to
 * and its measured duration, on success and on failure alike, so
 * the tools above it can account for a step's provider time. The
 * plan builder and the failover dispatcher are doubled; the
 * provider-error type is the real one, so the attempt reduction
 * runs against the real diagnostic shape.
 */
describe('createAgentModelExecutor dispatch timing (D7 countermeasure A)', () => {
  it('attaches a succeeded timing reduced from the routing evidence', async () => {
    failover.mockResolvedValue({
      text: 'answer',
      routingEvidence: { provider: 'groq-free', servedModel: 'openai/gpt-oss-120b', requestedModel: 'openai/gpt-oss-120b', strategy: 'failover', attempt: 1, fallbackUsed: false },
    } as never);
    const execute = createAgentModelExecutor({});
    const result = await execute({ instruction: 'i', userText: 'u', goal: 'g' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timing?.providerId).toBe('groq-free');
    expect(result.timing?.modelId).toBe('openai/gpt-oss-120b');
    expect(result.timing?.outcome).toBe('succeeded');
    expect(result.timing?.errorCode).toBeUndefined();
    expect(Number.isInteger(result.timing?.durationMs)).toBe(true);
    expect(result.timing?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('attaches a failed timing from the last dispatched attempt on a provider error', async () => {
    failover.mockRejectedValue(new OriginProviderError('PROVIDER_TIMEOUT', 'internal', 504, false, undefined, {
      failoverAttempts: [
        { providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b', outcome: 'availability-error', errorCode: 'PROVIDER_TIMEOUT', durationMs: 25_000, transportRequestCount: 1 },
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'skipped' },
      ],
    }));
    const execute = createAgentModelExecutor({});
    const result = await execute({ instruction: 'i', userText: 'u', goal: 'g' });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('PROVIDER_TIMEOUT');
      expect(result.timing).toMatchObject({
        providerId: 'cloudflare-workers-ai-free',
        modelId: '@cf/openai/gpt-oss-120b',
        outcome: 'failed',
        errorCode: 'PROVIDER_TIMEOUT',
      });
      expect(Number.isInteger(result.timing?.durationMs)).toBe(true);
      expect(result.timing?.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('marks an empty response as a failed timing on its serving route', async () => {
    failover.mockResolvedValue({
      text: '   ',
      routingEvidence: { provider: 'cloudflare-workers-ai-free', servedModel: '@cf/openai/gpt-oss-120b' },
    } as never);
    const execute = createAgentModelExecutor({});
    const result = await execute({ instruction: 'i', userText: 'u', goal: 'g' });
    expect(result).toMatchObject({ ok: false, code: 'PROVIDER_INVALID_RESPONSE' });
    if (result.ok) return;
    expect(result.timing).toMatchObject({
      providerId: 'cloudflare-workers-ai-free',
      modelId: '@cf/openai/gpt-oss-120b',
      outcome: 'failed',
      errorCode: 'PROVIDER_INVALID_RESPONSE',
    });
  });
});
