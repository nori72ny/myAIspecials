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

import AgentWorkspaceView, { isConfirmedCodingCancelAcknowledgement, isConfirmedCodingCancellationReceipt, isVerifiedCodingReceipt, verifiedCodingArtifact } from './AgentWorkspaceView';

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
    codingBridgeConfigured: true,
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
    plan: [
      { id: 'task-1', title: 'Goal analysis' },
      { id: 'task-2', title: 'Task decomposition' },
      { id: 'task-3', title: 'Self-critique' },
      { id: 'task-4', title: 'Execution' },
      { id: 'task-5', title: 'Verification' },
    ],
  };
}

describe('Coding V1.4 verified result presentation', () => {
  const baseResult = {
    schemaVersion: 1 as const,
    sessionStatus: 'verified' as const,
    repairRounds: 1,
    diffs: [{
      path: 'src/math.ts',
      kind: 'modified' as const,
      before: 'return a - b;',
      after: 'return a + b;',
      beforeTruncated: false,
      afterTruncated: false,
      previewAvailable: true,
    }],
    verificationChecks: (['typecheck', 'lint', 'test', 'build'] as const).map(kind => ({
      kind, ok: true, exitCode: 0, timedOut: false, attempt: 1,
    })),
    freeOnly: true as const,
    costUsd: 0 as const,
    gitPublished: false as const,
    deployed: false as const,
  };

  it('shows actual bounded before and after code plus all four checks, without claiming publication', () => {
    const visible = verifiedCodingArtifact(baseResult);
    expect(visible).toContain('src/math.ts');
    expect(visible).toContain('return a - b;');
    expect(visible).toContain('return a + b;');
    expect(visible).toContain('typecheck: PASS');
    expect(visible).toContain('lint: PASS');
    expect(visible).toContain('test: PASS');
    expect(visible).toContain('build: PASS');
    expect(visible).toContain('Git publish: not authorized');
    expect(visible).toContain('Deploy: not authorized');
  });

  it('labels truncated and unavailable previews instead of silently implying complete source', () => {
    const visible = verifiedCodingArtifact({
      ...baseResult,
      diffs: [
        { ...baseResult.diffs[0], beforeTruncated: true, afterTruncated: true },
        { path: 'src/other.ts', kind: 'modified', before: null, after: null,
          beforeTruncated: false, afterTruncated: false, previewAvailable: false },
      ],
    });
    expect(visible).toContain('変更前（一部省略）');
    expect(visible).toContain('変更後（一部省略）');
    expect(visible).toContain('src/other.ts');
    expect(visible).toContain('プレビューを取得できません');
    expect(visible).toContain('完全なGit差分・デプロイ済みコードを意味しません');
  });
});

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
    expect(screen.getByLabelText('計画で固定されたツール').textContent).toContain('document_generator');
    expect((screen.getByLabelText('達成したいこと') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent')).toBe(false);
  });

  it('uses exact v3 approval then execute with the original goal instead of the rendered plan artifact', async () => {
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
        expect(body.params).toEqual({ content: '文書案を作ってください' });
        return json({ ok: true, protocolVersion: 3, runId: 'run-test-1', approvalToken: 'signed-approval-token', scope: 'exact-operation' }, 201);
      }
      if (url === '/api/agent/v3/execute') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ runId: 'run-test-1', toolName: 'document_generator', approvalToken: 'signed-approval-token' });
        expect(body.params).toEqual({ content: '文書案を作ってください' });
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
    expect(screen.queryByLabelText('Agent認証キー')).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/agent/v3/status',
      '/api/agent/v3/plan',
      '/api/agent/v3/approval',
      '/api/agent/v3/execute',
    ]);
  });

  it('rejects forged coding completion, missing checks, cross-run receipts and paid fallback', () => {
    const valid = {
      ok: true,
      status: 'completed',
      verified: true,
      codingStatus: 'verified',
      runId: 'run-test-1',
      jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      result: {
        schemaVersion: 1,
        sessionStatus: 'verified',
        repairRounds: 1,
        diffs: [{
          path: 'src/math.ts', kind: 'modified',
          before: 'return a - b', after: 'return a + b',
          beforeTruncated: false, afterTruncated: false, previewAvailable: true,
        }],
        verificationChecks: (['typecheck', 'lint', 'test', 'build'] as const).map(kind => ({
          kind, ok: true, exitCode: 0, timedOut: false, attempt: 1,
        })),
        freeOnly: true, costUsd: 0, gitPublished: false, deployed: false,
      },
    } as const;
    const verify = (candidate: unknown) => isVerifiedCodingReceipt(
      candidate as Parameters<typeof isVerifiedCodingReceipt>[0],
      'run-test-1', 'coding-AAAAAAAAAAAAAAAAAAAAAA',
    );
    expect(verify(valid)).toBe(true);
    expect(verify({ ...valid, runId: 'run-other' })).toBe(false);
    expect(verify({ ...valid, jobId: 'coding-BBBBBBBBBBBBBBBBBBBBBB' })).toBe(false);
    expect(verify({ ...valid, paidFallbackUsed: true })).toBe(false);
    expect(verify({ ...valid, status: 'running' })).toBe(false);
    expect(verify({ ...valid, result: { ...valid.result, verificationChecks: valid.result.verificationChecks.slice(0, 3) } })).toBe(false);
    expect(verify({ ...valid, result: { ...valid.result, diffs: [] } })).toBe(false);
    expect(verify({ ...valid, result: { ...valid.result, deployed: true } })).toBe(false);
    expect(verify({ ...valid, result: { ...valid.result, verificationChecks: valid.result.verificationChecks.map(check => ({
      ...check, attempt: 0,
    })) } })).toBe(false);
  });

  it('runs a server-planned coding task asynchronously and waits for verified four-check evidence', async () => {
    const goal = 'このTypeScriptコードのバグを分析して';
    const verificationChecks = ['typecheck', 'lint', 'test', 'build'].map((kind) => ({
      kind,
      ok: true,
      exitCode: 0,
      timedOut: false,
      attempt: 1,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse('code_interpreter'), 201);
      if (url === '/api/agent/v3/approval') {
        const body = JSON.parse(String(init?.body));
        expect(body.toolName).toBe('code_interpreter');
        expect(body.params).toEqual({ goal });
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        return json({ ok: true, approvalToken: 'signed-approval-token' }, 201);
      }
      if (url === '/api/agent/v3/execute') {
        const body = JSON.parse(String(init?.body));
        expect(body.toolName).toBe('code_interpreter');
        expect(body.params).toEqual({ goal });
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer owner-agent-key');
        return json({
          ok: true,
          status: 'running',
          runId: 'run-test-1',
          jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
          bridgeToken: 'bridge-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
        }, 202);
      }
      if (url === '/api/agent/v3/coding/status') {
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
        expect(JSON.parse(String(init?.body))).toEqual({
          runId: 'run-test-1',
          jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
          bridgeToken: 'bridge-token',
        });
        return json({
          ok: true,
          status: 'completed',
          codingStatus: 'verified',
          verified: true,
          runId: 'run-test-1',
          jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          result: {
            schemaVersion: 1,
            sessionStatus: 'verified',
            repairRounds: 1,
            diffs: [{
              path: 'src/example.ts',
              kind: 'modified',
              before: 'old',
              after: 'new',
              beforeTruncated: false,
              afterTruncated: false,
              previewAvailable: true,
            }],
            verificationChecks,
            freeOnly: true,
            costUsd: 0,
            gitPublished: false,
            deployed: false,
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('Agent v3 基盤を確認済み');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: goal } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    expect(screen.getByLabelText('計画で固定されたツール').textContent).toContain('code_interpreter');

    fireEvent.change(screen.getByLabelText('Agent認証キー'), { target: { value: 'owner-agent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));

    await screen.findByText(/# Coding V1\.4 検証済み結果/);
    expect(screen.getByText(/src\/example\.ts/)).toBeTruthy();
    expect(screen.getByText(/typecheck: PASS/)).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/agent/v3/status',
      '/api/agent/v3/plan',
      '/api/agent/v3/approval',
      '/api/agent/v3/execute',
      '/api/agent/v3/coding/status',
    ]);
  });

  it('never displays completion or abandons an active job after a cross-run fake terminal receipt', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse('code_interpreter'), 201);
      if (url === '/api/agent/v3/approval') return json({ ok: true, approvalToken: 'approved' }, 201);
      if (url === '/api/agent/v3/execute') return json({
        ok: true, status: 'running', runId: 'run-test-1',
        jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
        bridgeToken: 'bound-token', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, 202);
      if (url === '/api/agent/v3/coding/status') return json({
        ok: true, status: 'completed', verified: true, codingStatus: 'verified',
        runId: 'run-OTHER', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
        freeOnly: true, costUsd: 0, paidFallbackUsed: false,
        result: { schemaVersion: 1, sessionStatus: 'verified', repairRounds: 1,
          diffs: [], verificationChecks: [], freeOnly: true, costUsd: 0,
          gitPublished: false, deployed: false },
      });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentWorkspaceView />);
    await screen.findByText('Agent v3 基盤を確認済み');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: 'TypeScriptコードを修正して' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.change(screen.getByLabelText('Agent認証キー'), { target: { value: 'test-only' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));
    await screen.findByText(/AGENT_CODING_RECEIPT_INVALID/);
    expect(screen.queryByText(/# Coding V1\.4 検証済み結果/)).toBeNull();
    const reset = screen.getByRole('button', { name: '先にジョブを中止' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    expect(screen.getByRole('button', { name: '実行中のCodingジョブを中止' })).toBeTruthy();
  });

  it('treats only the matching trusted server terminal as a confirmed cancellation', () => {
    const valid = {
      ok: false, status: 'blocked', codingStatus: 'cancelled',
      code: 'AGENT_CODING_CANCELLED', runId: 'run-test-1',
      jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
      verified: false, freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    };
    const confirmation = (body: typeof valid) =>
      isConfirmedCodingCancellationReceipt(body, 'run-test-1', 'coding-AAAAAAAAAAAAAAAAAAAAAA');
    expect(confirmation(valid)).toBe(true);
    expect(confirmation({ ...valid, runId: 'run-other' })).toBe(false);
    expect(confirmation({ ...valid, jobId: 'coding-BBBBBBBBBBBBBBBBBBBBBB' })).toBe(false);
    expect(confirmation({ ...valid, status: 'running' })).toBe(false);
    expect(confirmation({ ...valid, codingStatus: 'verified' })).toBe(false);
    expect(confirmation({ ...valid, verified: true })).toBe(false);
    expect(confirmation({ ...valid, paidFallbackUsed: true })).toBe(false);
    expect(confirmation({ ...valid, costUsd: 0.01 })).toBe(false);
    expect(confirmation({ ...valid, code: 'AGENT_CODING_RESULT_INVALID' })).toBe(false);
  });

  it('releases the active job lock only after the exact server cancellation terminal is observed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse('code_interpreter'), 201);
      if (url === '/api/agent/v3/approval') return json({ ok: true, approvalToken: 'approved' }, 201);
      if (url === '/api/agent/v3/execute') return json({
        ok: true, status: 'running',
        runId: 'run-test-1', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
        bridgeToken: 'bound-token', expiresAt: new Date(Date.now() + 60_000).toISOString(),
        freeOnly: true, costUsd: 0, paidFallbackUsed: false,
      }, 202);
      if (url === '/api/agent/v3/coding/status') return json({
        ok: false, status: 'blocked', codingStatus: 'cancelled',
        code: 'AGENT_CODING_CANCELLED',
        runId: 'run-test-1', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
        verified: false, freeOnly: true, costUsd: 0, paidFallbackUsed: false,
      }, 409);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentWorkspaceView />);
    await screen.findByText('Agent v3 基盤を確認済み');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: 'TypeScriptコードを修正して' } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.change(screen.getByLabelText('Agent認証キー'), { target: { value: 'test-only' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));
    await screen.findByText(/Codingジョブの中止をサーバーの終端状態で確認しました/);
    expect(screen.queryByText(/# Coding V1\.4 検証済み結果/)).toBeNull();
    expect(screen.queryByRole('button', { name: '実行中のCodingジョブを中止' })).toBeNull();
    expect(screen.getByRole('button', { name: '実行計画を作る' })).toBeTruthy();
  });

  it('rejects forged or cross-run cancellation acknowledgements and preserves zero-spend scope', () => {
    const correct = {
      ok: true, runId: 'run-test-1', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
      status: 'cancelled', codingStatus: 'cancelled', cancelRequested: true,
      freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    };
    const check = (receipt: typeof correct) => isConfirmedCodingCancelAcknowledgement(
      receipt, correct.runId, correct.jobId,
    );
    expect(check(correct)).toBe(true);
    expect(check({ ...correct, status: 'cancelling', codingStatus: 'running' })).toBe(true);
    expect(check({ ...correct, runId: 'run-other' })).toBe(false);
    expect(check({ ...correct, jobId: 'coding-BBBBBBBBBBBBBBBBBBBBBB' })).toBe(false);
    expect(check({ ...correct, cancelRequested: false })).toBe(false);
    expect(check({ ...correct, status: 'completed' })).toBe(false);
    expect(check({ ...correct, codingStatus: 'verified' })).toBe(false);
    expect(check({ ...correct, paidFallbackUsed: true })).toBe(false);
    expect(check({ ...correct, freeOnly: false })).toBe(false);
    expect(check({ ...correct, costUsd: 1 })).toBe(false);
  });

  it('cancels a dispatched Coding V1.4 job through the server instead of only aborting browser polling', async () => {
    const goal = 'TypeScript の不具合を修正して';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === '/api/agent/v3/status') return json(readyStatus());
      if (url === '/api/agent/v3/plan') return json(planResponse('code_interpreter'), 201);
      if (url === '/api/agent/v3/approval') return json({ ok: true, approvalToken: 'signed-approval-token' }, 201);
      if (url === '/api/agent/v3/execute') return json({
        ok: true,
        status: 'running',
        runId: 'run-test-1',
        jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
        bridgeToken: 'scoped-bridge-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, 202);
      if (url === '/api/agent/v3/coding/status') return new Promise<Response>(() => undefined);
      if (url === '/api/agent/v3/coding/cancel') {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
        expect(JSON.parse(String(init?.body))).toEqual({
          runId: 'run-test-1',
          jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
          bridgeToken: 'scoped-bridge-token',
        });
        return json({
          ok: true, runId: 'run-test-1', jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
          status: 'cancelled', codingStatus: 'cancelled', cancelRequested: true,
          freeOnly: true, costUsd: 0, paidFallbackUsed: false,
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspaceView />);
    await screen.findByText('Agent v3 基盤を確認済み');
    fireEvent.change(screen.getByLabelText('達成したいこと'), { target: { value: goal } });
    fireEvent.click(screen.getByRole('button', { name: '実行計画を作る' }));
    await screen.findByText('未実行 · 承認待ち');
    fireEvent.change(screen.getByLabelText('Agent認証キー'), { target: { value: 'owner-agent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '承認して実行' }));
    fireEvent.click(await screen.findByRole('button', { name: '実行中のCodingジョブを中止' }));
    await screen.findByText(/Codingジョブはサーバー側で中止されました/);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/v3/coding/cancel')).toBe(true);
    expect(screen.queryByText(/Coding V1\.4 の最終4検証が完了しました/)).toBeNull();
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
