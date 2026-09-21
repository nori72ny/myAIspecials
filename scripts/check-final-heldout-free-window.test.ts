// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  checkFinalHeldoutFreeWindow,
  recentProviderArtifacts,
  verifyOpenRouterFreeTier,
} from './check-final-heldout-free-window.mjs';

const nowMs = Date.parse('2026-09-22T03:00:00.000Z');

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('final held-out free-provider window', () => {
  it('accepts only a normal OpenRouter free-tier inference key', async () => {
    const fetchImpl = vi.fn(async () => response({
      data: { is_free_tier: true, is_management_key: false, is_provisioning_key: false },
    }));
    await expect(verifyOpenRouterFreeTier({ apiKey: 'synthetic', fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toEqual({ freeTier: true });

    fetchImpl.mockResolvedValueOnce(response({
      data: { is_free_tier: false, is_management_key: false, is_provisioning_key: false },
    }));
    await expect(verifyOpenRouterFreeTier({ apiKey: 'synthetic', fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toThrow('HELD_OUT_FINAL_OPENROUTER_NOT_FREE_TIER');
  });

  it('blocks recent AQ and held-out evidence artifacts but ignores old/current-run artifacts', async () => {
    const fetchImpl = vi.fn(async () => response({
      total_count: 4,
      artifacts: [
        { name: 'aq-live-quota-reservation', created_at: '2026-09-22T02:30:00.000Z', workflow_run: { id: 10 } },
        { name: 'origin-held-out-task-a-11', created_at: '2026-09-22T02:40:00.000Z', workflow_run: { id: 11 } },
        { name: 'aq-live-quota-reservation', created_at: '2026-09-22T02:50:00.000Z', workflow_run: { id: 99 } },
        { name: 'origin-held-out-task-old-12', created_at: '2026-09-20T01:00:00.000Z', workflow_run: { id: 12 } },
      ],
    }));
    const result = await recentProviderArtifacts({
      repository: 'owner/repo',
      currentRunId: '99',
      token: 'token',
      nowMs,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.map(item => item.runId)).toEqual(['10', '11']);
  });

  it('fails closed when a known provider workflow ran in the previous 24 hours', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://openrouter.ai/api/v1/key') {
        return response({ data: { is_free_tier: true, is_management_key: false, is_provisioning_key: false } });
      }
      if (url.includes('/actions/artifacts?')) return response({ total_count: 0, artifacts: [] });
      if (url.includes('coding-job-worker-v14.yml')) {
        return response({ workflow_runs: [{ id: 21, created_at: '2026-09-22T02:45:00.000Z', conclusion: 'success' }] });
      }
      if (url.includes('held-out-coding-benchmark-v14.yml')) return response({ workflow_runs: [] });
      return response({}, 404);
    });

    const result = await checkFinalHeldoutFreeWindow({
      repository: 'owner/repo',
      currentRunId: '99',
      token: 'token',
      apiKey: 'synthetic',
      nowMs,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.allowed).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.nextAllowedAt).toBe('2026-09-23T02:45:00.000Z');
  });

  it('allows the one-shot when the key is free-tier and known provider activity is clear', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://openrouter.ai/api/v1/key') {
        return response({ data: { is_free_tier: true, is_management_key: false, is_provisioning_key: false } });
      }
      if (url.includes('/actions/artifacts?')) return response({ total_count: 0, artifacts: [] });
      if (url.includes('/actions/workflows/')) return response({ workflow_runs: [] });
      return response({}, 404);
    });
    const result = await checkFinalHeldoutFreeWindow({
      repository: 'owner/repo',
      currentRunId: '99',
      token: 'token',
      apiKey: 'synthetic',
      nowMs,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result).toEqual({ allowed: true, conflicts: [], nextAllowedAt: null });
  });
});
