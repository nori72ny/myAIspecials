// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_APPROVAL_LAPSE_MS,
  AGENT_RUN_RECORD_STATUSES,
  MAX_AGENT_RUN_LIVE_QUERY_LENGTH,
  MAX_AGENT_RUN_LIVE_SOURCE_EXCERPT_LENGTH,
  MAX_AGENT_RUN_LIVE_SOURCE_TITLE_LENGTH,
  MAX_AGENT_RUN_LIVE_SOURCE_URL_LENGTH,
  MAX_AGENT_RUN_LIVE_SOURCES,
  AGENT_RUN_RATE_LIMIT_HOLD_MAX_PER_STEP,
  agentRateLimitHoldEnabled,
  agentRunPlanAttachmentSetId,
  assertAgentRunStatusTransition,
  canTransitionAgentRunStatus,
  isAgentRunTerminalStatus,
  normalizeAgentRunGoal,
  normalizeAgentRunHold,
  normalizeAgentRunPlan,
  normalizeAgentRunPriority,
  normalizeAgentRunQuotaLedger,
  normalizeAgentRunStepsState,
  validateCreateAgentRunInput,
  type AgentRunPlanStep,
  type AgentRunStepState,
  type CreateAgentRunInput,
} from './agentRunRecord.js';

const now = 1_700_000_000_000;
const ownerBinding = 'a'.repeat(64);
const digest = 'b'.repeat(64);
const runId = 'run-12345678-abcd';

const plan: AgentRunPlanStep[] = [
  { toolName: 'repository_explorer', params: {}, dependsOn: [] },
  { toolName: 'file_writer', params: { path: 'docs/out.md' }, dependsOn: [0], inputFrom: 0 },
];

function createInput(overrides: Partial<CreateAgentRunInput> = {}): CreateAgentRunInput {
  return {
    runId,
    ownerBinding,
    goal: 'Survey the repository and write a summary',
    expiresAt: now + 60 * 60 * 1000,
    ...overrides,
  };
}

describe('agent run status machine', () => {
  it('allows the designed lifecycle including hold and resume', () => {
    expect(canTransitionAgentRunStatus('planning', 'awaiting_approval')).toBe(true);
    expect(canTransitionAgentRunStatus('awaiting_approval', 'queued')).toBe(true);
    expect(canTransitionAgentRunStatus('queued', 'running')).toBe(true);
    expect(canTransitionAgentRunStatus('running', 'held')).toBe(true);
    expect(canTransitionAgentRunStatus('running', 'completed')).toBe(true);
    expect(canTransitionAgentRunStatus('held', 'awaiting_approval')).toBe(true);
    expect(canTransitionAgentRunStatus('awaiting_approval', 'held')).toBe(true);
    expect(canTransitionAgentRunStatus('running', 'queued')).toBe(true);
  });

  it('never carries approval across a hold: held cannot jump straight to queued or running', () => {
    expect(canTransitionAgentRunStatus('held', 'queued')).toBe(false);
    expect(canTransitionAgentRunStatus('held', 'running')).toBe(false);
    expect(() => assertAgentRunStatusTransition('held', 'queued')).toThrow('AGENT_RUN_TRANSITION_DENIED');
  });

  it('denies skipping approval and escaping terminal states', () => {
    expect(canTransitionAgentRunStatus('planning', 'running')).toBe(false);
    expect(canTransitionAgentRunStatus('planning', 'queued')).toBe(false);
    expect(canTransitionAgentRunStatus('awaiting_approval', 'completed')).toBe(false);
    for (const terminal of ['completed', 'failed', 'cancelled', 'expired'] as const) {
      expect(isAgentRunTerminalStatus(terminal)).toBe(true);
      for (const next of AGENT_RUN_RECORD_STATUSES) {
        expect(canTransitionAgentRunStatus(terminal, next)).toBe(false);
      }
    }
  });

  it('lets every non-terminal status expire, and expiry never returns', () => {
    for (const status of AGENT_RUN_RECORD_STATUSES) {
      if (isAgentRunTerminalStatus(status)) continue;
      expect(canTransitionAgentRunStatus(status, 'expired')).toBe(true);
    }
    expect(canTransitionAgentRunStatus('expired', 'planning')).toBe(false);
  });
});

