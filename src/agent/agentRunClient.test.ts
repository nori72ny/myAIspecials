import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_RUN_SMALL_ADVANCE_BUDGET_MS,
  driveAgentRun,
  fetchAgentRunView,
  normalizeAgentRunView,
  type AgentRunView,
} from './agentRunClient';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('normalizeAgentRunView (PR-L2)', () => {
  it('keeps liveDetail and drops malformed pieces', () => {
    const view = normalizeAgentRunView({
      runId: 'run-1',
      status: 'running',
      goal: 'g',
      plan: [
        { toolName: 'web_search_grounding', params: { query: 'q' } },
        { bad: true },
      ],
      stepsState: [
        {
          id: 'task-1', status: 'completed', attempts: 1,
          liveDetail: {
            startedAt: 100, finishedAt: 200, query: 'q',
            sources: [
              { title: 'T', url: 'https://a.example/', domain: 'a.example', excerpt: 'E' },
              { title: 3, url: 'https://b.example/' },
              'junk',
            ],
          },
        },
        { id: 'task-2', status: 'running', attempts: 0, liveDetail: { startedAt: 'soon' } },
        { nope: true },
      ],
    });
    expect(view?.plan).toEqual([{ toolName: 'web_search_grounding', params: { query: 'q' } }]);
    expect(view?.stepsState).toHaveLength(2);
    expect(view?.stepsState[0].liveDetail?.sources).toEqual([
      { title: 'T', url: 'https://a.example/', domain: 'a.example', excerpt: 'E' },
    ]);
    expect(view?.stepsState[1].liveDetail).toBeUndefined();
  });

  it('passes old-format stepsState without liveDetail through unchanged', () => {
    const view = normalizeAgentRunView({
      runId: 'run-1',
      status: 'completed',
      stepsState: [{ id: 'task-1', status: 'completed', attempts: 2 }],
    });
    expect(view?.stepsState).toEqual([{ id: 'task-1', status: 'completed', attempts: 2 }]);
  });

  it('returns undefined for non-run payloads', () => {
    expect(normalizeAgentRunView(undefined)).toBeUndefined();
    expect(normalizeAgentRunView('run-1')).toBeUndefined();
    expect(normalizeAgentRunView({ status: 'running' })).toBeUndefined();
  });
});

describe('driveAgentRun live progress (PR-L2)', () => {
  it('forwards the small budget and reports each advance run view in order', async () => {
    const progress: AgentRunView[] = [];
    const bodies: unknown[] = [];
    let calls = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      calls += 1;
      if (calls === 1) {
        return json({
          ok: true, status: 'running', advanced: true,
          run: {
            runId: 'run-1', status: 'running',
            stepsState: [{ id: 'task-1', status: 'completed', attempts: 1, liveDetail: { startedAt: 1, finishedAt: 2 } }],
          },
        }, 202);
      }
      return json({
        ok: true, status: 'completed', artifact: 'done',
        run: { runId: 'run-1', status: 'completed', stepsState: [{ id: 'task-1', status: 'completed', attempts: 1 }] },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await driveAgentRun('run-1', { kind: 'browser', planToken: 'tok' }, new AbortController().signal, {
      budgetMs: AGENT_RUN_SMALL_ADVANCE_BUDGET_MS,
      onProgress: (view) => progress.push(view),
    });

    expect(outcome).toEqual({ kind: 'completed', artifact: 'done' });
    expect(bodies).toEqual([
      { planToken: 'tok', budgetMs: 10000 },
      { planToken: 'tok', budgetMs: 10000 },
    ]);
    expect(progress.map((view) => view.status)).toEqual(['running', 'completed']);
    expect(progress[0].stepsState[0].liveDetail).toEqual({ startedAt: 1, finishedAt: 2 });
  });

  it('keeps the legacy request body when no options are given (task board path)', async () => {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({ ok: true, status: 'completed' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await driveAgentRun('run-1', { kind: 'operator', credential: 'key' }, new AbortController().signal);
    expect(bodies).toEqual([{}]);
  });
});

describe('fetchAgentRunView (PR-L2)', () => {
  it('reads a run with the plan-token header for the browser binding', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/agent/v3/runs/run-1');
      expect(new Headers(init?.headers).get('x-agent-plan-token')).toBe('tok');
      return json({ ok: true, run: { runId: 'run-1', status: 'running', stepsState: [] } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = await fetchAgentRunView('run-1', { kind: 'browser', planToken: 'tok' }, new AbortController().signal);
    expect(view?.status).toBe('running');
  });

  it('returns null when the run cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, code: 'AGENT_RUN_NOT_FOUND' }, 404)));
    await expect(fetchAgentRunView('run-1', { kind: 'operator', credential: 'key' }, new AbortController().signal)).resolves.toBeNull();
  });
});
