import React, { useCallback, useEffect, useRef, useState } from 'react';
import OriginAgentActionProgressV31 from './personal/OriginAgentActionProgressV31';
import OriginCodingWorkspaceV31 from './personal/OriginCodingWorkspaceV31';
import { getSessionCredential, useSessionCredential } from '../security/sessionCredentials';

export type CodingJobStatus = 'queued' | 'leased' | 'running' | 'repairing' | 'verified' | 'blocked' | 'failed' | 'cancelled';
type ResultDetailsState = 'pending' | 'available' | 'unavailable' | 'not_applicable';
type CodingJobAuthorizationMode = 'coding-operator' | 'legacy-agent-compat' | 'unconfigured';

type CodingJobRecord = {
  jobId: string;
  targetKey: string;
  status: CodingJobStatus;
  attempt: number;
  version: number;
  cancelRequested: boolean;
  resultCode: string | null;
  changedPaths: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type CodingJobResult = {
  schemaVersion: 1;
  sessionStatus: 'verified' | 'blocked' | 'repair_limit';
  repairRounds: number;
  diffs: Array<{
    path: string;
    kind: 'modified' | 'created';
    before: string | null;
    after: string | null;
    beforeTruncated: boolean;
    afterTruncated: boolean;
    previewAvailable: boolean;
  }>;
  verificationChecks: Array<{
    kind: 'typecheck' | 'lint' | 'test' | 'build';
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    attempt: number;
  }>;
  freeOnly: true;
  costUsd: 0;
  gitPublished: false;
  deployed: false;
};

type JobResponse = {
  ok?: boolean;
  code?: string;
  job?: CodingJobRecord;
  result?: CodingJobResult | null;
  resultDetailsState?: ResultDetailsState;
};

type CapabilityResponse = {
  ok?: boolean;
  ready?: boolean;
  controlPlaneReady?: boolean;
  databaseReady?: boolean;
  storeConfigured?: boolean;
  resultStoreConfigured?: boolean;
  storeReady?: boolean;
  resultStoreReady?: boolean;
  authorizationReady?: boolean;
  ownerBindingReady?: boolean;
  dataKeyReady?: boolean;
  cryptoReady?: boolean;
  dispatchReady?: boolean;
  workerEnabled?: boolean;
  resultDetailsReady?: boolean;
  authorizationMode?: CodingJobAuthorizationMode;
  authorizationScope?: string;
  freeOnly?: boolean;
  costUsd?: number;
  gitPublished?: boolean;
  deployed?: boolean;
};

const ACTIVE = new Set<CodingJobStatus>(['queued', 'leased', 'running', 'repairing']);
const STATUS_LABELS: Record<CodingJobStatus, string> = {
  queued: '受け付けました',
  leased: '準備中',
  running: 'コードを作成・変更中',
  repairing: '直しています',
  verified: '終わりました（確認済み）',
  blocked: '止まりました',
  failed: '失敗しました',
  cancelled: '取り消しました',
};
const STATUS_DETAILS: Record<CodingJobStatus, string> = {
  queued: '受け付けました。始まるまでお待ちください。',
  leased: '始める準備をしています。',
  running: 'コードを確認しながら、作成・変更しています。終わるまでお待ちください。',
  repairing: '確認で見つかった問題を直しています。',
  verified: '終わりました。変更したファイルと確認結果は下で見られます。',
  blocked: '必要な条件がそろわず、止まりました。できた確認だけを表示します。',
  failed: '途中で失敗しました。終わっていない作業を完了とは表示しません。',
  cancelled: '取り消しました。取り消す前にどこまで進んだかは、ここだけでは分かりません。',
};

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  CODING_JOB_AUTHENTICATION_REQUIRED: '実行キーが入力されていません。設定の「コード実行」から入力してください。',
  CODING_JOB_DISPATCH_TOKEN_INVALID: '作業を始めるための設定を確認できなかったため、開始できませんでした。時間をおいて、もう一度お試しください。',
  CODING_JOB_DISPATCH_PERMISSION_DENIED: '作業を始められませんでした。時間をおいて、もう一度お試しください。',
  CODING_JOB_DISPATCH_WORKFLOW_INACCESSIBLE: '作業を始められませんでした。時間をおいて、もう一度お試しください。',
  CODING_JOB_DISPATCH_REF_INVALID: '作業を始められませんでした。時間をおいて、もう一度お試しください。',
  CODING_JOB_DISPATCH_RATE_LIMITED: '利用が集中しているため、今は始められません。時間をおいてお試しください。',
  CODING_JOB_DISPATCH_UNAVAILABLE: '開始できたか確認できませんでした。二重に始めないため、自動ではもう一度送っていません。',
  CODING_JOB_DISPATCH_REJECTED: '作業を始められませんでした。時間をおいて、もう一度お試しください。',
  CODING_UI_CREATE_UNAVAILABLE: '通信が途切れたため、受け付けられたか確認できませんでした。二重送信を避けるため、自動ではもう一度送っていません。',
  CODING_UI_STATUS_UNAVAILABLE: '最新の状態を取得できませんでした。表示しているのは、最後に取得できた内容です。',
  CODING_UI_CANCEL_UNAVAILABLE: '取り消せたか確認できませんでした。止まっていない場合があります。',
};