describe('agent run plan validation', () => {
  it('accepts a plan whose steps depend only on earlier steps', () => {
    expect(normalizeAgentRunPlan(plan)).toEqual(plan);
    expect(normalizeAgentRunPlan(null)).toBeNull();
  });

  it('rejects forward, self, duplicate and out-of-range dependencies', () => {
    expect(() => normalizeAgentRunPlan([
      { toolName: 'file_writer', params: {}, dependsOn: [1] },
      { toolName: 'repository_explorer', params: {}, dependsOn: [] },
    ])).toThrow('AGENT_RUN_PLAN_INVALID');
    expect(() => normalizeAgentRunPlan([
      { toolName: 'file_writer', params: {}, dependsOn: [0] },
    ])).toThrow('AGENT_RUN_PLAN_INVALID');
    expect(() => normalizeAgentRunPlan([
      { toolName: 'repository_explorer', params: {}, dependsOn: [] },
      { toolName: 'file_writer', params: {}, dependsOn: [0, 0] },
    ])).toThrow('AGENT_RUN_PLAN_INVALID');
    expect(() => normalizeAgentRunPlan([
      { toolName: 'repository_explorer', params: {}, dependsOn: [] },
      { toolName: 'file_writer', params: {}, dependsOn: [], inputFrom: 5 },
    ])).toThrow('AGENT_RUN_PLAN_INVALID');
  });

  it('rejects malformed steps and empty plans', () => {
    expect(() => normalizeAgentRunPlan([])).toThrow('AGENT_RUN_PLAN_INVALID');
    expect(() => normalizeAgentRunPlan([
      { toolName: 'Not A Tool', params: {}, dependsOn: [] } as unknown as AgentRunPlanStep,
    ])).toThrow('AGENT_RUN_PLAN_INVALID');
    expect(() => normalizeAgentRunPlan([
      { toolName: 'file_writer', params: [] as unknown as Record<string, unknown>, dependsOn: [] },
    ])).toThrow('AGENT_RUN_PLAN_INVALID');
  });

  it('blocks likely secrets inside plan parameters', () => {
    expect(() => normalizeAgentRunPlan([
      { toolName: 'file_writer', params: { content: "const api_key = 'sk-live-123'" }, dependsOn: [] },
    ])).toThrow('AGENT_RUN_SECRET_CONTENT_BLOCKED');
  });
});

