// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CodingJobWorkspaceV14 from './CodingJobWorkspaceV14';

type JobStatus = 'queued' | 'leased' | 'running' | 'repairing' | 'verified' | 'blocked' | 'failed' | 'cancelled';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function job(status: JobStatus) {
  const now = new Date('2026-09-11T00:00:00.000Z').toISOString();
  return {
    jobId: 'coding-AAAAAAAAAAAAAAAAAAAAAA',
    targetKey: 'origin:self',
    status,
    attempt: status === 'queued' ? 0 : 1,
    version: 2,
    cancelRequested: false,
    resultCode: status === 'verified' ? 'CODING_CHECKS_PASSED' : status === 'cancelled' ? 'CODING_CANCELLED_BY_USER' : null,
    changedPaths: status === 'verified' ? ['src/existing.ts'] : [],
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date('2026-09-12T00:00:00.000Z').toISOString(),
  };
}

const capability = {
  ok: true,
  ready: true,
  controlPlaneReady: true,
  databaseReady: true,
  storeConfigured: true,
  resultStoreConfigured: true,
  storeReady: true,
  resultStoreReady: true,
  authorizationReady: true,
  ownerBindingReady: true,
  dataKeyReady: true,
  cryptoReady: true,
  dispatchReady: true,
  workerEnabled: true,
  resultDetailsReady: true,
  authorizationMode: 'coding-operator' as const,
  authorizationScope: 'coding-v1.4-only-when-dedicated',
  freeOnly: true,
  costUsd: 0,
  gitPublished: false,
  deployed: false,
};

const result = {
  schemaVersion: 1 as const,
  sessionStatus: 'verified' as const,
  repairRounds: 1,
  diffs: [{
    path: 'src/existing.ts',
    kind: 'modified' as const,
    before: 'export const value = 1;',
    after: 'export const value = 2;',
    beforeTruncated: false,
    afterTruncated: false,
    previewAvailable: true,
  }],
  verificationChecks: (['typecheck', 'lint', 'test', 'build'] as const).map(kind => ({
    kind,
    ok: true,
    exitCode: 0,
    timedOut: false,
    attempt: 1,
  })),
  freeOnly: true as const,
  costUsd: 0 as const,
  gitPublished: false as const,
  deployed: false as const,
};

