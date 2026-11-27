// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CodingJobWorkspaceV14 from './CodingJobWorkspaceV14';
import { getSessionCredential, setSessionCredential } from '../security/sessionCredentials';

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
    setSessionCredential('coding', '');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('submits a natural-language job with the settings-entered session key, and renders encrypted result evidence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: job('verified'), result, resultDetailsState: 'available' }, 202));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('準備できています');
    // 状態表示は1文だけ（PR-D）：キー未入力では「入力すると始められます」
    // のみで、「利用できます」は併記しない。キー入力欄はこの画面に無い。
    expect(screen.getByText('実行キーを入力すると始められます')).toBeTruthy();
    expect(screen.queryByText('利用できます')).toBeNull();
    expect(screen.queryByText('キーを入力すると始められます')).toBeNull();
    expect(screen.queryByLabelText('実行キーを入力')).toBeNull();

    const credential = 'operator-secret-that-is-long-enough-for-production';
    act(() => { setSessionCredential('coding', credential); });
    expect(screen.getByText('利用できます')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('作りたいもの・直したいこと'), { target: { value: 'Fix the parser and add regression coverage.' } });
    fireEvent.click(screen.getByRole('button', { name: '作成・修正を始める' }));

    await screen.findByText('src/existing.ts');
    // キーは設定で入れたセッション保持のまま（この画面は保持も消去もしない）。
    expect(getSessionCredential('coding')).toBe(credential);
    expect(await screen.findByText('export const value = 1;')).toBeTruthy();
    expect(await screen.findByText('export const value = 2;')).toBeTruthy();
    expect(screen.getAllByText('問題なし')).toHaveLength(4);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/coding/v1.4/jobs');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${credential}`);
    expect(JSON.parse(String(options.body))).toEqual({ goal: 'Fix the parser and add regression coverage.', confirmRun: true });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('names the button as it actually reads in the how-it-works line (R6-4)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(capability));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('準備できています');
    const guide = screen.getByRole('region', { name: '進み方' });
    // キー未入力の主ボタンは「実行キーを入力する」。
    expect(guide.textContent).toContain('「実行キーを入力する」を押すと');
    expect(guide.textContent).not.toContain('「作成・修正を始める」を押すと');
    act(() => { setSessionCredential('coding', 'operator-secret-that-is-long-enough-for-production'); });
    await waitFor(() => expect(guide.textContent).toContain('「作成・修正を始める」を押すと'));
    expect(guide.textContent).not.toContain('「実行キーを入力する」を押すと');
  });

  it('keeps submission fail-closed without an internal readiness breakdown when prerequisites are missing', async () => {
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
    expect(await screen.findByText('準備を確認できません')).toBeTruthy();
    expect(screen.queryByLabelText('Coding production readiness')).toBeNull();
    expect(screen.queryByText('Database config')).toBeNull();
    expect(screen.queryByText('Encrypted result details')).toBeNull();
    expect(screen.queryByText(/postgres:\/\//i)).toBeNull();
    expect(screen.queryByText(/Bearer\s+[A-Za-z0-9_-]+/i)).toBeNull();

    fireEvent.change(screen.getByLabelText('作りたいもの・直したいこと'), { target: { value: 'Do not submit while readiness is false.' } });
    expect((screen.getByRole('button', { name: '作成・修正を始める' }) as HTMLButtonElement).disabled).toBe(true);
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
    await screen.findByText('準備できています');
    act(() => { setSessionCredential('coding', 'operator-secret-that-is-long-enough-for-production'); });
    fireEvent.change(screen.getByLabelText('作りたいもの・直したいこと'), { target: { value: 'Attempt a bounded change.' } });
    fireEvent.click(screen.getByRole('button', { name: '作成・修正を始める' }));

    await screen.findByText('必要な条件がそろわず、止まりました。できた確認だけを表示します。');
    expect(screen.getAllByText('未実施')).toHaveLength(4);
    expect(screen.queryByText('WAIT')).toBeNull();
  });

  it('does not enable submission from an unsuccessful status response containing ready true', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(capability, 503));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('準備を確認できません');
    fireEvent.change(screen.getByLabelText('作りたいもの・直したいこと'), { target: { value: 'Fix the parser.' } });
    expect((screen.getByRole('button', { name: '作成・修正を始める' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains dispatch permission errors without automatic resubmission or raw provider details', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: false, code: 'CODING_JOB_DISPATCH_PERMISSION_DENIED', message: 'private-provider-response' }, 503));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('準備できています');
    expect(screen.queryByText('Hosted worker')).toBeNull();
    act(() => { setSessionCredential('coding', 'operator-secret-that-is-long-enough-for-production'); });
    fireEvent.change(screen.getByLabelText('作りたいもの・直したいこと'), { target: { value: 'Fix the parser.' } });
    fireEvent.click(screen.getByRole('button', { name: '作成・修正を始める' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('作業を始められませんでした。時間をおいて、もう一度お試しください。');
    expect(alert.textContent).toContain('CODING_JOB_DISPATCH_PERMISSION_DENIED');
    expect(alert.textContent).not.toContain('private-provider-response');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('does not turn cancellation before worker claim into measured progress or completed stages', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: { ...job('cancelled'), attempt: 0 }, result: null, resultDetailsState: 'not_applicable' }, 202)));
    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('準備できています');
    act(() => { setSessionCredential('coding', 'operator-secret-that-is-long-enough-for-production'); });
    fireEvent.change(screen.getByLabelText('作りたいもの・直したいこと'), { target: { value: 'Attempt a bounded change.' } });
    fireEvent.click(screen.getByRole('button', { name: '作成・修正を始める' }));
    await screen.findByText(/取り消しました。取り消す前にどこまで進んだかは/);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText('PASS')).toBeNull();
    expect(screen.queryByText('Discover / Edit')).toBeNull();
    expect(screen.getAllByText(/ここだけでは分かりません/).length).toBeGreaterThan(0);
  });

  it('requests cancellation through the owner-authenticated DELETE route', async () => {
    const cancelled = { ...job('cancelled'), cancelRequested: true, version: 3 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: job('running'), result: null, resultDetailsState: 'pending' }, 202))
      .mockResolvedValueOnce(response({ ok: true, job: cancelled, result: null, resultDetailsState: 'not_applicable' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CodingJobWorkspaceV14 />);
    await screen.findByText('準備できています');
    act(() => { setSessionCredential('coding', 'operator-secret-that-is-long-enough-for-production'); });
    fireEvent.change(screen.getByLabelText('作りたいもの・直したいこと'), { target: { value: 'Fix the parser.' } });
    fireEvent.click(screen.getByRole('button', { name: '作成・修正を始める' }));
    await screen.findAllByText('コードを作成・変更中');

    fireEvent.click(screen.getByRole('button', { name: '依頼を取り消す' }));
    await waitFor(() => expect(screen.getAllByText('取り消しました').length).toBeGreaterThan(0));
    expect(screen.getAllByText('取り消し済み')).toHaveLength(4);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, options] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('/api/coding/v1.4/jobs/coding-AAAAAAAAAAAAAAAAAAAAAA');
    expect(options.method).toBe('DELETE');
  });

  it('offers the settings screen instead of disabling the start button when no execution key is set', async () => {
    const onOpenSettings = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(capability));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 onOpenSettings={onOpenSettings} />);
    await screen.findByText('準備できています');
    expect(screen.getByText('実行キーを入力すると始められます')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('作りたいもの・直したいこと'), { target: { value: 'Fix the parser.' } });
    const button = screen.getByRole('button', { name: '実行キーを入力する' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith('coding');
    // 設定へ案内するだけで、ジョブは作らない。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes the main button the key-entry action before any goal is typed when no key is set (batch 6, 案2)', async () => {
    const onOpenSettings = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(capability));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 onOpenSettings={onOpenSettings} />);
    await screen.findByText('準備できています');
    // 依頼文が空でも、主ボタン自体が「次の一手」を示し、押せる。
    // 理由も title 属性の中ではなく、ボタン直下の文で出る。
    const button = screen.getByRole('button', { name: '実行キーを入力する' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.getByText('始めるには、先に実行キーを入力してください。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '作成・修正を始める' })).toBeNull();
    fireEvent.click(button);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith('coding');
    // 設定へ案内するだけで、ジョブは作らない。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the status check fails and recovers on the second attempt (batch 6, 案1)', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(response(capability));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 />);
    expect(await screen.findByText('今は利用できません')).toBeTruthy();
    expect(screen.getByText('今はコードの作成・変更を始められません。準備が整うまでお待ちください。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'もう一度確認する' }));

    expect(await screen.findByText('準備できています')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'もう一度確認する' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops waiting at the status check timeout and offers a retry (batch 6, 案1)', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockImplementationOnce((_url: unknown, options?: RequestInit) => new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }))
        .mockResolvedValueOnce(response(capability));
      vi.stubGlobal('fetch', fetchMock);
      render(<CodingJobWorkspaceV14 />);
      // 上限までは確認中のまま。
      expect(screen.getByText('利用できるか確認しています…')).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(10_000); });
      // 時間切れで「今は利用できません」に倒れ、再試行が出る。
      expect(screen.getByText('今は利用できません')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'もう一度確認する' }));
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('準備できています')).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows where the execution key is entered, with a settings shortcut, before any goal is typed', async () => {
    const onOpenSettings = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(capability));
    vi.stubGlobal('fetch', fetchMock);
    render(<CodingJobWorkspaceV14 onOpenSettings={onOpenSettings} />);
    await screen.findByText('準備できています');
    // 依頼文を書く前（初期状態）でも、キーの入力先と設定を開く導線が見え、
    // 行き止まりにならない。
    expect(screen.getByText('実行キーは、設定の「コード実行」で入力します。')).toBeTruthy();
    expect(screen.getByText('コードの相談や短いコードは、チャットでもそのまま頼めます。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '設定を開く' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith('coding');
    // 案内するだけで、ジョブは作らない。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes the edited goal back to the shell on unmount so it survives leaving and returning (UIUX state retention, 2026-11-27)', async () => {
    const onGoalChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(response(capability));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<CodingJobWorkspaceV14 initialGoal="チャットから引き継いだ依頼文" onGoalChange={onGoalChange} />);
    await screen.findByText('準備できています');
    const textarea = screen.getByLabelText('作りたいもの・直したいこと') as HTMLTextAreaElement;
    expect(textarea.value).toBe('チャットから引き継いだ依頼文');

    fireEvent.change(textarea, { target: { value: 'コード画面で編集した依頼文' } });
    // 編集中は書き戻さない（書き戻しは離脱時に1回だけ）。
    expect(onGoalChange).not.toHaveBeenCalled();

    unmount();
    expect(onGoalChange).toHaveBeenCalledTimes(1);
    expect(onGoalChange).toHaveBeenCalledWith('コード画面で編集した依頼文');
    // 保持はシェルのメモリ内 state が担い、端末ストレージには書かない。
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('clears the goal once a job is accepted, so the consumed draft is not restored later', async () => {
    const onGoalChange = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: true, job: job('verified'), result, resultDetailsState: 'available' }, 202));
    vi.stubGlobal('fetch', fetchMock);
    act(() => { setSessionCredential('coding', 'operator-secret-that-is-long-enough-for-production'); });

    const { unmount } = render(<CodingJobWorkspaceV14 initialGoal="送信する依頼文" onGoalChange={onGoalChange} />);
    await screen.findByText('準備できています');
    const textarea = screen.getByLabelText('作りたいもの・直したいこと') as HTMLTextAreaElement;
    expect(textarea.value).toBe('送信する依頼文');

    fireEvent.click(screen.getByRole('button', { name: '作成・修正を始める' }));
    await screen.findByText('src/existing.ts');
    // 受理された時点で下書きは消費済み：入力欄は空になる。
    expect(textarea.value).toBe('');

    unmount();
    expect(onGoalChange).toHaveBeenCalledTimes(1);
    expect(onGoalChange).toHaveBeenCalledWith('');
  });

  it('keeps the goal when job creation fails, so it can be fixed and resent', async () => {
    const onGoalChange = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(capability))
      .mockResolvedValueOnce(response({ ok: false, code: 'CODING_JOB_DISPATCH_UNAVAILABLE' }, 503));
    vi.stubGlobal('fetch', fetchMock);
    act(() => { setSessionCredential('coding', 'operator-secret-that-is-long-enough-for-production'); });

    const { unmount } = render(<CodingJobWorkspaceV14 initialGoal="失敗しても残る依頼文" onGoalChange={onGoalChange} />);
    await screen.findByText('準備できています');
    fireEvent.click(screen.getByRole('button', { name: '作成・修正を始める' }));
    await screen.findByRole('alert');

    const textarea = screen.getByLabelText('作りたいもの・直したいこと') as HTMLTextAreaElement;
    expect(textarea.value).toBe('失敗しても残る依頼文');

    unmount();
    expect(onGoalChange).toHaveBeenCalledTimes(1);
    expect(onGoalChange).toHaveBeenCalledWith('失敗しても残る依頼文');
  });
});