describe('agent run component validation', () => {
  it('validates step state entries and rejects duplicates', () => {
    expect(normalizeAgentRunStepsState([
      { id: 'step-1', status: 'completed', attempts: 1, summary: 'done' },
      { id: 'step-2', status: 'queued', attempts: 0 },
    ])).toHaveLength(2);
    expect(() => normalizeAgentRunStepsState([
      { id: 'step-1', status: 'queued', attempts: 0 },
      { id: 'step-1', status: 'queued', attempts: 0 },
    ])).toThrow('AGENT_RUN_STEPS_STATE_INVALID');
    expect(() => normalizeAgentRunStepsState([
      { id: 'step-1', status: 'queued', attempts: 99 },
    ])).toThrow('AGENT_RUN_STEPS_STATE_INVALID');
  });

  it('accepts coherent hold records and rejects mismatched resume conditions', () => {
    const hold = {
      reason: 'quota_exhausted' as const,
      resumeCondition: { kind: 'quota_reset' as const, provider: 'openrouter', resetAt: now + 3_600_000 },
      heldSince: now,
      resumeAttempts: 0,
    };
    expect(normalizeAgentRunHold(hold, now)).toEqual(hold);
    expect(() => normalizeAgentRunHold({ ...hold, resumeCondition: { kind: 'at_time', at: now + 1000 } }, now))
      .toThrow('AGENT_RUN_HOLD_INVALID');
    expect(() => normalizeAgentRunHold({
      reason: 'awaiting_approval',
      resumeCondition: { kind: 'quota_reset', provider: 'openrouter' },
      heldSince: now,
      resumeAttempts: 0,
    }, now)).toThrow('AGENT_RUN_HOLD_INVALID');
    expect(() => normalizeAgentRunHold({
      reason: 'dependency_wait',
      resumeCondition: { kind: 'dependency', targetKind: 'run', targetId: 'not-a-run' },
      heldSince: now,
      resumeAttempts: 0,
    }, now)).toThrow('AGENT_RUN_HOLD_INVALID');
  });

  it('validates quota ledger counters', () => {
    expect(normalizeAgentRunQuotaLedger({ openrouter: { requests: 3 }, tavily: { credits: 1 } }))
      .toEqual({ openrouter: { requests: 3 }, tavily: { credits: 1 } });
    expect(() => normalizeAgentRunQuotaLedger({ openrouter: { requests: -1 } })).toThrow('AGENT_RUN_QUOTA_LEDGER_INVALID');
    expect(() => normalizeAgentRunQuotaLedger({ openrouter: { requests: 1.5 } })).toThrow('AGENT_RUN_QUOTA_LEDGER_INVALID');
  });

  it('validates goal and priority bounds', () => {
    expect(normalizeAgentRunGoal('  investigate  ')).toBe('  investigate  ');
    expect(() => normalizeAgentRunGoal('   ')).toThrow('AGENT_RUN_GOAL_INVALID');
    expect(() => normalizeAgentRunGoal('x'.repeat(4001))).toThrow('AGENT_RUN_GOAL_INVALID');
    expect(() => normalizeAgentRunGoal("password = 'hunter2' please")).toThrow('AGENT_RUN_SECRET_CONTENT_BLOCKED');
    expect(normalizeAgentRunPriority(undefined)).toBe(0);
    expect(() => normalizeAgentRunPriority(101)).toThrow('AGENT_RUN_PRIORITY_INVALID');
  });
});

