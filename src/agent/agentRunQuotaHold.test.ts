// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { advanceAgentRun, quotaRecoverySecondsFromFailureMessage, toolFailureCodeFromMessage } from './agentRunAdvancer.js';
import { quotaRecoverySecondsFromProviderError } from './agentModelCall.js';
import { analyzerProviderFailureMessage } from './agentAttachmentTools.js';
import { OriginProviderError } from '../legacy/originProviderClient.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import type { AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { canTransitionAgentRunStatus, type AgentRunRecord, type AgentRunStore } from './agentRunRecord.js';
import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

/**
 * Multitask wave 4 (design AGENT_QUOTA_HOLD_WAVE4_2026-11-25): the
 * quota watchdog's provider-stated recovery signal, carried from the
 * provider layer through the model-call adapter and the tool failure
 * message into the rate-limit hold, and the hold's coverage of both
 * model-calling steps. The §2-B foundations (floor, bounds, switch)
 * are pinned by agentRunAdvancer.test.ts; this file pins only what
 * wave 4 adds:
 * 1. A rate-limited job is held, not failed, and the hold's resume
 *    instant is the provider-stated recovery (bounded by the floor
 *    and the day cap) — the run survives in resumable form with its
 *    completed steps, remaining steps, hold reason and hold time.
 * 2. Resuming still passes the §8 flow: there is no held -> queued
 *    edge, so a stale approval can never restart execution; the
 *    resumed advance re-executes only the parked step.
 */

const OWNER = createHash('sha256').update('quota-hold-test-owner').digest('hex');
const RUN_ID = 'run-quota-hold-0001';
const DAY_MS = 24 * 60 * 60 * 1_000;

function makeConsumptionStore() {
  const consumed = new Set<string>();
  const store: AgentRunConsumptionStore = {
    consume: vi.fn(async (runId: string) => {
      if (consumed.has(runId)) return false;
      consumed.add(runId);
      return true;
    }),
  };
  return { store, consumed };
}

const okVerifier = async (artifact: string) => ({ ok: true, artifact, attempts: 0 });

async function seedRun(
  store: AgentRunStore,
  steps: Array<{ toolName: ToolName; params?: ToolParams }>,
): Promise<AgentRunRecord> {
  const created = await store.create({
    runId: RUN_ID,
    ownerBinding: OWNER,
    goal: 'Quota hold wave-4 test goal',
    status: 'queued',
    plan: steps.map((step, index) => ({
      toolName: step.toolName,
      params: step.params ?? {},
      dependsOn: index === 0 ? [] : [index - 1],
    })),
    planDigest: createHash('sha256').update(`plan:${RUN_ID}`).digest('hex'),
    stepsState: steps.map((_, index) => ({ id: `task-${index + 1}`, status: 'queued' as const, attempts: 0 })),
    expiresAt: Date.now() + DAY_MS,
  });
  if (!created) throw new Error('seed failed');
  return created;
}

const seedAnalyzerRun = (store: AgentRunStore) => seedRun(store, [
  { toolName: 'repository_explorer' },
  { toolName: 'attachment_analyzer', params: { outputKind: 'findings', chunkOffset: 0, chunkCount: 4 } },
]);

function rateLimitedTool(failingTool: ToolName, failureMessage: string) {
  return vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
    name === failingTool
      ? { ok: false, tool: name, message: failureMessage }
      : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
  ));
}

