import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadCheckpointsFromIndexedDB, saveCheckpointToIndexedDB } = vi.hoisted(() => ({
  loadCheckpointsFromIndexedDB: vi.fn(async () => []),
  saveCheckpointToIndexedDB: vi.fn(async () => undefined),
}));
vi.mock('../agent/indexedDbCheckpointStore', () => ({
  loadCheckpointsFromIndexedDB,
  saveCheckpointToIndexedDB,
}));

import AgentWorkspaceView from './AgentWorkspaceView';

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

function planResponse() {
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
    await screen.findByText('Agent v3 基盤を確認済み');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));

    await screen.findByText('未実行 · 承認待ち');
    expect(screen.getByText(/まだツールは実行していません/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent')).toBe(false);
  });

  it('uses exact v3 approval then execute and never stores the credential in component state', async () => {
    const checkpoint = {
      checkpointId: 'task-4-exec-test-v1',
      taskId: 'task-4',
      executionId: 'exec-test',
      version: 1,
      status: 'completed',
      artifact: '# 完成した文書',
      createdAt: Date.now(),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse(), 201);
      if (url === '/api/agent/v3/approval') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ runId: 'run-test-1', planToken: 'signed-plan-token', toolName: 'document_generator' });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', approvalToken: 'signed-approval-token', scope: 'exact-operation' }, 201);
      }
      if (url === '/api/agent/v3/execute') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ runId: 'run-test-1', toolName: 'document_generator', approvalToken: 'signed-approval-token' });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', status: 'completed', artifact: '# 完成した文書', checkpoint });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('Agent v3 基盤を確認済み');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');

    fireEvent.change(screen.getByLabelText('Agent認証キー'), { target: { value: 'owner-agent-key' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '承認して実行' })); });

    await waitFor(() => expect(screen.getByText('# 完成した文書')).toBeTruthy());
    expect(saveCheckpointToIndexedDB).toHaveBeenCalledWith(checkpoint);
    expect((screen.getByLabelText('Agent認証キー') as HTMLInputElement).value).toBe('');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/agent/v3/status',
      '/api/agent/v3/plan',
      '/api/agent/v3/approval',
      '/api/agent/v3/execute',
    ]);
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
    await screen.findByText('Agent v3 基盤を確認済み');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: '文書案を作ってください' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.change(screen.getByLabelText('Agent認証キー'), { target: { value: 'wrong-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText(/AGENT_AUTHENTICATION_REQUIRED/);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/v3/execute')).toBe(false);
  });
});
