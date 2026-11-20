import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadCheckpointsFromIndexedDB, saveCheckpointToIndexedDB } = vi.hoisted(() => ({
  loadCheckpointsFromIndexedDB: vi.fn(async () => []),
  saveCheckpointToIndexedDB: vi.fn(async () => undefined),
}));
vi.mock('../agent/indexedDbCheckpointStore', () => ({
  loadCheckpointsFromIndexedDB,
  saveCheckpointToIndexedDB,
}));

import AgentWorkspaceView, { catStateForPhase } from './AgentWorkspaceView';
import { getAgentActivitySnapshot, reportAgentActivity } from '../agent/agentActivityStore';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  loadCheckpointsFromIndexedDB.mockClear();
  saveCheckpointToIndexedDB.mockClear();
});

function readyStatus() {
  return {
    ok: true,
    protocolVersion: 3,
    ready: true,
    approvalSigningConfigured: true,
    replayProtectionConfigured: true,
    replayProtection: 'shared-atomic',
    freeOnly: true,
    costUsd: 0,
    paidFallbackEnabled: false,
    secretDelivery: 'server-only',
  };
}

function planResponse(selectedTool = 'document_generator') {
  return {
    ok: true,
    protocolVersion: 3,
    runId: 'run-test-1',
    status: 'awaiting_approval',
    planToken: 'signed-plan-token',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    freeOnly: true,
    costUsd: 0,
    paidFallbackUsed: false,
    selectedTool,
    params: selectedTool === 'code_interpreter' ? { code: 'このTypeScriptコードのバグを分析して' } : selectedTool === 'web_search_grounding' ? { query: '検索テスト' } : selectedTool === 'file_writer' ? { path: 'artifacts/request-draft.md', content: '# たたき台' } : { content: '文書案を作ってください' },
    plan: [
      { id: 'task-1', title: 'Goal analysis' },
      { id: 'task-2', title: 'Task decomposition' },
      { id: 'task-3', title: 'Self-critique' },
      { id: 'task-4', title: 'Execution' },
      { id: 'task-5', title: 'Verification' },
    ],
  };
}