describe('CodingJobWorkspaceV14', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('submits a natural-language job, clears the credential field, and renders encrypted result evidence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: job('verified'), result, resultDetailsState: 'available' }, 202));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('configured');
    expect(screen.getByText('dedicated coding credential')).toBeTruthy();

    const credential = 'operator-secret-that-is-long-enough-for-production';
    const credentialInput = screen.getByLabelText('Coding認証キー') as HTMLInputElement;
    fireEvent.change(credentialInput, { target: { value: credential } });
    fireEvent.change(screen.getByLabelText('変更したいこと'), { target: { value: 'Fix the parser and add regression coverage.' } });
    fireEvent.click(screen.getByRole('button', { name: '変更を依頼する' }));

    await screen.findByText('src/existing.ts');
    expect(credentialInput.value).toBe('');
    expect(screen.getByText('export const value = 1;')).toBeTruthy();
    expect(screen.getByText('export const value = 2;')).toBeTruthy();
    expect(screen.getAllByText('PASS')).toHaveLength(4);
    expect(screen.getByText('CODING_CHECKS_PASSED')).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/coding/v1.4/jobs');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${credential}`);
    expect(JSON.parse(String(options.body))).toEqual({ goal: 'Fix the parser and add regression coverage.', confirmRun: true });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('renders only non-secret readiness state and keeps submission fail-closed when prerequisites are missing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      ...capability,
      ready: false,
      controlPlaneReady: false,
      databaseReady: false,
      storeConfigured: false,
      resultStoreConfigured: false,
      storeReady: false,
      resultStoreReady: false,
      ownerBindingReady: false,
      dataKeyReady: false,
      cryptoReady: false,
      dispatchReady: false,
      workerEnabled: false,
      resultDetailsReady: false,
      authorizationMode: 'legacy-agent-compat',
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    expect(await screen.findByLabelText('Coding production readiness')).toBeTruthy();
    expect(screen.getByText('Database config')).toBeTruthy();
    expect(screen.getByText('Live job/result schema')).toBeTruthy();
    expect(screen.getByText('Owner binding')).toBeTruthy();
    expect(screen.getByText('Encryption')).toBeTruthy();
    expect(screen.getByText('Dedicated coding auth')).toBeTruthy();
    expect(screen.getByText('GitHub dispatch')).toBeTruthy();
    expect(screen.getByText('Worker opt-in')).toBeTruthy();
    expect(screen.getAllByText('missing').length).toBeGreaterThanOrEqual(7);
    expect(screen.queryByText(/postgres:\/\//i)).toBeNull();
    expect(screen.queryByText(/Bearer\s+[A-Za-z0-9_-]+/i)).toBeNull();

    fireEvent.change(screen.getByLabelText('変更したいこと'), { target: { value: 'Do not submit while readiness is false.' } });
    expect((screen.getByRole('button', { name: '変更を依頼する' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reopens a terminal owner-scoped job and renders its stored result without persisting identifiers', async () => {
    const credential = 'operator-secret-that-is-long-enough-for-production';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: job('verified'), result, resultDetailsState: 'available' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('configured');
    const credentialInput = screen.getByLabelText('Coding認証キー') as HTMLInputElement;
    fireEvent.change(credentialInput, { target: { value: credential } });
    fireEvent.change(screen.getByLabelText('既存のジョブID'), { target: { value: 'coding-AAAAAAAAAAAAAAAAAAAAAA' } });
    fireEvent.click(screen.getByRole('button', { name: '結果を開く' }));

    await screen.findByText('CODING_CHECKS_PASSED');
    expect(credentialInput.value).toBe('');
    expect(screen.getByText('src/existing.ts')).toBeTruthy();
    expect(screen.getAllByText('PASS')).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/coding/v1.4/jobs/coding-AAAAAAAAAAAAAAAAAAAAAA');
    expect(options.method).toBeUndefined();
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${credential}`);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('reopens an active job and keeps cancellation control attached to the same in-memory credential', async () => {
    const credential = 'operator-secret-that-is-long-enough-for-production';
    const cancelled = { ...job('cancelled'), cancelRequested: true, version: 3 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: job('running'), result: null, resultDetailsState: 'pending' }))
      .mockResolvedValueOnce(response({ ok: true, job: cancelled, result: null, resultDetailsState: 'not_applicable' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('configured');
    fireEvent.change(screen.getByLabelText('Coding認証キー'), { target: { value: credential } });
    fireEvent.change(screen.getByLabelText('既存のジョブID'), { target: { value: 'coding-AAAAAAAAAAAAAAAAAAAAAA' } });
    fireEvent.click(screen.getByRole('button', { name: '結果を開く' }));

    await screen.findAllByText('コードを変更中');
    fireEvent.click(screen.getByRole('button', { name: '依頼を取り消す' }));
    await waitFor(() => expect(screen.getAllByText('取消済み').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, options] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('/api/coding/v1.4/jobs/coding-AAAAAAAAAAAAAAAAAAAAAA');
    expect(options.method).toBe('DELETE');
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${credential}`);
  });

  it('rejects malformed reconnect ids before sending an authenticated job request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(capability));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('configured');
    fireEvent.change(screen.getByLabelText('Coding認証キー'), { target: { value: 'operator-secret-that-is-long-enough-for-production' } });
    fireEvent.change(screen.getByLabelText('既存のジョブID'), { target: { value: 'coding-invalid' } });
    expect((screen.getByRole('button', { name: '結果を開く' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders terminal blocked verification truthfully instead of leaving WAIT states', async () => {
    const blockedResult = {
      ...result,
      sessionStatus: 'blocked' as const,
      repairRounds: 0,
      diffs: [],
      verificationChecks: [],
    };
    const blockedJob = { ...job('blocked'), resultCode: 'CODING_SCOPE_BLOCKED', version: 3 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: blockedJob, result: blockedResult, resultDetailsState: 'available' }, 202));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('configured');
    fireEvent.change(screen.getByLabelText('Coding認証キー'), { target: { value: 'operator-secret-that-is-long-enough-for-production' } });
    fireEvent.change(screen.getByLabelText('変更したいこと'), { target: { value: 'Attempt a bounded change.' } });
    fireEvent.click(screen.getByRole('button', { name: '変更を依頼する' }));

    await screen.findByText('CODING_SCOPE_BLOCKED');
    expect(screen.getAllByText('NOT RUN')).toHaveLength(4);
    expect(screen.queryByText('WAIT')).toBeNull();
  });

  it('surfaces legacy agent authorization as an explicit compatibility warning', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      ...capability,
      authorizationMode: 'legacy-agent-compat',
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    expect(await screen.findByText('legacy agent compatibility')).toBeTruthy();
    expect(screen.getByText(/ORIGIN_CODING_OPERATOR_SECRET/)).toBeTruthy();
  });

  it('does not enable submission from an unsuccessful status response containing ready true', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(capability, 503));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('設定を確認できません');
    fireEvent.change(screen.getByLabelText('変更したいこと'), { target: { value: 'Fix the parser.' } });
    expect((screen.getByRole('button', { name: '変更を依頼する' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains dispatch permission errors without automatic resubmission or raw provider details', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: false, code: 'CODING_JOB_DISPATCH_PERMISSION_DENIED', message: 'private-provider-response' }, 503));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('設定確認済み');
    expect(screen.queryByText('Hosted worker')).toBeNull();
    fireEvent.change(screen.getByLabelText('Coding認証キー'), { target: { value: 'operator-secret-that-is-long-enough-for-production' } });
    fireEvent.change(screen.getByLabelText('変更したいこと'), { target: { value: 'Fix the parser.' } });
    fireEvent.click(screen.getByRole('button', { name: '変更を依頼する' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('GitHubがワーカーの起動を拒否しました');
    expect(alert.textContent).toContain('CODING_JOB_DISPATCH_PERMISSION_DENIED');
    expect(alert.textContent).not.toContain('private-provider-response');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('does not turn cancellation before worker claim into measured progress or completed stages', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: { ...job('cancelled'), attempt: 0 }, result: null, resultDetailsState: 'not_applicable' })));
    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('設定確認済み');
    fireEvent.change(screen.getByLabelText('Coding認証キー'), { target: { value: 'operator-secret-that-is-long-enough-for-production' } });
    fireEvent.change(screen.getByLabelText('既存のジョブID'), { target: { value: 'coding-AAAAAAAAAAAAAAAAAAAAAA' } });
    fireEvent.click(screen.getByRole('button', { name: '結果を開く' }));
    await screen.findByText('CODING_CANCELLED_BY_USER');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText('PASS')).toBeNull();
    expect(screen.queryByText('Discover / Edit')).toBeNull();
    expect(screen.getAllByText(/この状態だけでは分かりません/).length).toBeGreaterThan(0);
  });

  it('requests cancellation through the owner-authenticated DELETE route', async () => {
    const cancelled = { ...job('cancelled'), cancelRequested: true, version: 3 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: job('running'), result: null, resultDetailsState: 'pending' }, 202))
      .mockResolvedValueOnce(response({ ok: true, job: cancelled, result: null, resultDetailsState: 'not_applicable' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('configured');
    fireEvent.change(screen.getByLabelText('Coding認証キー'), { target: { value: 'operator-secret-that-is-long-enough-for-production' } });
    fireEvent.change(screen.getByLabelText('変更したいこと'), { target: { value: 'Fix the parser.' } });
    fireEvent.click(screen.getByRole('button', { name: '変更を依頼する' }));
    await screen.findAllByText('コードを変更中');

    fireEvent.click(screen.getByRole('button', { name: '依頼を取り消す' }));
    await waitFor(() => expect(screen.getAllByText('取消済み').length).toBeGreaterThan(0));
    expect(screen.getAllByText('CANCELLED')).toHaveLength(4);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, options] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('/api/coding/v1.4/jobs/coding-AAAAAAAAAAAAAAAAAAAAAA');
    expect(options.method).toBe('DELETE');
  });
});