describe('agent run step live detail (PR-L1)', () => {
  const baseStep: AgentRunStepState = { id: 'task-1', status: 'completed', attempts: 1 };

  it('round-trips a well-formed live detail unchanged', () => {
    const liveDetail = {
      startedAt: now - 12_000,
      finishedAt: now,
      query: '富士山の高さ',
      sources: [
        { title: '富士山の高さと登山情報', url: 'https://example.jp/fuji/', domain: 'example.jp', excerpt: '富士山は標高3,776m。' },
      ],
    };
    const [step] = normalizeAgentRunStepsState([{ ...baseStep, liveDetail }]);
    expect(step?.liveDetail).toEqual(liveDetail);
  });

  it('truncates the query, the source count and source text to the live caps', () => {
    const liveDetail = {
      query: 'q'.repeat(250),
      sources: Array.from({ length: 5 }, () => ({
        title: 't'.repeat(130),
        url: `https://example.jp/${'u'.repeat(600)}`,
        excerpt: 'e'.repeat(200),
      })),
    };
    const [step] = normalizeAgentRunStepsState([{ ...baseStep, liveDetail }]);
    expect(step?.liveDetail?.query).toHaveLength(MAX_AGENT_RUN_LIVE_QUERY_LENGTH);
    expect(step?.liveDetail?.sources).toHaveLength(MAX_AGENT_RUN_LIVE_SOURCES);
    expect(step?.liveDetail?.sources?.[0]?.title).toHaveLength(MAX_AGENT_RUN_LIVE_SOURCE_TITLE_LENGTH);
    expect(step?.liveDetail?.sources?.[0]?.url).toHaveLength(MAX_AGENT_RUN_LIVE_SOURCE_URL_LENGTH);
    expect(step?.liveDetail?.sources?.[0]?.excerpt).toHaveLength(MAX_AGENT_RUN_LIVE_SOURCE_EXCERPT_LENGTH);
  });

  it('drops malformed live detail instead of rejecting the step state (fail-soft)', () => {
    const [a] = normalizeAgentRunStepsState([
      { ...baseStep, liveDetail: 'not-an-object' } as unknown as AgentRunStepState,
    ]);
    expect(a?.status).toBe('completed');
    expect(a?.liveDetail).toBeUndefined();
    const [b] = normalizeAgentRunStepsState([
      {
        ...baseStep,
        liveDetail: {
          sources: [
            { title: 42, url: 'https://example.jp/1' },
            { title: 'ok', url: 'https://example.jp/2' },
          ],
        },
      } as unknown as AgentRunStepState,
    ]);
    expect(b?.liveDetail?.sources).toEqual([{ title: 'ok', url: 'https://example.jp/2' }]);
    const [c] = normalizeAgentRunStepsState([{ ...baseStep, liveDetail: { startedAt: -5, query: '   ' } }]);
    expect(c?.liveDetail).toBeUndefined();
  });

  it('round-trips a parse failure (chunk index + reason token) unchanged (Basel observability)', () => {
    const liveDetail = {
      startedAt: now - 5_000,
      finishedAt: now,
      parseFailure: { chunkIndex: 2, reason: 'row-key-missing' },
    };
    const [step] = normalizeAgentRunStepsState([{ ...baseStep, liveDetail }]);
    expect(step?.liveDetail).toEqual(liveDetail);
  });

  it('drops a malformed parse failure but keeps the rest of the live detail (fail-soft)', () => {
    const malformed: unknown[] = [
      { chunkIndex: -1, reason: 'row-key-missing' },
      { chunkIndex: 1.5, reason: 'row-key-missing' },
      { chunkIndex: '2', reason: 'row-key-missing' },
      { chunkIndex: 2, reason: 'Row Key Missing' },
      { chunkIndex: 2, reason: 'the model said something long and free-form instead of a token' },
      { chunkIndex: 2, reason: '' },
      { chunkIndex: 2 },
      'row-key-missing',
    ];
    for (const parseFailure of malformed) {
      const [step] = normalizeAgentRunStepsState([
        { ...baseStep, liveDetail: { startedAt: now - 1_000, parseFailure } } as unknown as AgentRunStepState,
      ]);
      expect(step?.liveDetail?.parseFailure).toBeUndefined();
      expect(step?.liveDetail?.startedAt).toBe(now - 1_000);
    }
  });

  it('reads pre-L1 step state (no live detail) unchanged', () => {
    const legacy: AgentRunStepState[] = [
      { id: 'task-1', status: 'completed', attempts: 2, summary: 'completed:web_search_grounding' },
      { id: 'task-2', status: 'queued', attempts: 0 },
    ];
    expect(normalizeAgentRunStepsState(legacy)).toEqual(legacy);
  });
});

