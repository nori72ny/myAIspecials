import { describe, expect, it } from 'vitest';
import {
  classifyOrinPanelRun,
  groupOrinPanelRuns,
  orinPanelHoldNote,
  orinPanelRunProgress,
  parseOrinPanelRun,
  type OrinPanelRun,
} from './orinPanelModel';

function run(partial: Partial<OrinPanelRun>): OrinPanelRun {
  return {
    runId: 'run-test',
    status: 'running',
    goal: 'テストの依頼',
    plan: null,
    stepsState: [],
    hold: null,
    createdAt: '2026-11-24T05:00:00.000Z',
    updatedAt: '2026-11-24T05:00:00.000Z',
    ...partial,
  };
}

const planOf = (count: number) => Array.from({ length: count }, (_, index) => ({ toolName: `tool-${index}` }));
const statesOf = (statuses: string[]) => statuses.map((status, index) => ({ id: `s${index}`, status }));

describe('orinPanelModel classification (design §4.2)', () => {
  it('maps run statuses onto the four display groups', () => {
    expect(classifyOrinPanelRun('planning')).toBe('active');
    expect(classifyOrinPanelRun('queued')).toBe('active');
    expect(classifyOrinPanelRun('running')).toBe('active');
    expect(classifyOrinPanelRun('awaiting_approval')).toBe('pending');
    expect(classifyOrinPanelRun('held')).toBe('stopped');
    expect(classifyOrinPanelRun('failed')).toBe('stopped');
    expect(classifyOrinPanelRun('cancelled')).toBe('stopped');
    expect(classifyOrinPanelRun('expired')).toBe('stopped');
    expect(classifyOrinPanelRun('completed')).toBe('done');
  });
});

describe('orinPanelModel progress (design §5)', () => {
  it('computes floor percent from completed steps over planned steps', () => {
    const progress = orinPanelRunProgress(run({
      status: 'running',
      plan: planOf(7),
      stepsState: statesOf(['completed', 'completed', 'completed', 'running', 'queued', 'queued', 'queued']),
    }));
    expect(progress).toEqual({ percent: 42, done: 3, total: 7 });
  });

  it('shows no percent while the plan is not decided yet', () => {
    expect(orinPanelRunProgress(run({ status: 'planning', plan: null }))).toBeNull();
    expect(orinPanelRunProgress(run({ status: 'planning', plan: [] }))).toBeNull();
  });

  it('shows no percent for awaiting approval (never a fake 0%)', () => {
    expect(orinPanelRunProgress(run({
      status: 'awaiting_approval',
      plan: planOf(3),
      stepsState: statesOf(['queued', 'queued', 'queued']),
    }))).toBeNull();
  });

  it('shows no percent for a queued run where nothing has started', () => {
    expect(orinPanelRunProgress(run({
      status: 'queued',
      plan: planOf(3),
      stepsState: statesOf(['queued', 'queued', 'queued']),
    }))).toBeNull();
  });

  it('shows the stopped-at percent for held and failed runs', () => {
    const held = orinPanelRunProgress(run({
      status: 'held',
      plan: planOf(4),
      stepsState: statesOf(['completed', 'completed', 'queued', 'queued']),
      hold: { reason: 'quota_exhausted', resumeConditionKind: 'quota_reset' },
    }));
    expect(held).toEqual({ percent: 50, done: 2, total: 4 });
    const failed = orinPanelRunProgress(run({
      status: 'failed',
      plan: planOf(4),
      stepsState: statesOf(['completed', 'failed', 'queued', 'queued']),
    }));
    expect(failed).toEqual({ percent: 25, done: 1, total: 4 });
  });

  it('shows 100% for a completed run', () => {
    expect(orinPanelRunProgress(run({
      status: 'completed',
      plan: planOf(2),
      stepsState: statesOf(['completed', 'completed']),
    }))).toEqual({ percent: 100, done: 2, total: 2 });
  });
});