describe('quotaRecoverySecondsFromProviderError (wave 4 signal reduction)', () => {
  it('carries the error Retry-After as the recovery', () => {
    const error = new OriginProviderError('PROVIDER_RATE_LIMITED', 'internal', 429, false, 3720);
    expect(quotaRecoverySecondsFromProviderError(error)).toBe(3720);
  });

  it('reads the exhausted dimension reset from the failure diagnostic snapshot', () => {
    const error = new OriginProviderError('PROVIDER_RATE_LIMITED', 'internal', 429, false, undefined, {
      rateLimit: { limitTokens: 200_000, remainingTokens: 0, resetTokensSeconds: 5400, limitRequests: 1000, remainingRequests: 12, resetRequestsSeconds: 30 },
    });
    // Only the tokens dimension is exhausted: its 5400s reset counts,
    // the requests dimension's 30s reset does not.
    expect(quotaRecoverySecondsFromProviderError(error)).toBe(5400);
  });

  it('reads exhausted dimensions from rate-limited failover attempts only', () => {
    const error = new OriginProviderError('PROVIDER_RATE_LIMITED', 'internal', 429, false, undefined, {
      failoverAttempts: [
        {
          providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b', outcome: 'availability-error',
          errorCode: 'PROVIDER_TIMEOUT', rateLimit: { remainingRequests: 0, resetRequestsSeconds: 9999 },
        },
        {
          providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed',
          errorCode: 'PROVIDER_RATE_LIMITED', rateLimitHit: true, rateLimit: { remainingRequests: 0, resetRequestsSeconds: 1800 },
        },
      ],
    });
    // The timeout attempt's snapshot is not a rate-limit observation
    // of an exhausted quota and is ignored; the rate-limited
    // attempt's 1800s counts.
    expect(quotaRecoverySecondsFromProviderError(error)).toBe(1800);
  });

  it('takes the longest stated recovery across sources and rounds up', () => {
    const error = new OriginProviderError('PROVIDER_RATE_LIMITED', 'internal', 429, false, 90.2, {
      rateLimit: { remainingRequests: 0, resetRequestsSeconds: 45 },
    });
    expect(quotaRecoverySecondsFromProviderError(error)).toBe(91);
  });

  it('returns undefined when nothing was observed, and for non-provider errors', () => {
    expect(quotaRecoverySecondsFromProviderError(new OriginProviderError('PROVIDER_RATE_LIMITED', 'internal', 429, false))).toBeUndefined();
    expect(quotaRecoverySecondsFromProviderError(new OriginProviderError('PROVIDER_RATE_LIMITED', 'internal', 429, false, 0))).toBeUndefined();
    expect(quotaRecoverySecondsFromProviderError(new OriginProviderError('PROVIDER_RATE_LIMITED', 'internal', 429, false, undefined, {
      rateLimit: { remainingRequests: 5, resetRequestsSeconds: 600 },
    }))).toBeUndefined();
    expect(quotaRecoverySecondsFromProviderError(new Error('boom'))).toBeUndefined();
    expect(quotaRecoverySecondsFromProviderError(undefined)).toBeUndefined();
  });
});

describe('analyzerProviderFailureMessage quota-recovery parenthetical (wave 4)', () => {
  it('appends the recovery after the code when no attempts were recorded', () => {
    expect(analyzerProviderFailureMessage({ ok: false, code: 'PROVIDER_RATE_LIMITED', quotaRecoverySeconds: 3600 }))
      .toBe('PROVIDER_RATE_LIMITED (quota-recovery: 3600)');
  });

  it('appends the recovery after the attempts parenthetical, keeping the code as the leading token', () => {
    const message = analyzerProviderFailureMessage({
      ok: false,
      code: 'PROVIDER_RATE_LIMITED',
      quotaRecoverySeconds: 3600,
      providerAttempts: [
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_RATE_LIMITED', durationMs: 1200, transportRequestCount: 1 },
      ],
    });
    expect(message).toBe('PROVIDER_RATE_LIMITED (attempts: groq-free|openai/gpt-oss-120b|failed|PROVIDER_RATE_LIMITED|1200|1) (quota-recovery: 3600)');
    expect(toolFailureCodeFromMessage(message)).toBe('PROVIDER_RATE_LIMITED');
  });

  it('encodes nothing for absent, zero, negative or fractional recovery values', () => {
    expect(analyzerProviderFailureMessage({ ok: false, code: 'PROVIDER_RATE_LIMITED' })).toBe('PROVIDER_RATE_LIMITED');
    expect(analyzerProviderFailureMessage({ ok: false, code: 'PROVIDER_RATE_LIMITED', quotaRecoverySeconds: 0 })).toBe('PROVIDER_RATE_LIMITED');
    expect(analyzerProviderFailureMessage({ ok: false, code: 'PROVIDER_RATE_LIMITED', quotaRecoverySeconds: -30 })).toBe('PROVIDER_RATE_LIMITED');
    expect(analyzerProviderFailureMessage({ ok: false, code: 'PROVIDER_RATE_LIMITED', quotaRecoverySeconds: 1.5 })).toBe('PROVIDER_RATE_LIMITED');
  });
});