describe('create agent run input validation', () => {
  it('accepts a goal-only planning run and a goal-only held run', () => {
    const planning = validateCreateAgentRunInput(createInput(), now);
    expect(planning).toMatchObject({ status: 'planning', plan: null, planDigest: null, hold: null, priority: 0 });
    const held = validateCreateAgentRunInput(createInput({
      status: 'held',
      hold: { reason: 'user_paused', resumeCondition: { kind: 'manual' }, heldSince: now, resumeAttempts: 0 },
    }), now);
    expect(held.status).toBe('held');
    expect(held.plan).toBeNull();
  });

  it('requires plan and digest as a pair for approval-bound statuses', () => {
    expect(validateCreateAgentRunInput(createInput({ status: 'queued', plan, planDigest: digest }), now).status).toBe('queued');
    expect(() => validateCreateAgentRunInput(createInput({ status: 'queued' }), now)).toThrow('AGENT_RUN_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentRunInput(createInput({ plan }), now)).toThrow('AGENT_RUN_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentRunInput(createInput({ plan, planDigest: 'not-hex' }), now)).toThrow('AGENT_RUN_PLAN_DIGEST_INVALID');
  });

  it('rejects hold data on non-held runs and impossible births', () => {
    expect(() => validateCreateAgentRunInput(createInput({
      hold: { reason: 'user_paused', resumeCondition: { kind: 'manual' }, heldSince: now, resumeAttempts: 0 },
    }), now)).toThrow('AGENT_RUN_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentRunInput(createInput({ status: 'running' as never }), now)).toThrow('AGENT_RUN_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentRunInput(createInput({ parentRunId: runId }), now)).toThrow('AGENT_RUN_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentRunInput(createInput({ expiresAt: now + 1000 }), now)).toThrow('AGENT_RUN_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentRunInput(createInput({ runId: 'bogus' }), now)).toThrow('AGENT_RUN_ID_INVALID');
    expect(() => validateCreateAgentRunInput(createInput({ ownerBinding: 'raw-owner-name' }), now)).toThrow('AGENT_RUN_OWNER_BINDING_INVALID');
  });

  it('gives an awaiting_approval birth an approval lapse deadline and derives the carried attempt count (PR 1-G)', () => {
    const born = validateCreateAgentRunInput(createInput({ status: 'awaiting_approval', plan, planDigest: digest }), now);
    expect(born.approvalDeadlineAt).toBe(now + AGENT_RUN_APPROVAL_LAPSE_MS);
    expect(born.priorResumeAttempts).toBeNull();
    const explicit = validateCreateAgentRunInput(createInput({
      status: 'awaiting_approval', plan, planDigest: digest, approvalDeadlineAt: now + 60_000,
    }), now);
    expect(explicit.approvalDeadlineAt).toBe(now + 60_000);
    // A deadline is meaningless (and refused) on any other birth status.
    expect(() => validateCreateAgentRunInput(createInput({ approvalDeadlineAt: now + 60_000 }), now))
      .toThrow('AGENT_RUN_CREATE_INPUT_INVALID');
    expect(() => validateCreateAgentRunInput(createInput({
      status: 'awaiting_approval', plan, planDigest: digest, approvalDeadlineAt: -1,
    }), now)).toThrow('AGENT_RUN_APPROVAL_DEADLINE_INVALID');
    // A born-held run carries its birth hold's attempt count across episodes.
    const held = validateCreateAgentRunInput(createInput({
      status: 'held',
      hold: { reason: 'quota_exhausted', resumeCondition: { kind: 'quota_reset', provider: 'tavily' }, heldSince: now, resumeAttempts: 2 },
    }), now);
    expect(held.priorResumeAttempts).toBe(2);
    expect(held.approvalDeadlineAt).toBeNull();
  });
});