describe('orinPanelModel hold notes (design §4.2)', () => {
  it('promises automatic resume for quota holds with the design wording', () => {
    const note = orinPanelHoldNote(run({
      status: 'held',
      hold: { reason: 'quota_exhausted', resumeConditionKind: 'quota_reset' },
    }));
    expect(note?.ja).toBe('混み合っているため一時停止中です。自動で再開します');
  });

  it('does not promise automatic resume for a manual pause', () => {
    const note = orinPanelHoldNote(run({
      status: 'held',
      hold: { reason: 'user_paused', resumeConditionKind: 'manual' },
    }));
    expect(note?.ja).toBe('一時停止中です');
    expect(note?.ja).not.toContain('自動で再開');
  });

  it('has no note for non-held runs', () => {
    expect(orinPanelHoldNote(run({ status: 'running' }))).toBeNull();
  });
});

describe('orinPanelModel grouping and the completion window (design §4.4)', () => {
  const now = new Date('2026-11-24T06:00:00.000Z').getTime();
  const iso = (ms: number) => new Date(ms).toISOString();

  it('keeps completions within 24 hours, drops older ones, caps at 10', () => {
    const runs: OrinPanelRun[] = [];
    for (let index = 0; index < 12; index += 1) {
      runs.push(run({
        runId: `run-done-${index}`,
        status: 'completed',
        updatedAt: iso(now - index * 60 * 60 * 1000),
        plan: planOf(1),
        stepsState: statesOf(['completed']),
      }));
    }
    runs.push(run({
      runId: 'run-done-old',
      status: 'completed',
      updatedAt: iso(now - 25 * 60 * 60 * 1000),
      plan: planOf(1),
      stepsState: statesOf(['completed']),
    }));
    const groups = groupOrinPanelRuns(runs, now);
    expect(groups.done).toHaveLength(10);
    expect(groups.done.some((item) => item.runId === 'run-done-old')).toBe(false);
    // Newest first.
    expect(groups.done[0].runId).toBe('run-done-0');
  });

  it('never drops active, pending or stopped items for age', () => {
    const runs = [
      run({ runId: 'run-old-active', status: 'running', updatedAt: iso(now - 72 * 60 * 60 * 1000), plan: planOf(1), stepsState: statesOf(['running']) }),
      run({ runId: 'run-old-held', status: 'held', updatedAt: iso(now - 72 * 60 * 60 * 1000), plan: planOf(1), stepsState: statesOf(['queued']), hold: { reason: 'scheduled_time', resumeConditionKind: 'at_time' } }),
    ];
    const groups = groupOrinPanelRuns(runs, now);
    expect(groups.active.map((item) => item.runId)).toEqual(['run-old-active']);
    expect(groups.stopped.map((item) => item.runId)).toEqual(['run-old-held']);
  });
});

describe('orinPanelModel parsing', () => {
  it('accepts the public run shape and rejects malformed entries', () => {
    const parsed = parseOrinPanelRun({
      runId: 'run-1',
      status: 'running',
      goal: '調べてまとめて',
      plan: [{ toolName: 'web_search_grounding', params: {} }],
      stepsState: [{ id: 's0', status: 'running', attempts: 1 }],
      hold: null,
      createdAt: '2026-11-24T05:00:00.000Z',
      updatedAt: '2026-11-24T05:30:00.000Z',
    });
    expect(parsed?.plan).toEqual([{ toolName: 'web_search_grounding' }]);
    expect(parsed?.stepsState).toEqual([{ id: 's0', status: 'running' }]);
    expect(parseOrinPanelRun({ runId: 'nope', status: 'running', goal: 'x' })).toBeNull();
    expect(parseOrinPanelRun({ runId: 'run-1', status: 'mystery', goal: 'x' })).toBeNull();
    expect(parseOrinPanelRun(null)).toBeNull();
  });
});