describe('quotaRecoverySecondsFromFailureMessage (wave 4 message reader)', () => {
  it('parses the fixed-shape parenthetical', () => {
    expect(quotaRecoverySecondsFromFailureMessage('PROVIDER_RATE_LIMITED (quota-recovery: 3600)')).toBe(3600);
    expect(quotaRecoverySecondsFromFailureMessage('PROVIDER_RATE_LIMITED (attempts: groq-free|m|failed|PROVIDER_RATE_LIMITED|1|1) (quota-recovery: 61)')).toBe(61);
  });

  it('contributes nothing for absent or malformed shapes', () => {
    expect(quotaRecoverySecondsFromFailureMessage('PROVIDER_RATE_LIMITED')).toBeUndefined();
    expect(quotaRecoverySecondsFromFailureMessage(undefined)).toBeUndefined();
    expect(quotaRecoverySecondsFromFailureMessage('PROVIDER_RATE_LIMITED (quota-recovery: abc)')).toBeUndefined();
    expect(quotaRecoverySecondsFromFailureMessage('PROVIDER_RATE_LIMITED (quota-recovery: 0)')).toBeUndefined();
    expect(quotaRecoverySecondsFromFailureMessage('PROVIDER_RATE_LIMITED (quota-recovery: -5)')).toBeUndefined();
    expect(quotaRecoverySecondsFromFailureMessage('PROVIDER_RATE_LIMITED (quota-recovery: 3600')).toBeUndefined();
    expect(quotaRecoverySecondsFromFailureMessage('PROVIDER_RATE_LIMITED (quota-recovery: 99999999999)')).toBeUndefined();
  });
});