describe('rate-limit hold record shapes (design CAPACITY_RATE_LIMIT_QUANTIFICATION_2026-11-22 §2-B)', () => {
  it('accepts a rate_limited hold with an at_time resume condition and rejects other condition kinds', () => {
    const hold = {
      reason: 'rate_limited' as const,
      resumeCondition: { kind: 'at_time' as const, at: now + 60_000 },
      heldSince: now,
      resumeAttempts: 0,
    };
    expect(normalizeAgentRunHold(hold, now)).toEqual(hold);
    expect(normalizeAgentRunHold({ ...hold, resumeCondition: { kind: 'manual' } }, now))
      .toEqual({ ...hold, resumeCondition: { kind: 'manual' } });
    // A per-minute window is a clock fact, not a ledger fact: the
    // quota_reset condition belongs to quota_exhausted holds only.
    expect(() => normalizeAgentRunHold({
      ...hold,
      resumeCondition: { kind: 'quota_reset', provider: 'groq' },
    }, now)).toThrow('AGENT_RUN_HOLD_INVALID');
  });

  it('round-trips the per-step rate-limit park count and rejects out-of-bound counts', () => {
    const [step] = normalizeAgentRunStepsState([
      { id: 'task-1', status: 'queued', attempts: 0, errorCode: 'PROVIDER_RATE_LIMITED', rateLimitHolds: 2 },
    ]);
    expect(step.rateLimitHolds).toBe(2);
    // A step that was never parked carries no count (pre-measure shape).
    const [plain] = normalizeAgentRunStepsState([{ id: 'task-1', status: 'queued', attempts: 0 }]);
    expect(plain).not.toHaveProperty('rateLimitHolds');
    expect(() => normalizeAgentRunStepsState([
      { id: 'task-1', status: 'queued', attempts: 0, rateLimitHolds: AGENT_RUN_RATE_LIMIT_HOLD_MAX_PER_STEP + 1 },
    ])).toThrow('AGENT_RUN_STEPS_STATE_INVALID');
    expect(() => normalizeAgentRunStepsState([
      { id: 'task-1', status: 'queued', attempts: 0, rateLimitHolds: 1.5 },
    ])).toThrow('AGENT_RUN_STEPS_STATE_INVALID');
    expect(() => normalizeAgentRunStepsState([
      { id: 'task-1', status: 'queued', attempts: 0, rateLimitHolds: -1 },
    ])).toThrow('AGENT_RUN_STEPS_STATE_INVALID');
  });

  it('enables the rate-limit hold only for the exact string "true"', () => {
    expect(agentRateLimitHoldEnabled({ ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED: 'true' })).toBe(true);
    expect(agentRateLimitHoldEnabled({ ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED: 'TRUE' })).toBe(false);
    expect(agentRateLimitHoldEnabled({ ORIGIN_AGENT_RATE_LIMIT_HOLD_ENABLED: '1' })).toBe(false);
    expect(agentRateLimitHoldEnabled({})).toBe(false);
  });
});

describe('agentRunPlanAttachmentSetId (resume attachment support, design §4.2)', () => {
  const SET_ID = 'att-12345678-abcd-4ef0-9abc-def012345678';
  const SET_DIGEST = 'f'.repeat(64);

  it('reads the binding from a data step of the stored plan', () => {
    const bound: AgentRunPlanStep[] = [
      { toolName: 'attachment_reader', params: { attachmentSetId: SET_ID, setDigest: SET_DIGEST }, dependsOn: [] },
      { toolName: 'attachment_analyzer', params: { attachmentSetId: SET_ID, setDigest: SET_DIGEST }, dependsOn: [0] },
      { toolName: 'document_generator', params: { title: 'Report' }, dependsOn: [1] },
    ];
    expect(agentRunPlanAttachmentSetId(bound)).toBe(SET_ID);
  });

  it('returns null for a goal-only plan and for a missing plan', () => {
    expect(agentRunPlanAttachmentSetId(plan)).toBeNull();
    expect(agentRunPlanAttachmentSetId(null)).toBeNull();
    expect(agentRunPlanAttachmentSetId([])).toBeNull();
  });

  it('never throws on malformed steps: missing params, wrong types and empty strings all read as unbound', () => {
    const malformed = [
      { toolName: 'attachment_reader', dependsOn: [] },
      { toolName: 'attachment_reader', params: null, dependsOn: [] },
      { toolName: 'attachment_reader', params: { attachmentSetId: 42 }, dependsOn: [] },
      { toolName: 'attachment_reader', params: { attachmentSetId: '' }, dependsOn: [] },
      null,
      undefined,
    ] as unknown as AgentRunPlanStep[];
    expect(agentRunPlanAttachmentSetId(malformed)).toBeNull();
    // A later well-formed step still yields its binding.
    const mixed = [
      ...malformed,
      { toolName: 'attachment_reader', params: { attachmentSetId: SET_ID }, dependsOn: [] },
    ] as unknown as AgentRunPlanStep[];
    expect(agentRunPlanAttachmentSetId(mixed)).toBe(SET_ID);
  });
});
