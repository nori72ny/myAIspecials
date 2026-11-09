import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AgentTaskBoard from './AgentTaskBoard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const iso = (ms: number) => new Date(ms).toISOString();

function runView(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    runId: 'run-board-1',
    status: 'held',
    goal: '調査レポートを作ってください',
    plan: [
      { toolName: 'web_search_grounding', params: { query: '調査' }, dependsOn: [] },
      { toolName: 'document_generator', params: { content: '本文' }, dependsOn: [0] },
    ],
    planDigest: 'digest-1',
    stepsState: [
      { id: 'task-1', status: 'completed', attempts: 1 },
      { id: 'task-2', status: 'queued', attempts: 0 },
    ],
    parentRunId: null,
    priority: 0,
    hold: {
      reason: 'quota_exhausted',
      resumeCondition: { kind: 'quota_reset', provider: 'tavily', resetAt: now + 3_600_000 },
      heldSince: now - 3_600_000,
      resumeAttempts: 0,
    },
    quotaLedger: {},
    createdAt: iso(now - 7_200_000),
    updatedAt: iso(now - 3_600_000),
    expiresAt: iso(now + 7 * 86_400_000),
    ...overrides,
  };
}

describe('AgentTaskBoard', () => {
  it('does not fetch on mount when neither a credential nor a plan exists', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('must not be called'); });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTaskBoard />);
    fireEvent.click(screen.getByRole('button', { name: 'タスクを表示' }));

    expect(await screen.findByText(/管理者キーを入力するか、この画面で計画を作成してください/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists runs in the four groups with plain-language held details for the operator', async () => {
    const now = Date.now();
    const runs = [
      runView({ runId: 'run-board-await', status: 'awaiting_approval', goal: '承認待ちの仕事', hold: null }),
      runView({
        runId: 'run-board-run',
        status: 'running',
        goal: '実行中の仕事',
        hold: null,
        stepsState: [
          { id: 'task-1', status: 'completed', attempts: 1 },
          { id: 'task-2', status: 'running', attempts: 1 },
        ],
      }),
      runView({}),
      runView({ runId: 'run-board-done', status: 'completed', goal: '完了した仕事', hold: null, createdAt: iso(now - 90_000) }),
      runView({ runId: 'run-board-failed', status: 'failed', goal: '失敗した仕事', hold: null }),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/agent/v3/runs')) {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-key');
        return json({ ok: true, protocolVersion: 3, runs, freeOnly: true, costUsd: 0, paidFallbackUsed: false });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTaskBoard />);
    fireEvent.change(screen.getByLabelText('タスク用の実行認証キー'), { target: { value: 'owner-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'タスクを表示' }));

    expect(await screen.findByRole('heading', { name: /承認待ち/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /実行中/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /保留中/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /完了・終了/ })).toBeTruthy();
    // Held row: reason, resume condition and remaining days in plain words,
    // with step progress — and no internal codes or provider ids.
    const heldRow = screen.getByText('調査レポートを作ってください').closest('article');
    expect(heldRow?.textContent).toContain('保留中');
    expect(heldRow?.textContent).toContain('ステップ 1/2');
    expect(heldRow?.textContent).toContain('無料枠の回復待ち');
    expect(heldRow?.textContent).toContain('無料枠の回復後に再開できます');
    expect(heldRow?.textContent).toContain('あと7日で記録の期限切れ');
    expect(heldRow?.textContent).not.toContain('quota_exhausted');
    expect(heldRow?.textContent).not.toContain('tavily');
    const runningRow = screen.getByText('実行中の仕事').closest('article');
    expect(runningRow?.textContent).toContain('ステップ 1/2');
  });

  it('auto-loads runs once when a browser plan token is available', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input).startsWith('/api/agent/v3/runs?')).toBe(true);
      expect(new Headers(init?.headers).get('x-agent-plan-token')).toBe('plan-token-1');
      return json({ ok: true, runs: [runView({})] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTaskBoard browserPlanToken="plan-token-1" />);

    expect(await screen.findByText('調査レポートを作ってください')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports honestly when the run store is unavailable', async () => {
    const fetchMock = vi.fn(async () => json({ ok: false, code: 'AGENT_RUN_STORE_UNAVAILABLE' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTaskBoard browserPlanToken="plan-token-1" />);

    expect(await screen.findByText('タスクの記録は現在利用できません。')).toBeTruthy();
  });

  it('shows step details and the one-at-a-time write note for a queued write plan', async () => {
    const queued = runView({
      status: 'queued',
      hold: null,
      plan: [
        { toolName: 'web_search_grounding', params: { query: '調査' }, dependsOn: [] },
        { toolName: 'file_writer', params: { path: 'artifacts/a.md', content: 'x' }, dependsOn: [0] },
      ],
    });
    const fetchMock = vi.fn(async () => json({ ok: true, runs: [queued] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTaskBoard browserPlanToken="plan-token-1" />);
    await screen.findByText('調査レポートを作ってください');
    fireEvent.click(screen.getByRole('button', { name: '詳細' }));

    expect(await screen.findByText(/1\. ウェブ調査/)).toBeTruthy();
    expect(screen.getByText(/2\. ファイルの作成・編集/)).toBeTruthy();
    expect(screen.getByText(/書き込みと重ならないよう、1件ずつ順番に実行されます/)).toBeTruthy();
  });

  it('cancels a queued run after an inline confirmation and reloads the list', async () => {
    const queued = runView({ status: 'queued', hold: null });
    const cancelled = runView({ status: 'cancelled', hold: null });
    let listCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/agent/v3/runs?')) {
        listCalls += 1;
        return json({ ok: true, runs: [listCalls === 1 ? queued : cancelled] });
      }
      if (url === '/api/agent/v3/runs/run-board-1/cancel') {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-key');
        return json({ ok: true, runId: 'run-board-1', cancellation: 'run-record' });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTaskBoard />);
    fireEvent.change(screen.getByLabelText('タスク用の実行認証キー'), { target: { value: 'owner-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'タスクを表示' }));
    await screen.findByText('調査レポートを作ってください');

    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '本当に取り消す' })); });

    await waitFor(() => expect(screen.getByText('取り消し済み')).toBeTruthy());
    expect(listCalls).toBe(2);
  });

  it('resumes a held run in browser mode: re-plan diff, fresh approval, confirm with the original token', async () => {
    const held = runView({});
    const queued = runView({ status: 'queued', hold: null });
    let listCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/agent/v3/runs?')) {
        expect(new Headers(init?.headers).get('x-agent-plan-token')).toBe('original-token');
        listCalls += 1;
        return json({ ok: true, runs: [listCalls === 1 ? held : queued] });
      }
      if (url === '/api/agent/v3/runs/run-board-1/resume') {
        expect(JSON.parse(String(init?.body))).toEqual({ planToken: 'original-token' });
        return json({
          ok: true,
          runId: 'run-board-1',
          status: 'awaiting_approval',
          resumed: true,
          planToken: 'fresh-token',
          planExpiresAt: iso(Date.now() + 600_000),
          planChanged: true,
          planDiff: {
            changed: true,
            previousStepCount: 2,
            nextStepCount: 3,
            steps: [
              { index: 0, change: 'unchanged', toolName: 'web_search_grounding', previousToolName: 'web_search_grounding', paramsChanged: false },
              { index: 1, change: 'unchanged', toolName: 'document_generator', previousToolName: 'document_generator', paramsChanged: false },
              { index: 2, change: 'added', toolName: 'verification_runner', previousToolName: null, paramsChanged: false },
            ],
          },
          steps: [
            { toolName: 'web_search_grounding', reasonCode: 'research', params: { query: '調査' } },
            { toolName: 'document_generator', reasonCode: 'draft', params: { content: '本文' } },
            { toolName: 'verification_runner', reasonCode: 'verify', params: { kind: 'test' } },
          ],
          plan: [
            { id: 'task-1', title: 'ウェブで調べる' },
            { id: 'task-2', title: '文書を作る' },
            { id: 'task-3', title: '確認する' },
          ],
        });
      }
      if (url === '/api/agent/v3/browser-approval') {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ runId: 'run-board-1', planToken: 'fresh-token', confirm: true });
        expect(Array.isArray(body.steps)).toBe(true);
        return json({ ok: true, approvalToken: 'approval-token-1' }, 201);
      }
      if (url === '/api/agent/v3/runs/run-board-1/resume/confirm') {
        // Record access stays bound to the ORIGINAL plan capability; the
        // fresh token is for approval only (PR 1-C contract).
        expect(JSON.parse(String(init?.body))).toEqual({ planToken: 'original-token', approvalToken: 'approval-token-1' });
        return json({ ok: true, runId: 'run-board-1', status: 'queued', confirmed: true });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentTaskBoard browserPlanToken="original-token" />);
    await screen.findByText('調査レポートを作ってください');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再開する' })); });
    expect(await screen.findByText('計画が前回から変わっています。内容を確認してから承認してください。')).toBeTruthy();
    expect(screen.getByText('追加: テスト・動作確認')).toBeTruthy();
    expect(screen.getByText('再開には新しい承認が必要です。承認すると、この仕事は実行待ちに入ります。やめた場合、この仕事は「承認待ち」のまま残ります。')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '承認して再開する' })); });
    await waitFor(() => expect(screen.getByText('実行待ち')).toBeTruthy());
    expect(listCalls).toBe(2);
  });
});