describe('AgentWorkspaceView v3', () => {
  it('creates a signed v3 plan without claiming any tool ran', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ goal: '文書案を作ってください' });
        return json(planResponse(), 201);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));

    await screen.findByText('まだ実行していません · 承認待ち');
    expect(screen.getByText(/まだ作業は始めていません/)).toBeTruthy();
    expect(screen.getByLabelText('行う作業').textContent).toContain('文書を作る');
    expect((screen.getByLabelText('任せたいこと') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent')).toBe(false);
  });

  it('records and drives the run for the operator path with the Bearer binding (PR-D3)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/approval') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ runId: 'run-test-1', planToken: 'signed-plan-token', toolName: 'document_generator' });
        expect(body.params).toEqual({ content: '文書案を作ってください' });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', approvalToken: 'signed-approval-token', scope: 'exact-operation' }, 201);
      }
      if (url === '/api/agent/v3/runs') {
        // PR-D3: same creation body as the browser path (the server
        // verifies both capabilities either way); the operator binding
        // is the Bearer header on top.
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          runId: 'run-test-1',
          goal: '文書案を作ってください',
          planToken: 'signed-plan-token',
          approvalToken: 'signed-approval-token',
          steps: [{ toolName: 'document_generator', params: { content: '文書案を作ってください' } }],
        });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', status: 'queued', run: { runId: 'run-test-1', status: 'queued' } }, 201);
      }
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        // The operator binding rides on the header; no plan token body.
        // The workspace drives with the small live-view budget (PR-L2).
        expect(JSON.parse(String(init?.body))).toEqual({ budgetMs: 10000 });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', status: 'completed', artifact: '# 完成した文書', run: { runId: 'run-test-1', status: 'completed' } });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');

    fireEvent.change(screen.getByLabelText('管理者キー'), { target: { value: 'owner-agent-key' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '承認して実行' })); });

    await waitFor(() => expect(screen.getByRole('heading', { name: '完成した文書' })).toBeTruthy());
    // The runs path delivers only the artifact body, so the on-device
    // save is the same local run record the browser path uses.
    expect(saveCheckpointToIndexedDB).toHaveBeenCalledWith(expect.objectContaining({
      checkpointId: 'run-test-1-runs-v1',
      taskId: 'run-test-1',
      status: 'completed',
      artifact: '# 完成した文書',
    }));
    expect(screen.queryByLabelText('実行認証キー')).toBeNull();
    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    // Every request in the flow fires exactly once. The task board's list
    // load (`/api/agent/v3/runs?limit=50`) is independent of the approval
    // call — the board fetches on its own schedule — so the pair's
    // relative order is timing-dependent and is checked as a set, not a
    // sequence (the two swapped under Node 24 in PR #1235 and PR #1237).
    expect([...calledUrls].sort()).toEqual([
      '/api/agent/v3/approval',
      '/api/agent/v3/plan',
      '/api/agent/v3/runs',
      '/api/agent/v3/runs/run-test-1/advance',
      '/api/agent/v3/runs?limit=50',
      '/api/agent/v3/status',
    ]);
    // The dependent chain keeps its order: the plan token feeds the
    // approval, the approval token feeds run creation, and the created
    // run is the one that gets advanced.
    expect(calledUrls.filter((url) => url !== '/api/agent/v3/runs?limit=50')).toEqual([
      '/api/agent/v3/status',
      '/api/agent/v3/plan',
      '/api/agent/v3/approval',
      '/api/agent/v3/runs',
      '/api/agent/v3/runs/run-test-1/advance',
    ]);
  });

  it('cannot override a different server-planned tool in the workspace UI', async () => {
    const goal = 'このTypeScriptコードのバグを分析して';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse('code_interpreter'), 201);
      if (url === '/api/agent/v3/approval') {
        const body = JSON.parse(String(init?.body));
        expect(body.toolName).toBe('code_interpreter');
        expect(body.params).toEqual({ code: goal });
        return json({ ok: true, approvalToken: 'signed-approval-token' }, 201);
      }
      if (url === '/api/agent/v3/runs') {
        const body = JSON.parse(String(init?.body));
        expect(body.steps).toEqual([{ toolName: 'code_interpreter', params: { code: goal } }]);
        return json({ ok: true, runId: 'run-test-1', status: 'queued' }, 201);
      }
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        return json({ ok: true, status: 'completed', artifact: '// verified analysis' });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: goal } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    expect(screen.getByLabelText('行う作業').textContent).toContain('コードを作って確認する');
    expect(screen.queryByRole('combobox')).toBeNull();

    fireEvent.change(screen.getByLabelText('管理者キー'), { target: { value: 'owner-agent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));
    // The completed artifact shows in the result area, and the saved
    // result's card below is titled by the same first line — both are
    // the same result, so the text legitimately appears twice.
    expect((await screen.findAllByText('// verified analysis')).length).toBeGreaterThanOrEqual(2);
  });

  it('fails closed when owner approval authentication is rejected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url === '/api/agent/v3/approval') return json({ ok: false, code: 'AGENT_AUTHENTICATION_REQUIRED' }, 401);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    fireEvent.change(screen.getByLabelText('管理者キー'), { target: { value: 'wrong-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('処理を完了できませんでした。設定や依頼内容をご確認のうえ、もう一度お試しください。');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/v3/execute')).toBe(false);
  });

  it('lets a general user approve in the browser with no credential at all', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json({ ...readyStatus(), browserApprovalEnabled: true });
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/browser-approval') {
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ runId: 'run-test-1', planToken: 'signed-plan-token', toolName: 'document_generator', confirm: true });
        expect(body.params).toEqual({ content: '文書案を作ってください' });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', approvalToken: 'signed-browser-approval-token', authMode: 'browser', scope: 'exact-operation' }, 201);
      }
      if (url === '/api/agent/v3/runs') {
        // PR-D2: the approved plan is recorded before anything executes.
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          runId: 'run-test-1',
          goal: '文書案を作ってください',
          planToken: 'signed-plan-token',
          approvalToken: 'signed-browser-approval-token',
          steps: [{ toolName: 'document_generator', params: { content: '文書案を作ってください' } }],
        });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', status: 'queued', run: { runId: 'run-test-1', status: 'queued' } }, 201);
      }
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
        expect(JSON.parse(String(init?.body))).toEqual({ planToken: 'signed-plan-token', budgetMs: 10000 });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', status: 'completed', artifact: '# ブラウザ承認で完成した文書', run: { runId: 'run-test-1', status: 'completed' } });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    // No credential is typed anywhere: the browser approval path must be used.
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByRole('heading', { name: 'ブラウザ承認で完成した文書' });
    // The delivered body is saved on-device as a local run record.
    expect(saveCheckpointToIndexedDB).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'run-test-1',
      status: 'completed',
      artifact: '# ブラウザ承認で完成した文書',
    }));
    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    // Same set/order split as the operator-path test above: the board's
    // list load is independent of the browser-approval call, so only the
    // pair's membership is checked, not its relative order.
    expect([...calledUrls].sort()).toEqual([
      '/api/agent/v3/browser-approval',
      '/api/agent/v3/plan',
      '/api/agent/v3/runs',
      '/api/agent/v3/runs/run-test-1/advance',
      '/api/agent/v3/runs?limit=50',
      '/api/agent/v3/status',
    ]);
    // The dependent chain keeps its order: plan, then browser approval,
    // then run creation, then advancement of the created run.
    expect(calledUrls.filter((url) => url !== '/api/agent/v3/runs?limit=50')).toEqual([
      '/api/agent/v3/status',
      '/api/agent/v3/plan',
      '/api/agent/v3/browser-approval',
      '/api/agent/v3/runs',
      '/api/agent/v3/runs/run-test-1/advance',
    ]);
  });

  it('keeps driving through 202 progress responses until the run completes', async () => {
    let advanceCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json({ ...readyStatus(), browserApprovalEnabled: true });
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/browser-approval') return json({ ok: true, approvalToken: 'signed-browser-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') return json({ ok: true, runId: 'run-test-1', status: 'queued' }, 201);
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        advanceCalls += 1;
        if (advanceCalls === 1) return json({ ok: true, runId: 'run-test-1', status: 'running', advanced: true }, 202);
        return json({ ok: true, runId: 'run-test-1', status: 'completed', artifact: '# 継続駆動で完成した文書' });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByRole('heading', { name: '継続駆動で完成した文書' }, { timeout: 5000 });
    expect(advanceCalls).toBe(2);
  });

  it('reports the full plan step list to the shared activity summary while driving', async () => {
    reportAgentActivity(null);
    let midRunSteps: unknown;
    let advanceCalls = 0;
    const twoStepPlan = {
      ...planResponse('web_search_grounding'),
      steps: [
        { toolName: 'web_search_grounding', params: { query: '検索テスト' } },
        { toolName: 'document_generator', params: { content: '文書案を作ってください' } },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json({ ...readyStatus(), browserApprovalEnabled: true });
      if (url === '/api/agent/v3/plan') return json(twoStepPlan, 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/browser-approval') return json({ ok: true, approvalToken: 'signed-browser-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') return json({ ok: true, runId: 'run-test-1', status: 'queued' }, 201);
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        advanceCalls += 1;
        if (advanceCalls === 1) {
          return json({
            ok: true, runId: 'run-test-1', status: 'running', advanced: true,
            run: {
              runId: 'run-test-1', status: 'running', goal: '文書案を作ってください',
              plan: twoStepPlan.steps,
              stepsState: [
                { id: 'task-1', status: 'running', attempts: 1 },
                { id: 'task-2', status: 'queued', attempts: 0 },
              ],
            },
          }, 202);
        }
        // 2回目の advance が呼ばれる時点では、1回目の進捗が共有
        // 要約へ反映されている（シートが読むのはこの中身）。
        midRunSteps = getAgentActivitySnapshot()?.steps;
        return json({
          ok: true, runId: 'run-test-1', status: 'completed', artifact: '# 完成した文書',
          run: {
            runId: 'run-test-1', status: 'completed', goal: '文書案を作ってください',
            plan: twoStepPlan.steps,
            stepsState: [
              { id: 'task-1', status: 'completed', attempts: 1 },
              { id: 'task-2', status: 'completed', attempts: 1 },
            ],
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByRole('heading', { name: '完成した文書' }, { timeout: 5000 });
    expect(midRunSteps).toEqual([
      { title: 'ウェブで調べる', status: 'running' },
      { title: '文書を作る', status: 'queued' },
    ]);
    const finalSnapshot = getAgentActivitySnapshot();
    expect(finalSnapshot?.outcome).toBe('completed');
    expect(finalSnapshot?.steps).toEqual([
      { title: 'ウェブで調べる', status: 'completed' },
      { title: '文書を作る', status: 'completed' },
    ]);
    reportAgentActivity(null);
  });

  it('fails closed without executing when the run record cannot be created (503)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json({ ...readyStatus(), browserApprovalEnabled: true });
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/browser-approval') return json({ ok: true, approvalToken: 'signed-browser-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') return json({ ok: false, code: 'AGENT_RUN_STORE_UNAVAILABLE' }, 503);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('作業の記録が使えないため、止まりました。実行は始めていません。');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    // No advance, and no fallback to the stateless execute endpoint.
    expect(urls.some((url) => url.endsWith('/advance'))).toBe(false);
    expect(urls).not.toContain('/api/agent/v3/execute');
    expect(saveCheckpointToIndexedDB).not.toHaveBeenCalled();
  });

  it('maps a quota-held run to the held display and leaves resumption to the board', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json({ ...readyStatus(), browserApprovalEnabled: true });
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/browser-approval') return json({ ok: true, approvalToken: 'signed-browser-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') return json({ ok: true, runId: 'run-test-1', status: 'queued' }, 201);
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        return json({ ok: true, runId: 'run-test-1', status: 'held', advanced: false, code: 'AGENT_RUN_QUOTA_EXHAUSTED' }, 202);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('無料枠の上限に達したため、実行を保留にしました。記録は残っているので、下の「これまでの作業」から再開できます。');
    expect(screen.getByText('保留中')).toBeTruthy();
    // PR-L2: the live panel shows its own cat next to the panel
    // headline, so the phase cat is scoped to the status row.
    expect(within(screen.getByRole('status')).getByTestId('origin-cat-state').getAttribute('data-state')).toBe('waiting');
    expect(saveCheckpointToIndexedDB).not.toHaveBeenCalled();
  });

  it('stops driving at the advance cap and leaves the recorded run to the board', async () => {
    let advanceCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json({ ...readyStatus(), browserApprovalEnabled: true });
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/browser-approval') return json({ ok: true, approvalToken: 'signed-browser-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') return json({ ok: true, runId: 'run-test-1', status: 'queued' }, 201);
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        advanceCalls += 1;
        return json({ ok: true, runId: 'run-test-1', status: 'running', advanced: true }, 202);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));
      for (let i = 0; i < 25 && !screen.queryByText('実行中'); i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      }
      expect(screen.getByText('実行中')).toBeTruthy();
      expect(screen.getByText('実行は記録済みで続行しています。進み具合は下の「これまでの作業」で確認できます。')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
    // The bounded loop made exactly the capped number of advance calls.
    expect(advanceCalls).toBe(10);
    expect(saveCheckpointToIndexedDB).not.toHaveBeenCalled();
  });

  it('fails closed on the operator path when the run record cannot be created (503)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/approval') return json({ ok: true, approvalToken: 'signed-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        return json({ ok: false, code: 'AGENT_RUN_STORE_UNAVAILABLE' }, 503);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    fireEvent.change(screen.getByLabelText('管理者キー'), { target: { value: 'owner-agent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('作業の記録が使えないため、止まりました。実行は始めていません。');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    // No advance, and no fallback to the stateless execute endpoint.
    expect(urls.some((url) => url.endsWith('/advance'))).toBe(false);
    expect(urls).not.toContain('/api/agent/v3/execute');
    expect(saveCheckpointToIndexedDB).not.toHaveBeenCalled();
  });

  it('maps a quota-held run to the held display on the operator path too', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/approval') return json({ ok: true, approvalToken: 'signed-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') return json({ ok: true, runId: 'run-test-1', status: 'queued' }, 201);
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        expect(JSON.parse(String(init?.body))).toEqual({ budgetMs: 10000 });
        return json({ ok: true, runId: 'run-test-1', status: 'held', advanced: false, code: 'AGENT_RUN_QUOTA_EXHAUSTED' }, 202);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    fireEvent.change(screen.getByLabelText('管理者キー'), { target: { value: 'owner-agent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('無料枠の上限に達したため、実行を保留にしました。記録は残っているので、下の「これまでの作業」から再開できます。');
    expect(screen.getByText('保留中')).toBeTruthy();
    expect(saveCheckpointToIndexedDB).not.toHaveBeenCalled();
  });

  it('shows the live panel step by step and renders the research artifact as source cards (PR-L2)', async () => {
    const researchLiveDetail = {
      startedAt: 1000,
      finishedAt: 13000,
      query: '富士山 高さ',
      sources: [
        { title: '富士山の高さと登山情報', url: 'https://example.jp/fuji/', domain: 'example.jp', excerpt: '富士山は標高3,776mの日本最高峰です。' },
        { title: '富士登山オフィシャルサイト', url: 'https://example.org/tozan/', domain: 'example.org', excerpt: '開山期は7月上旬から9月上旬です。' },
      ],
    };
    const researchArtifact = JSON.stringify({
      provider: 'tavily',
      sources: [
        { title: '富士山の高さと登山情報', url: 'https://example.jp/fuji/', domain: 'example.jp', excerpt: '富士山は標高3,776mの日本最高峰です。', evidenceLevel: 'extracted' },
        { title: '富士登山オフィシャルサイト', url: 'https://example.org/tozan/', domain: 'example.org', excerpt: '開山期は7月上旬から9月上旬です。', evidenceLevel: 'snippet' },
      ],
    });
    const planSteps = [
      { toolName: 'web_search_grounding', params: { query: '富士山 高さ' } },
      { toolName: 'document_generator', params: { content: '調査結果を文書にまとめてください' } },
    ];
    let advanceCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json({ ...readyStatus(), browserApprovalEnabled: true });
      if (url === '/api/agent/v3/plan') {
        return json({
          ok: true,
          protocolVersion: 3,
          runId: 'run-test-1',
          status: 'awaiting_approval',
          planToken: 'signed-plan-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          selectedTool: 'web_search_grounding',
          params: { query: '富士山 高さ' },
          steps: planSteps,
          plan: [
            { id: 'task-1', title: 'Research' },
            { id: 'task-2', title: 'Document' },
          ],
        }, 201);
      }
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/browser-approval') return json({ ok: true, approvalToken: 'signed-browser-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') return json({ ok: true, runId: 'run-test-1', status: 'queued' }, 201);
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        advanceCalls += 1;
        if (advanceCalls === 1) {
          return json({
            ok: true, runId: 'run-test-1', status: 'running', advanced: true,
            run: {
              runId: 'run-test-1', status: 'running', goal: '富士山について調べてまとめてください', plan: planSteps,
              stepsState: [
                { id: 'task-1', status: 'completed', attempts: 1, liveDetail: researchLiveDetail },
                { id: 'task-2', status: 'running', attempts: 1, liveDetail: { startedAt: 13000 } },
              ],
            },
          }, 202);
        }
        return json({
          ok: true, runId: 'run-test-1', status: 'completed', artifact: researchArtifact,
          run: {
            runId: 'run-test-1', status: 'completed', goal: '富士山について調べてまとめてください', plan: planSteps,
            stepsState: [
              { id: 'task-1', status: 'completed', attempts: 1, liveDetail: researchLiveDetail },
              { id: 'task-2', status: 'completed', attempts: 1, liveDetail: { startedAt: 13000, finishedAt: 21000 } },
            ],
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '富士山について調べてまとめてください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    // Mid-drive (between the two advances): the first advance's run
    // view is already on the panel — the finished research step shows
    // the pages it actually read and its duration while the second
    // step is still running.
    const panel = await screen.findByLabelText('いまの作業');
    await within(panel).findByText('富士山の高さと登山情報');
    expect(within(panel).getByText('富士山は標高3,776mの日本最高峰です。')).toBeTruthy();
    expect(within(panel).getByText('出典2件 · 12秒')).toBeTruthy();
    expect(within(panel).getByText('文書を作っています')).toBeTruthy();
    // 実況パネルのオリンは、制作系ステップ（document_generator）の
    // 実行中は専用の「作っている」静止画になる（M2、2026-11-18）。
    await waitFor(() => {
      expect(within(panel).getByTestId('origin-cat-state').getAttribute('data-state')).toBe('making');
      expect(within(panel).getByTestId('origin-cat-state').getAttribute('src')).toBe('/brand/origin-cat-making.webp');
    });

    // Completion: the delivered artifact is the research sources
    // JSON, rendered as source cards — the raw JSON never appears.
    await screen.findByText(/本文確認済み/, undefined, { timeout: 5000 });
    expect(screen.queryByText(/"sources"/)).toBeNull();
    expect(screen.getAllByRole('link', { name: '原文を開く' })).toHaveLength(3);
    expect(within(panel).getByText('作業が完了しました')).toBeTruthy();
    expect(advanceCalls).toBe(2);
  });
});

describe('AgentWorkspaceView attachments (F3)', () => {
  const FRUITS = 'id,item,amount\nA-1,りんご,120';
  const SET_DIGEST = 'd'.repeat(64);

  function attachmentPlanResponse() {
    return {
      ok: true,
      protocolVersion: 3,
      runId: 'run-test-1',
      status: 'awaiting_approval',
      planToken: 'signed-plan-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      selectedTool: 'attachment_reader',
      params: { attachmentSetId: 'att-test-1', setDigest: SET_DIGEST },
      steps: [
        { toolName: 'attachment_reader', params: { attachmentSetId: 'att-test-1', setDigest: SET_DIGEST } },
        { toolName: 'attachment_analyzer', params: { attachmentSetId: 'att-test-1', setDigest: SET_DIGEST, outputKind: 'rows', chunkOffset: 0, chunkCount: 1, instruction: '各行を分類してレポートを作成してください' } },
        { toolName: 'document_generator', params: { title: '分類レポート', dataGrounded: true, contentFromStep: 1 } },
      ],
      plan: [
        { id: 'task-1', title: 'Read the attached data' },
        { id: 'task-2', title: 'Analyze the attached data' },
        { id: 'task-3', title: 'Document' },
      ],
      attachments: {
        setId: 'att-test-1',
        setDigest: SET_DIGEST,
        fileCount: 1,
        totalChars: FRUITS.length,
        files: [{ name: 'fruits.csv', charCount: FRUITS.length }],
      },
    };
  }

  function attachmentStatus() {
    return { ...readyStatus(), browserApprovalEnabled: true, attachmentsEnabled: true };
  }

  it('hides the attachment UI while the server switch is off', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    expect(screen.queryByText('添付データ')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ファイルを選ぶ' })).toBeNull();
  });

  it('attaches a file, binds it into the plan, and hands the upload token to run creation for the claim bridge', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(attachmentStatus());
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/attachment-sets') {
        expect(init?.method).toBe('POST');
        return json({ ok: true, protocolVersion: 3, attachmentSetId: 'att-test-1', uploadToken: 'upload-token-1', expiresAt: new Date(Date.now() + 60_000).toISOString() }, 201);
      }
      if (url === '/api/agent/v3/attachment-sets/att-test-1/files') {
        expect(new Headers(init?.headers).get('x-agent-attachment-token')).toBe('upload-token-1');
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ name: 'fruits.csv', mediaType: 'text/csv', contentText: FRUITS });
        return json({ ok: true, protocolVersion: 3, attachmentSetId: 'att-test-1', file: { name: 'fruits.csv', charCount: FRUITS.length } }, 201);
      }
      if (url === '/api/agent/v3/plan') {
        expect(new Headers(init?.headers).get('x-agent-attachment-token')).toBe('upload-token-1');
        expect(JSON.parse(String(init?.body))).toEqual({ goal: '各行を分類してレポートを作成してください', attachmentSetId: 'att-test-1' });
        return json(attachmentPlanResponse(), 201);
      }
      if (url === '/api/agent/v3/browser-approval') return json({ ok: true, approvalToken: 'signed-browser-approval-token' }, 201);
      if (url === '/api/agent/v3/runs') {
        // The claim bridge: run creation presents the set's upload
        // token so the server can re-bind the set to this run.
        expect(new Headers(init?.headers).get('x-agent-attachment-token')).toBe('upload-token-1');
        const body = JSON.parse(String(init?.body));
        expect(body.steps.map((step: { toolName: string }) => step.toolName)).toEqual(['attachment_reader', 'attachment_analyzer', 'document_generator']);
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', status: 'queued', run: { runId: 'run-test-1', status: 'queued' } }, 201);
      }
      if (url === '/api/agent/v3/runs/run-test-1/advance') {
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', status: 'completed', artifact: '# 分類レポート', run: { runId: 'run-test-1', status: 'completed' } });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '各行を分類してレポートを作成してください' } });

    const file = new File([FRUITS], 'fruits.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('添付ファイルを選ぶ'), { target: { files: [file] } });
    await screen.findByText(`fruits.csv（${FRUITS.length}文字）`);

    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('まだ実行していません · 承認待ち');
    // The plan names the attached data as part of the approval — in
    // the plan section and in the plan text shown in the result area.
    expect(screen.getAllByText(new RegExp(`添付データ: 1件（fruits\\.csv、合計${FRUITS.length}文字）`))).toHaveLength(2);
    expect(screen.getByLabelText('行う作業').textContent).toContain('添付データを読む');

    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));
    await screen.findByRole('heading', { name: '分類レポート' });
    // The upload capability is dropped once the run owns the set.
    expect(screen.queryByText(`fruits.csv（${FRUITS.length}文字）`)).toBeNull();
  });

  it('refuses an oversize file on the device, with the numbers, and uploads nothing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(attachmentStatus());
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    const file = new File(['a'.repeat(200_001)], 'big.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('添付ファイルを選ぶ'), { target: { files: [file] } });

    await screen.findByText(/「big\.txt」は200,001文字で、上限の200,000文字を1文字超えています/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('attachment-sets'))).toBe(false);
  });

  it('blocks a file whose contents trip the sensitive-input screening before any upload', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(attachmentStatus());
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    // 秘密スキャン（Gitleaks）の誤検出を避けるため、キー風の合成文字列は実行時に組み立てる
    const fakeApiKey = ['sk', 'abcdefghijklmnop1234'].join('-');
    const file = new File([`key: ${fakeApiKey}`], 'keys.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('添付ファイルを選ぶ'), { target: { files: [file] } });

    await screen.findByText(/「keys\.txt」には、パスワードや個人情報が含まれる可能性があるため、添付できません/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('attachment-sets'))).toBe(false);
  });

  it('deletes the set on the server when the attachments are removed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(attachmentStatus());
      if (url.startsWith('/api/agent/v3/runs?')) return json({ ok: true, runs: [] });
      if (url === '/api/agent/v3/attachment-sets') {
        return json({ ok: true, attachmentSetId: 'att-test-1', uploadToken: 'upload-token-1' }, 201);
      }
      if (url === '/api/agent/v3/attachment-sets/att-test-1/files') {
        return json({ ok: true, file: { name: 'fruits.csv', charCount: FRUITS.length } }, 201);
      }
      if (url === '/api/agent/v3/attachment-sets/att-test-1') {
        expect(init?.method).toBe('DELETE');
        expect(new Headers(init?.headers).get('x-agent-attachment-token')).toBe('upload-token-1');
        return json({ ok: true, attachmentSetId: 'att-test-1', deleted: true });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    const file = new File([FRUITS], 'fruits.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('添付ファイルを選ぶ'), { target: { files: [file] } });
    await screen.findByText(`fruits.csv（${FRUITS.length}文字）`);

    fireEvent.click(screen.getByRole('button', { name: '添付を取り消す' }));
    await waitFor(() => expect(screen.queryByText(`fruits.csv（${FRUITS.length}文字）`)).toBeNull());
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/agent/v3/attachment-sets/att-test-1' && init?.method === 'DELETE')).toBe(true);
  });
});

describe('catStateForPhase', () => {
  it('maps agent phases to cat character states', () => {
    expect(catStateForPhase('idle', true, true)).toBe('thinking');
    expect(catStateForPhase('idle', false, false)).toBe('sorry');
    expect(catStateForPhase('idle', false, true)).toBe('sleep');
    expect(catStateForPhase('planning', false, true)).toBe('thinking');
    expect(catStateForPhase('awaiting_approval', false, true)).toBe('waiting');
    expect(catStateForPhase('executing', false, true)).toBe('working');
    expect(catStateForPhase('completed', false, true)).toBe('done');
    expect(catStateForPhase('failed', false, true)).toBe('sorry');
    expect(catStateForPhase('held', false, true)).toBe('waiting');
    expect(catStateForPhase('recorded', false, true)).toBe('working');
  });

  it('shows the waiting cat while a plan awaits approval', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');
    fireEvent.change(screen.getByLabelText('任せたいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));

    await screen.findByText('まだ実行していません · 承認待ち');
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.getAttribute('data-state')).toBe('waiting');
    expect(cat.tagName).toBe('IMG');
    // 暗い絵柄が両テーマで沈まないよう、他の配置と同じ明るい台座の上に載る。
    expect(cat.closest('[data-testid="origin-cat-pedestal"]')).not.toBeNull();
  });

  it('lists saved results as cards tied to their content, date and artifact — not bare status words', async () => {
    const dateLabel = (createdAt: number) => new Date(createdAt).toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const docAt = new Date(2026, 10, 18, 9, 15).getTime();
    const researchAt = new Date(2026, 10, 19, 14, 2).getTime();
    const fileAt = new Date(2026, 10, 20, 19, 40).getTime();
    loadCheckpointsFromIndexedDB.mockResolvedValueOnce([
      {
        checkpointId: 'run-a-runs-v1', taskId: 'run-a', executionId: 'agent-run', version: 1,
        status: 'completed', artifact: '# 完成した文書\n本文です。', createdAt: docAt,
      },
      {
        checkpointId: 'run-b-runs-v1', taskId: 'run-b', executionId: 'agent-run', version: 1,
        status: 'completed',
        artifact: JSON.stringify({
          provider: 'tavily',
          sources: [
            { title: '出典その1', url: 'https://example.com/1' },
            { title: '出典その2', url: 'https://example.com/2' },
          ],
        }),
        createdAt: researchAt,
      },
      {
        checkpointId: 'run-c-runs-v1', taskId: 'run-c', executionId: 'agent-run', version: 1,
        status: 'self_fixed', artifact: '直した内容の説明です。', createdAt: fileAt,
        mutation: { path: 'artifacts/report.md', beforeExists: false, afterSha256: 'a'.repeat(64) },
      },
    ]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('利用できます');

    // Newest first; each card pairs a content-derived title with its
    // status, and the meta line carries the date (plus the source
    // count or the produced file when the record has one).
    const docCard = await screen.findByRole('button', { name: /完成した文書/ });
    expect(docCard.textContent).toContain('完了');
    expect(docCard.textContent).toContain(dateLabel(docAt));
    const researchCard = screen.getByRole('button', { name: /調査の結果/ });
    expect(researchCard.textContent).toContain('完了');
    expect(researchCard.textContent).toContain(dateLabel(researchAt));
    expect(researchCard.textContent).toContain('出典2件');
    // The raw sources JSON never leaks into the card.
    expect(researchCard.textContent).not.toContain('tavily');
    const fileCard = screen.getByRole('button', { name: /直した内容の説明です/ });
    expect(fileCard.textContent).toContain('修正済み');
    expect(fileCard.textContent).toContain(dateLabel(fileAt));
    expect(fileCard.textContent).toContain('artifacts/report.md');

    // Selecting a card still restores its artifact into the result area.
    fireEvent.click(docCard);
    await screen.findByRole('heading', { name: '完成した文書' });
    expect(screen.getByText('この端末に保存した結果を表示しました（サーバー側の状態は変わりません）。')).toBeTruthy();
  });
});
