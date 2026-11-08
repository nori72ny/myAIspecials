import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_MAX_DELEGATED_STEPS_PER_ADVANCE,
  AGENT_RUN_QUOTA_PROVIDERS,
  addAgentRunQuotaCharge,
  agentRunQuotaHold,
  agentRunQuotaWindow,
  agentRunStepCostClass,
  agentRunStepQuotaCharge,
  evaluateAgentRunQuotaCharge,
  snapshotAgentRunQuotaUsage,
} from './agentRunQuotaGate.js';
import { normalizeAgentRunHold, type AgentRunQuotaLedger, type AgentRunRecord } from './agentRunRecord.js';
import type { ToolName } from './toolRegistry.js';

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0); // 2026-11-08T12:00:00Z
const DAY_MS = 24 * 60 * 60 * 1_000;

function recordWith(quotaLedger: AgentRunQuotaLedger, updatedAt: number): AgentRunRecord {
  return {
    runId: 'run-quota-gate-0001',
    ownerBinding: 'a'.repeat(64),
    goal: 'quota gate test',
    status: 'completed',
    plan: null,
    planDigest: null,
    stepsState: [],
    parentRunId: null,
    priority: 0,
    hold: null,
    quotaLedger,
    approvalDeadlineAt: null,
    priorResumeAttempts: null,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    expiresAt: updatedAt + 7 * DAY_MS,
  };
}

describe('agentRunQuotaGate cost classes and charges', () => {
  it('classifies every tool by the design §2.4 cost classes', () => {
    const expected: Record<ToolName, string> = {
      repository_explorer: 'local',
      file_reader: 'local',
      file_writer: 'local',
      document_generator: 'local',
      image_prompt_compiler: 'local',
      verification_runner: 'local',
      web_search_grounding: 'search',
      code_interpreter: 'delegated-job',
    };
    for (const [toolName, costClass] of Object.entries(expected)) {
      expect(agentRunStepCostClass(toolName as ToolName)).toBe(costClass);
    }
  });

  it('declares a numeric charge only for search steps', () => {
    expect(agentRunStepQuotaCharge('web_search_grounding')).toEqual({ provider: 'tavily', counter: 'credits', units: 1 });
    expect(agentRunStepQuotaCharge('code_interpreter')).toBeNull();
    expect(agentRunStepQuotaCharge('file_writer')).toBeNull();
    expect(AGENT_RUN_MAX_DELEGATED_STEPS_PER_ADVANCE).toBe(1);
  });

  it('defines only evidence-backed limits', () => {
    expect(AGENT_RUN_QUOTA_PROVIDERS.tavily?.counters.credits).toEqual({ limit: 800, window: 'utc-month' });
    expect(AGENT_RUN_QUOTA_PROVIDERS.openrouter?.counters.requests).toEqual({ limit: 50, window: 'rolling-24h' });
    expect(AGENT_RUN_QUOTA_PROVIDERS.cloudflare?.counters.neurons).toEqual({ limit: 10_000, window: 'utc-day' });
    expect(AGENT_RUN_QUOTA_PROVIDERS.groq?.counters.requests).toEqual({ limit: 1_000, window: 'rolling-24h' });
    expect(AGENT_RUN_QUOTA_PROVIDERS.groq?.counters.tokens).toEqual({ limit: 200_000, window: 'rolling-24h' });
  });
});

