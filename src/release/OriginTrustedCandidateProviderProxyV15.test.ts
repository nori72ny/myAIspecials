// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
  ORIGIN_OPENROUTER_FREE_MODEL,
} from '../lib/orchestration/OriginExecutionPolicy.js';
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from '../legacy/originProviderClient.js';
import {
  createTrustedCandidateProviderBoundaryV15,
  publicTrustedProviderErrorV15,
  validateTrustedCandidateProviderRequestV15,
} from './OriginTrustedCandidateProviderProxyV15.js';

const token = 'ab'.repeat(32);
const request: OriginProviderExecutionRequest = {
  plan: {
    providerId: 'openrouter-free',
    providerLabel: 'ORIGIN free evaluator',
    modelId: ORIGIN_OPENROUTER_FREE_MODEL,
    taskType: 'implementation',
    freeOnly: true,
    estimatedCostUsd: 0,
    timeoutMs: 20_000,
    requiresOwnerApproval: false,
    reason: 'trusted evaluator',
    providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
    modelEvidence: {
      providerId: 'openrouter-free',
      verifiedAt: '2026-09-01T00:00:00.000Z',
      reviewAfter: '2026-10-01T00:00:00.000Z',
      sourceUrl: 'https://openrouter.ai/',
    },
  },
  systemInstruction: 'Return one required tool call.',
  messages: [{ role: 'user', content: '{"goal":"bounded"}' }],
  requiredTool: {
    name: 'submit_coding_proposal_v14',
    description: 'bounded test',
    parameters: { type: 'object', additionalProperties: false },
  },
};

const result: OriginProviderExecutionResult = {
  text: '{"edits":[],"creates":[]}',
  actualCostUsd: 0,
  providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
  routingEvidence: {
    requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
    servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
    strategy: 'adaptive-primary',
    provider: 'OpenRouter',
    attempt: 1,
    fallbackUsed: false,
  },
  usage: { costUsd: 0 },
};

describe('trusted exact-candidate provider boundary', () => {
  it('accepts only the fixed zero-cost implementation contract', () => {
    expect(validateTrustedCandidateProviderRequestV15(request)).toBe(request);
    expect(() => validateTrustedCandidateProviderRequestV15({
      ...request,
      plan: { ...request.plan, estimatedCostUsd: 1 },
    })).toThrow('TRUSTED_PROVIDER_POLICY_VIOLATION');
    expect(() => validateTrustedCandidateProviderRequestV15({
      ...request,
      plan: { ...request.plan, modelId: 'paid/model' },
    })).toThrow('TRUSTED_PROVIDER_POLICY_VIOLATION');
    expect(() => validateTrustedCandidateProviderRequestV15({
      ...request,
      requiredTool: undefined,
    })).toThrow('TRUSTED_PROVIDER_TOOL_INVALID');
  });

  it('requires a fixed capability token and enforces one shared request budget', async () => {
    const execute = vi.fn(async () => result);
    const boundary = createTrustedCandidateProviderBoundaryV15({ token, execute, limit: 2 });

    await expect(boundary.execute('00'.repeat(32), request)).rejects.toMatchObject({ code: 'TRUSTED_PROVIDER_UNAUTHORIZED' });
    await expect(boundary.execute(token, request)).resolves.toBe(result);
    await expect(boundary.execute(token, request)).resolves.toBe(result);
    await expect(boundary.execute(token, request)).rejects.toMatchObject({ code: 'TRUSTED_PROVIDER_BUDGET_EXHAUSTED' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('returns only stable public error codes', () => {
    expect(publicTrustedProviderErrorV15(Object.assign(new Error('secret upstream detail'), {
      code: 'PROVIDER_RATE_LIMITED',
      status: 429,
    }))).toEqual({ code: 'PROVIDER_RATE_LIMITED', status: 429 });
    expect(publicTrustedProviderErrorV15(new Error('OPENROUTER_API_KEY=should-not-leak'))).toEqual({
      code: 'TRUSTED_PROVIDER_EXECUTION_FAILED',
      status: 502,
    });
  });
});