describe('advanceAgentRun quota hold (wave 4)', () => {
  it('holds the run until the provider-stated recovery instead of the per-minute floor', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = rateLimitedTool('attachment_analyzer', 'PROVIDER_RATE_LIMITED (quota-recovery: 3600)');
    const seeded = await seedAnalyzerRun(store);
    const fixedNow = Date.now();

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true, now: () => fixedNow },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('rate_limited');
    expect(outcome).toMatchObject({ kind: 'rate_limited', retryAt: fixedNow + 3_600_000 });
    const record = await store.get(RUN_ID, OWNER);
    // Held, not failed: the completed step stays completed, the
    // parked step waits as queued with its park count, and the hold
    // carries the reason and the hold instant.
    expect(record?.status).toBe('held');
    expect(record?.hold).toEqual({
      reason: 'rate_limited',
      resumeCondition: { kind: 'at_time', at: fixedNow + 3_600_000 },
      heldSince: fixedNow,
      resumeAttempts: 0,
    });
    expect(record?.stepsState[0]).toMatchObject({ status: 'completed', attempts: 1 });
    expect(record?.stepsState[1]).toMatchObject({
      status: 'queued',
      attempts: 0,
      errorCode: 'PROVIDER_RATE_LIMITED',
      rateLimitHolds: 1,
    });
  });

  it('keeps the per-minute floor when the stated recovery is shorter', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = rateLimitedTool('attachment_analyzer', 'PROVIDER_RATE_LIMITED (quota-recovery: 5)');
    const seeded = await seedAnalyzerRun(store);
    const fixedNow = Date.now();

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true, now: () => fixedNow },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'rate_limited', retryAt: fixedNow + 60_000 });
    expect((await store.get(RUN_ID, OWNER))?.hold?.resumeCondition).toEqual({ kind: 'at_time', at: fixedNow + 60_000 });
  });

  it('caps the stated recovery at one day, the longest confirmed free window', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = rateLimitedTool('attachment_analyzer', 'PROVIDER_RATE_LIMITED (quota-recovery: 90000)');
    const seeded = await seedAnalyzerRun(store);
    const fixedNow = Date.now();

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true, now: () => fixedNow },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome).toMatchObject({ kind: 'rate_limited', retryAt: fixedNow + DAY_MS });
  });

  it('parks a rate-limited reconciler step the same way (wave 4 coverage)', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = rateLimitedTool('attachment_reconciler', 'PROVIDER_RATE_LIMITED (quota-recovery: 120)');
    const seeded = await seedRun(store, [{ toolName: 'attachment_reconciler' }]);
    const fixedNow = Date.now();

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true, now: () => fixedNow },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('rate_limited');
    expect(outcome).toMatchObject({ kind: 'rate_limited', retryAt: fixedNow + 120_000 });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('held');
    expect(record?.hold?.reason).toBe('rate_limited');
    expect(record?.stepsState[0]).toMatchObject({ status: 'queued', attempts: 0, rateLimitHolds: 1 });
  });

  it('with the switch OFF, a recovery-carrying rate limit still fails exactly as before', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    const runTool = rateLimitedTool('attachment_analyzer', 'PROVIDER_RATE_LIMITED (quota-recovery: 3600)');
    const seeded = await seedAnalyzerRun(store);

    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier },
      seeded,
      'driver-alpha-01',
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: 'PROVIDER_RATE_LIMITED' });
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('failed');
    expect(record?.hold).toBeNull();
  });

  it('resumes only through the §8 flow: no held -> queued edge, and only the parked step re-executes', async () => {
    const store = new InMemoryAgentRunStore();
    const { store: consumptionStore } = makeConsumptionStore();
    let analyzerFails = true;
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => (
      name === 'attachment_analyzer' && analyzerFails
        ? { ok: false, tool: name, message: 'PROVIDER_RATE_LIMITED (quota-recovery: 3600)' }
        : { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' }
    ));
    const seeded = await seedAnalyzerRun(store);
    const parked = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true },
      seeded,
      'driver-alpha-01',
    );
    expect(parked.kind).toBe('rate_limited');

    // The state machine itself has no held -> queued edge: execution
    // can never restart on the approval that preceded the hold.
    expect(canTransitionAgentRunStatus('held', 'queued')).toBe(false);
    expect(canTransitionAgentRunStatus('held', 'awaiting_approval')).toBe(true);
    const held = await store.get(RUN_ID, OWNER);
    if (!held) throw new Error('held record missing');
    await expect(store.transition({
      runId: RUN_ID,
      ownerBinding: OWNER,
      expectedStatus: 'held',
      expectedVersion: held.version,
      nextStatus: 'queued',
    })).rejects.toThrow('AGENT_RUN_TRANSITION_DENIED');

    // The §8 path: re-enter awaiting_approval (re-plan + fresh
    // approval happen there), then queue, then advance.
    const awaiting = await store.transition({
      runId: RUN_ID,
      ownerBinding: OWNER,
      expectedStatus: 'held',
      expectedVersion: held.version,
      nextStatus: 'awaiting_approval',
      approvalDeadlineAt: Date.now() + 10 * 60_000,
    });
    if (!awaiting) throw new Error('held -> awaiting_approval failed');
    const queued = await store.transition({
      runId: RUN_ID,
      ownerBinding: OWNER,
      expectedStatus: 'awaiting_approval',
      expectedVersion: awaiting.version,
      nextStatus: 'queued',
    });
    if (!queued) throw new Error('awaiting_approval -> queued failed');

    analyzerFails = false;
    runTool.mockClear();
    const outcome = await advanceAgentRun(
      { runStore: store, consumptionStore, runTool, verifyArtifact: okVerifier, rateLimitHoldEnabled: true },
      queued,
      'driver-alpha-02',
    );

    expect(outcome.kind).toBe('completed');
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith('attachment_analyzer', expect.anything());
    const record = await store.get(RUN_ID, OWNER);
    expect(record?.status).toBe('completed');
    expect(record?.stepsState.map((step) => step.status)).toEqual(['completed', 'completed']);
  });
});
