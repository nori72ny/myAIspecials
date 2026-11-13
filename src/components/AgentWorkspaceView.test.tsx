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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));

    await screen.findByText('未実行 · 承認待ち');
    expect(screen.getByText(/まだツールは実行していません/)).toBeTruthy();
    expect(screen.getByLabelText('実行する機能').textContent).toContain('文書作成');
    expect((screen.getByLabelText('達成したいこと') as HTMLTextAreaElement).disabled).toBe(true);
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');

    fireEvent.change(screen.getByLabelText('実行認証キー'), { target: { value: 'owner-agent-key' } });
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
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/agent/v3/status',
      '/api/agent/v3/plan',
      '/api/agent/v3/runs?limit=50',
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: goal } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    expect(screen.getByLabelText('実行する機能').textContent).toContain('コード作成・確認');
    expect(screen.queryByRole('combobox')).toBeNull();

    fireEvent.change(screen.getByLabelText('実行認証キー'), { target: { value: 'owner-agent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));
    await screen.findByText('// verified analysis');
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.change(screen.getByLabelText('実行認証キー'), { target: { value: 'wrong-key' } });
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    // No credential is typed anywhere: the browser approval path must be used.
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByRole('heading', { name: 'ブラウザ承認で完成した文書' });
    // The delivered body is saved on-device as a local run record.
    expect(saveCheckpointToIndexedDB).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'run-test-1',
      status: 'completed',
      artifact: '# ブラウザ承認で完成した文書',
    }));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/agent/v3/status',
      '/api/agent/v3/plan',
      '/api/agent/v3/runs?limit=50',
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByRole('heading', { name: '継続駆動で完成した文書' }, { timeout: 5000 });
    expect(advanceCalls).toBe(2);
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('タスクの記録が利用できないため、安全に停止しました。実行は開始していません。');
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('無料枠の上限に達したため、実行を保留にしました。記録は残っているので、タスクボードから再開できます。');
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));
      for (let i = 0; i < 25 && !screen.queryByText('記録済み・実行中'); i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      }
      expect(screen.getByText('記録済み・実行中')).toBeTruthy();
      expect(screen.getByText('実行は記録済みで続行しています。進み具合はタスクボードで確認できます。')).toBeTruthy();
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.change(screen.getByLabelText('実行認証キー'), { target: { value: 'owner-agent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('タスクの記録が利用できないため、安全に停止しました。実行は開始していません。');
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.change(screen.getByLabelText('実行認証キー'), { target: { value: 'owner-agent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText('無料枠の上限に達したため、実行を保留にしました。記録は残っているので、タスクボードから再開できます。');
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '富士山について調べてまとめてください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
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

    // Completion: the delivered artifact is the research sources
    // JSON, rendered as source cards — the raw JSON never appears.
    await screen.findByText(/本文確認済み/, undefined, { timeout: 5000 });
    expect(screen.queryByText(/"sources"/)).toBeNull();
    expect(screen.getAllByRole('link', { name: '原文を開く' })).toHaveLength(3);
    expect(within(panel).getByText('作業が完了しました')).toBeTruthy();
    expect(advanceCalls).toBe(2);
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
    await screen.findByText('エージェントを利用できます');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));

    await screen.findByText('未実行 · 承認待ち');
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.getAttribute('data-state')).toBe('waiting');
    expect(cat.tagName).toBe('IMG');
    // 暗い絵柄が両テーマで沈まないよう、他の配置と同じ明るい台座の上に載る。
    expect(cat.closest('[data-testid="origin-cat-pedestal"]')).not.toBeNull();
  });
});