function ErrorNotice({ code }: { code: string }) {
  return <div role="alert" className="mt-4 rounded-xl border border-origin-danger/50 bg-origin-danger/10 p-3 text-[13px] leading-5 text-origin-danger">
    <p className="font-semibold">{ERROR_MESSAGES[code] ?? '処理を完了できませんでした。サポート用コードを表示しています。'}</p>
    <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 font-semibold">サポート用コード</summary><p className="mb-1">問い合わせるときは、このコードもお伝えください。</p><code className="block break-all">{code}</code></details>
  </div>;
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^CODING_[A-Z0-9_]{1,120}$/.test(value) ? value : fallback;
}

async function jsonBody(response: Response): Promise<JobResponse> {
  try { return await response.json() as JobResponse; }
  catch { return { ok: false, code: 'CODING_UI_INVALID_RESPONSE' }; }
}

function authHeaders(credential: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` };
}

function formatTime(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
}

function StatusBadge({ status, cancelRequested }: { status: CodingJobStatus; cancelRequested: boolean }) {
  const terminal = !ACTIVE.has(status);
  const tone = status === 'verified'
    ? 'border-origin-success bg-origin-success/10 text-origin-success'
    : status === 'blocked' || status === 'failed'
      ? 'border-origin-danger/50 bg-origin-danger/10 text-origin-danger'
      : status === 'cancelled' || cancelRequested
        ? 'border-origin-warning/50 bg-origin-warning/10 text-origin-warning'
        : 'border-origin-brand-border bg-origin-brand-soft text-origin-brand';
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[13px] font-bold ${tone}`}>
    {!terminal && !cancelRequested && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-current" aria-hidden="true" />}
    {cancelRequested && ACTIVE.has(status) ? '取り消しています' : STATUS_LABELS[status]}
  </span>;
}

type CodingJobWorkspaceV14Props = { initialGoal?: string; onOpenSettings?: (section?: 'coding') => void };