describe('agentRunQuotaWindow', () => {
  it('uses the UTC calendar day for cloudflare (resets 09:00 JST)', () => {
    const window = agentRunQuotaWindow('utc-day', NOW);
    expect(window.startsAt).toBe(Date.UTC(2026, 10, 8));
    expect(window.resetsAt).toBe(Date.UTC(2026, 10, 9));
    expect(new Date(window.resetsAt).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });

  it('uses the UTC calendar month for tavily', () => {
    const window = agentRunQuotaWindow('utc-month', NOW);
    expect(window.startsAt).toBe(Date.UTC(2026, 10, 1));
    expect(window.resetsAt).toBe(Date.UTC(2026, 11, 1));
  });

  it('rolls 24 hours where the reset boundary is unconfirmed', () => {
    const window = agentRunQuotaWindow('rolling-24h', NOW);
    expect(window.startsAt).toBe(NOW - DAY_MS);
  });
});

describe('snapshotAgentRunQuotaUsage', () => {
  it('sums ledgers of records updated inside each provider window', () => {
    const snapshot = snapshotAgentRunQuotaUsage([
      recordWith({ tavily: { credits: 10 } }, NOW - 60_000),
      recordWith({ tavily: { credits: 5 }, openrouter: { requests: 3 } }, NOW - 30_000),
    ], NOW);
    expect(snapshot.usage.tavily?.credits).toBe(15);
    expect(snapshot.usage.openrouter?.requests).toBe(3);
    expect(snapshot.oldestContributionAt.tavily).toBe(NOW - 60_000);
    expect(snapshot.oldestContributionAt.openrouter).toBe(NOW - 30_000);
  });

  it('excludes records whose last update predates the window', () => {
    const snapshot = snapshotAgentRunQuotaUsage([
      recordWith({ tavily: { credits: 700 } }, Date.UTC(2026, 9, 31, 23, 0, 0)),
      recordWith({ openrouter: { requests: 49 } }, NOW - 25 * 60 * 60 * 1_000),
      recordWith({ cloudflare: { neurons: 9_000 } }, Date.UTC(2026, 10, 7, 23, 0, 0)),
    ], NOW);
    expect(snapshot.usage.tavily).toBeUndefined();
    expect(snapshot.usage.openrouter).toBeUndefined();
    expect(snapshot.usage.cloudflare).toBeUndefined();
  });

  it('ignores providers and counters the gate does not define', () => {
    const snapshot = snapshotAgentRunQuotaUsage([
      recordWith({ origin: { execution_reserved: 1 }, mystery: { stuff: 42 } }, NOW),
    ], NOW);
    expect(snapshot.usage).toEqual({});
  });
});

describe('evaluateAgentRunQuotaCharge', () => {
  const charge = { provider: 'tavily', counter: 'credits', units: 1 };

  it('allows a charge that lands exactly on the limit', () => {
    const snapshot = snapshotAgentRunQuotaUsage([recordWith({ tavily: { credits: 799 } }, NOW)], NOW);
    expect(evaluateAgentRunQuotaCharge({ charge, snapshot, now: NOW })).toEqual({ allowed: true });
  });

  it('blocks a charge that exceeds the limit and names the calendar reset', () => {
    const snapshot = snapshotAgentRunQuotaUsage([recordWith({ tavily: { credits: 800 } }, NOW)], NOW);
    const decision = evaluateAgentRunQuotaCharge({ charge, snapshot, now: NOW });
    expect(decision).toEqual({
      allowed: false,
      provider: 'tavily',
      counter: 'credits',
      limit: 800,
      projected: 801,
      resetAt: Date.UTC(2026, 11, 1),
    });
  });

  it('counts charges already journaled during the same advance', () => {
    const snapshot = snapshotAgentRunQuotaUsage([recordWith({ tavily: { credits: 798 } }, NOW)], NOW);
    expect(evaluateAgentRunQuotaCharge({ charge, snapshot, sessionCharges: { tavily: { credits: 1 } }, now: NOW }))
      .toEqual({ allowed: true });
    const blocked = evaluateAgentRunQuotaCharge({ charge, snapshot, sessionCharges: { tavily: { credits: 2 } }, now: NOW });
    expect(blocked).toMatchObject({ allowed: false, projected: 801 });
  });

  it('estimates a rolling-window reset from the oldest contributing record', () => {
    const oldest = NOW - 5 * 60 * 60 * 1_000;
    const snapshot = snapshotAgentRunQuotaUsage([recordWith({ openrouter: { requests: 50 } }, oldest)], NOW);
    const decision = evaluateAgentRunQuotaCharge({
      charge: { provider: 'openrouter', counter: 'requests', units: 1 },
      snapshot,
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, provider: 'openrouter', limit: 50, projected: 51, resetAt: oldest + DAY_MS });
  });

  it('does not gate charges against undefined providers', () => {
    const snapshot = snapshotAgentRunQuotaUsage([], NOW);
    expect(evaluateAgentRunQuotaCharge({
      charge: { provider: 'unknown', counter: 'requests', units: 999_999 },
      snapshot,
      now: NOW,
    })).toEqual({ allowed: true });
  });
});

describe('agentRunQuotaHold and addAgentRunQuotaCharge', () => {
  it('builds a hold the record contract accepts, bound to quota_reset', () => {
    const hold = agentRunQuotaHold(
      { allowed: false, provider: 'tavily', counter: 'credits', limit: 800, projected: 801, resetAt: Date.UTC(2026, 11, 1) },
      NOW,
    );
    expect(hold).toEqual({
      reason: 'quota_exhausted',
      resumeCondition: { kind: 'quota_reset', provider: 'tavily', resetAt: Date.UTC(2026, 11, 1) },
      heldSince: NOW,
      resumeAttempts: 0,
    });
    expect(normalizeAgentRunHold(hold, NOW)).toEqual(hold);
  });

  it('carries the resume-attempt count across hold episodes (§8.6)', () => {
    const decision = { allowed: false, provider: 'tavily', counter: 'credits', limit: 800, projected: 801, resetAt: Date.UTC(2026, 11, 1) } as const;
    // A run held for the first time (no prior episode) starts at 0; a
    // resumed run that falls back counts the failed resume.
    expect(agentRunQuotaHold(decision, NOW, null).resumeAttempts).toBe(0);
    expect(agentRunQuotaHold(decision, NOW, undefined).resumeAttempts).toBe(0);
    expect(agentRunQuotaHold(decision, NOW, 0).resumeAttempts).toBe(1);
    expect(agentRunQuotaHold(decision, NOW, 2).resumeAttempts).toBe(3);
  });

  it('accumulates charges without mutating the input ledger', () => {
    const before: AgentRunQuotaLedger = { origin: { execution_reserved: 1 } };
    const after = addAgentRunQuotaCharge(before, { provider: 'tavily', counter: 'credits', units: 1 });
    const twice = addAgentRunQuotaCharge(after, { provider: 'tavily', counter: 'credits', units: 1 });
    expect(before.tavily).toBeUndefined();
    expect(after.tavily?.credits).toBe(1);
    expect(twice.tavily?.credits).toBe(2);
    expect(twice.origin?.execution_reserved).toBe(1);
  });
});
