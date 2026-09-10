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
    const credentialInput = screen.getByLabelText('Coding operator credential') as HTMLInputElement;
    fireEvent.change(credentialInput, { target: { value: credential } });
    fireEvent.change(screen.getByLabelText('Coding goal'), { target: { value: 'Fix the parser and add regression coverage.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start coding job' }));

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
    fireEvent.change(screen.getByLabelText('Coding operator credential'), { target: { value: 'operator-secret-that-is-long-enough-for-production' } });
    fireEvent.change(screen.getByLabelText('Coding goal'), { target: { value: 'Attempt a bounded change.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start coding job' }));

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

  it('requests cancellation through the owner-authenticated DELETE route', async () => {
    const cancelled = { ...job('cancelled'), cancelRequested: true, version: 3 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: job('running'), result: null, resultDetailsState: 'pending' }, 202))
      .mockResolvedValueOnce(response({ ok: true, job: cancelled, result: null, resultDetailsState: 'not_applicable' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('configured');
    fireEvent.change(screen.getByLabelText('Coding operator credential'), { target: { value: 'operator-secret-that-is-long-enough-for-production' } });
    fireEvent.change(screen.getByLabelText('Coding goal'), { target: { value: 'Fix the parser.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start coding job' }));
    await screen.findAllByText('Coding');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }));
    await waitFor(() => expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0));
    expect(screen.getAllByText('CANCELLED')).toHaveLength(4);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, options] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('/api/coding/v1.4/jobs/coding-AAAAAAAAAAAAAAAAAAAAAA');
    expect(options.method).toBe('DELETE');
  });
});