export default function CodingJobWorkspaceV14({ initialGoal, onOpenSettings }: CodingJobWorkspaceV14Props) {
  const [goal, setGoal] = useState(() => initialGoal?.trim().slice(0, 4000) ?? '');
  const [capability, setCapability] = useState<CapabilityResponse | null>(null);
  const [job, setJob] = useState<CodingJobRecord | null>(null);
  const [result, setResult] = useState<CodingJobResult | null>(null);
  const [resultState, setResultState] = useState<ResultDetailsState>('pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingCapability, setCheckingCapability] = useState(true);
  const credentialRef = useRef('');
  const mountedRef = useRef(true);
  const requestEpochRef = useRef(0);
  const latestVersionRef = useRef(0);
  const currentJobIdRef = useRef('');
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void fetch('/api/coding/v1.4/status', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('CODING_UI_STATUS_UNAVAILABLE');
        const data = await response.json() as CapabilityResponse;
        if (!data || data.ok !== true) throw new Error('CODING_UI_INVALID_RESPONSE');
        if (mountedRef.current) setCapability(data);
      })
      .catch(() => { if (mountedRef.current) setCapability({ ok: false, ready: false, resultDetailsReady: false, authorizationMode: 'unconfigured' }); })
      .finally(() => { if (mountedRef.current) setCheckingCapability(false); });
    return () => {
      mountedRef.current = false;
      credentialRef.current = '';
      requestEpochRef.current += 1;
      currentJobIdRef.current = '';
      latestVersionRef.current = 0;
      controller.abort();
    };
  }, []);

  const capabilityDetailInFlightRef = useRef(false);
  const refreshCapabilityDetail = useCallback((credential: string) => {
    // The status endpoint discloses its configuration breakdown only to an
    // operator-authenticated request; the mount-time fetch is anonymous and
    // yields readiness alone. When the operator opens the detailed
    // information area with a credential at hand, refresh the capability
    // with it so the diagnostics panel and authorization notices can
    // render from the full detail. Operation flows never trigger this.
    if (!credential || capabilityDetailInFlightRef.current) return;
    capabilityDetailInFlightRef.current = true;
    void fetch('/api/coding/v1.4/status', { headers: authHeaders(credential) })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json() as CapabilityResponse;
        if (!data || data.ok !== true) return;
        if (mountedRef.current) setCapability(data);
      })
      .catch(() => undefined)
      .finally(() => { capabilityDetailInFlightRef.current = false; });
  }, []);

  const handleCapabilityDetailToggle = (open: boolean) => {
    if (!open || capability?.authorizationMode !== undefined) return;
    const credential = credentialRef.current || getSessionCredential('coding').trim();
    if (credential) refreshCapabilityDetail(credential);
  };

  const applyResponse = useCallback((data: JobResponse, epoch: number) => {
    if (epoch !== requestEpochRef.current) return;
    if (data.job) {
      const sameJob = currentJobIdRef.current === data.job.jobId;
      if (sameJob && data.job.version < latestVersionRef.current) return;
      currentJobIdRef.current = data.job.jobId;
      latestVersionRef.current = data.job.version;
      setJob(data.job);
      if (!ACTIVE.has(data.job.status)) credentialRef.current = '';
    }
    setResult(data.result ?? null);
    setResultState(data.resultDetailsState ?? 'pending');
  }, []);

  const loadJob = useCallback(async (jobId: string, credential: string, epoch: number) => {
    const response = await fetch(`/api/coding/v1.4/jobs/${encodeURIComponent(jobId)}`, { headers: authHeaders(credential) });
    const data = await jsonBody(response);
    if (epoch !== requestEpochRef.current || currentJobIdRef.current !== jobId) return false;
    if (!response.ok || !data.ok || !data.job) {
      setError(safeCode(data.code, `CODING_UI_STATUS_${response.status}`));
      return false;
    }
    setError(null);
    applyResponse(data, epoch);
    return true;
  }, [applyResponse]);

  const refreshJob = useCallback(async (jobId: string) => {
    const credential = credentialRef.current;
    if (!credential || refreshInFlightRef.current || currentJobIdRef.current !== jobId) return;
    const epoch = requestEpochRef.current;
    refreshInFlightRef.current = true;
    try { await loadJob(jobId, credential, epoch); }
    catch { if (epoch === requestEpochRef.current) setError('CODING_UI_STATUS_UNAVAILABLE'); }
    finally { refreshInFlightRef.current = false; }
  }, [loadJob]);

  useEffect(() => {
    if (!job || !ACTIVE.has(job.status)) return;
    const timer = window.setInterval(() => { void refreshJob(job.jobId); }, 2500);
    return () => window.clearInterval(timer);
  }, [job?.jobId, job?.status, refreshJob]);

  const beginOperation = useCallback((credential: string, jobId = '') => {
    const epoch = requestEpochRef.current + 1;
    requestEpochRef.current = epoch;
    currentJobIdRef.current = jobId;
    latestVersionRef.current = 0;
    credentialRef.current = credential;
    setBusy(true);
    setError(null);
    setJob(null);
    setResult(null);
    setResultState('pending');
    return epoch;
  }, []);

  const startJob = useCallback(async () => {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || busy || capability?.ready !== true) return;
    const credential = getSessionCredential('coding').trim();
    if (!credential) { setError('CODING_JOB_AUTHENTICATION_REQUIRED'); return; }
    const epoch = beginOperation(credential);
    try {
      const response = await fetch('/api/coding/v1.4/jobs', { method: 'POST', headers: authHeaders(credential), body: JSON.stringify({ goal: trimmedGoal, confirmRun: true }) });
      const data = await jsonBody(response);
      if (epoch !== requestEpochRef.current) return;
      if (!response.ok || !data.ok || !data.job) { credentialRef.current = ''; setError(safeCode(data.code, `CODING_UI_CREATE_${response.status}`)); return; }
      currentJobIdRef.current = data.job.jobId;
      applyResponse(data, epoch);
    } catch { if (epoch === requestEpochRef.current) { credentialRef.current = ''; setError('CODING_UI_CREATE_UNAVAILABLE'); } }
    finally { if (epoch === requestEpochRef.current) setBusy(false); }
  }, [applyResponse, beginOperation, busy, capability?.ready, goal]);

  const cancelJob = useCallback(async () => {
    if (!job || !ACTIVE.has(job.status) || job.cancelRequested || busy || !credentialRef.current || currentJobIdRef.current !== job.jobId) return;
    const epoch = requestEpochRef.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/coding/v1.4/jobs/${encodeURIComponent(job.jobId)}`, { method: 'DELETE', headers: authHeaders(credentialRef.current) });
      const data = await jsonBody(response);
      if (epoch !== requestEpochRef.current || currentJobIdRef.current !== job.jobId) return;
      if (!response.ok || !data.ok || !data.job) { setError(safeCode(data.code, `CODING_UI_CANCEL_${response.status}`)); return; }
      applyResponse(data, epoch);
    } catch { if (epoch === requestEpochRef.current) setError('CODING_UI_CANCEL_UNAVAILABLE'); }
    finally { if (epoch === requestEpochRef.current) setBusy(false); }
  }, [applyResponse, busy, job]);

  const ready = capability?.ready === true;
  const sessionCredential = useSessionCredential('coding');
  const hasCredential = sessionCredential.trim() !== '';
  const jobActive = Boolean(job && ACTIVE.has(job.status));
  // キー未入力のときは開始ボタンを無効化せず、押すと設定の「コード実行」
  // へ案内する（外部評価改修 PR-D、設計メモ項目3-a）。
  const promptForCredential = ready && !hasCredential && !busy && !jobActive && goal.trim() !== '';

  return <section className="flex min-h-full flex-col justify-center bg-origin-paper p-3 text-origin-ink md:p-5" aria-label="コード">
    <div className="mx-auto w-full max-w-[var(--content-wide)] space-y-4">
      <header className="flex items-start justify-between gap-3 px-1">
        <div>
          <h1 className="text-xl font-black">コードを作る・直す</h1>
          <p className="mt-1 text-sm leading-6 text-origin-muted">作りたいものや直したいことを書いてください。内容を確認し、作成・修正と動作確認まで進めます。プログラム自体を作る・直す作業に向いています。</p>
        </div>
        
      </header>

      <section className="origin-workspace rounded-2xl p-4">
        <label htmlFor="coding-goal" className="block text-sm font-bold">作りたいもの・直したいこと</label>
        <textarea
          id="coding-goal"
          value={goal}
          onChange={event => setGoal(event.target.value)}
          maxLength={4000}
          placeholder="例：家計簿アプリを作ってください。金額を入力すると、月ごとの合計を表示したいです。"
          className="mt-2 min-h-32 w-full resize-y rounded-xl border border-origin-border bg-origin-surface p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-origin-brand"
        />
        <p className="mt-1 text-[13px] leading-5 text-origin-muted">新しいものを作る場合も、今あるコードを直す場合も、ここに書いてください。</p>
        <div className="mt-1 text-right text-[13px] text-origin-muted">{goal.length}/4000</div>

        <button
          type="button"
          onClick={() => { if (promptForCredential) { onOpenSettings?.('coding'); return; } void startJob(); }}
          disabled={!ready || !goal.trim() || busy || Boolean(job && ACTIVE.has(job.status))}
          aria-describedby="coding-run-status"
          title={!ready ? '今は利用できないため、始められません' : !goal.trim() ? '作りたいもの・直したいことを入力してください' : job && ACTIVE.has(job.status) ? '今の作業が終わるまで、新しい依頼は始められません' : undefined}
          className="origin-primary-button mt-3 min-h-11 w-full rounded-xl px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '始めています…' : job && ACTIVE.has(job.status) ? '実行中' : promptForCredential ? '実行キーを入力する' : '作成・修正を始める'}
        </button>

        <div id="coding-run-status" role="status" className="mt-3 text-[13px]">
          <span className={ready && hasCredential ? 'font-bold text-origin-success' : 'text-origin-muted'}>{checkingCapability ? '利用できるか確認しています…' : !ready ? '今は利用できません' : hasCredential ? '利用できます' : '実行キーを入力すると始められます'}</span>
        </div>

        {ready && !hasCredential && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] leading-5">
            <span className="text-origin-muted">実行キーは、設定の「コード実行」で入力します。</span>
            <span className="text-origin-muted">コードの相談や短いコードは、チャットでもそのまま頼めます。</span>
            <button type="button" onClick={() => onOpenSettings?.('coding')} className="origin-secondary-button inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold">設定を開く</button>
          </div>
        )}

        <details className="mt-2 border-t border-origin-border pt-2 text-[13px]" onToggle={event => handleCapabilityDetailToggle(event.currentTarget.open)}>
          <summary className="min-h-11 cursor-pointer py-3 font-semibold">実行の詳しい情報</summary>
          <p className="leading-5 text-origin-muted">認証情報は端末に保存せず、実行中に必要な範囲だけで使います。</p>

          <div className="mt-3 rounded-xl border border-origin-border p-3">
            <div className="flex items-center justify-between gap-2"><span className="font-bold">実行環境</span><span className={ready ? 'font-bold text-origin-success' : 'font-bold text-origin-warning'}>{checkingCapability ? '確認中…' : ready ? '準備できています' : '準備を確認できません'}</span></div>
          </div>
        </details>

        {!checkingCapability && !ready && <div role="status" className="mt-3 rounded-xl border border-origin-warning/50 bg-origin-warning/10 p-3 text-[13px] font-semibold leading-5 text-origin-warning">今はコードの作成・変更を始められません。準備が整うまでお待ちください。</div>}
        {error && <ErrorNotice code={error} />}
      </section>

      {/* 空状態（デザイン評価 第3回 2026-11-17）：依頼がまだ無いときは、
          進み方を先に示して「何が起きるか」が分かるようにする。依頼が
          始まると、この枠は進み具合（OriginAgentActionProgressV31）に
          置き換わる。 */}
      {!job && <section className="rounded-2xl border border-origin-border bg-origin-surface/70 p-4" aria-label="進み方">
        <h2 className="text-sm font-black">進み方</h2>
        <ol className="mt-2 grid gap-2 sm:grid-cols-5">
          {[
            ['計画', '何を作る・直すか確認'],
            ['作成・変更', 'コードを作成・変更'],
            ['確認', '確認と、必要な修正'],
            ['最終確認', '結果をまとめる'],
            ['結果表示', '結果と変更内容を表示'],
          ].map(([label, detail]) => <li key={label} className="rounded-xl border border-origin-border p-3">
            <span className="text-[13px] font-black tracking-wide">{label}</span>
            <p className="mt-1 text-[13px] leading-5 text-origin-muted">{detail}</p>
          </li>)}
        </ol>
        <p className="mt-3 text-[13px] leading-5 text-origin-muted">上に書いて「作成・修正を始める」を押すと、進み具合と結果はここに表示されます。</p>
      </section>}

      {job && <section className="rounded-2xl border border-origin-border bg-origin-surface/70 p-4" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusBadge status={job.status} cancelRequested={job.cancelRequested} />
          {ACTIVE.has(job.status) && <button type="button" onClick={() => void cancelJob()} disabled={job.cancelRequested || busy} className="min-h-11 rounded-xl border border-origin-danger/50 bg-origin-danger/10 px-4 text-sm font-bold text-origin-danger disabled:cursor-not-allowed disabled:opacity-50">{job.cancelRequested ? '取り消しを確認中…' : '依頼を取り消す'}</button>}
        </div>
        <p className="mt-2 text-sm leading-6 text-origin-muted">{job.cancelRequested && ACTIVE.has(job.status) ? '取り消しています。止まったか確認しています。' : STATUS_DETAILS[job.status]}</p>
        <details className="mt-2 border-t border-origin-border pt-2 text-[13px]">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold">依頼の情報</summary>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2"><dt className="text-origin-muted">依頼番号</dt><dd className="truncate font-mono" title={job.jobId}>{job.jobId}</dd><dt className="text-origin-muted">更新時刻</dt><dd>{formatTime(job.updatedAt)}</dd></dl>
        </details>
      </section>}

      <OriginAgentActionProgressV31 status={job?.status ?? null} />

      <OriginCodingWorkspaceV31 result={result} state={resultState} changedPaths={job?.changedPaths ?? []} />
    </div>
  </section>;
}
