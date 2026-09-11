import React, { useCallback, useEffect, useRef, useState } from 'react';

type CodingJobStatus = 'queued' | 'leased' | 'running' | 'repairing' | 'verified' | 'blocked' | 'failed' | 'cancelled';
type ResultDetailsState = 'pending' | 'available' | 'unavailable' | 'not_applicable';
type VerificationKind = 'typecheck' | 'lint' | 'test' | 'build';
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
    kind: VerificationKind;
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
const CHECKS: readonly VerificationKind[] = ['typecheck', 'lint', 'test', 'build'];
const JOB_ID = /^coding-[A-Za-z0-9_-]{22}$/;
const STATUS_LABELS: Record<CodingJobStatus, string> = {
  queued: 'Queued',
  leased: 'Worker claimed',
  running: 'Coding',
  repairing: 'Repairing',
  verified: 'Verified',
  blocked: 'Blocked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const STATUS_PROGRESS: Record<CodingJobStatus, number> = {
  queued: 10,
  leased: 25,
  running: 55,
  repairing: 75,
  verified: 100,
  blocked: 100,
  failed: 100,
  cancelled: 100,
};

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

function authorizationLabel(mode: CodingJobAuthorizationMode | undefined): string {
  if (mode === 'coding-operator') return 'dedicated coding credential';
  if (mode === 'legacy-agent-compat') return 'legacy agent compatibility';
  return 'unconfigured';
}

function ReadinessValue({ ready }: { ready: boolean | undefined }) {
  return <span className={ready ? 'font-bold text-emerald-600 dark:text-emerald-300' : 'font-bold text-amber-700 dark:text-amber-300'}>{ready ? 'ready' : 'missing'}</span>;
}

function StatusBadge({ status, cancelRequested }: { status: CodingJobStatus; cancelRequested: boolean }) {
  const terminal = !ACTIVE.has(status);
  const tone = status === 'verified'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
    : status === 'blocked' || status === 'failed'
      ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200'
      : status === 'cancelled' || cancelRequested
        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
        : 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200';
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>
    {!terminal && !cancelRequested && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-current" aria-hidden="true" />}
    {cancelRequested && ACTIVE.has(status) ? 'Cancellation requested' : STATUS_LABELS[status]}
  </span>;
}

function VerificationPanel({ result, state }: { result: CodingJobResult | null; state: ResultDetailsState }) {
  const byKind = new Map(result?.verificationChecks.map(check => [check.kind, check]) ?? []);
  const absentLabel = result ? 'NOT RUN' : state === 'unavailable' ? 'N/A' : state === 'not_applicable' ? 'CANCELLED' : 'WAIT';
  const absentDetail = result ? 'not executed before terminal stop' : state === 'unavailable' ? 'result unavailable' : state === 'not_applicable' ? 'job cancelled' : 'pending';
  return <section className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/50" aria-labelledby="coding-verification-title">
    <div className="mb-3 flex items-center justify-between gap-3"><h2 id="coding-verification-title" className="font-bold">Verification</h2>{result && <span className="text-xs text-slate-500">repair rounds: {result.repairRounds}</span>}</div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{CHECKS.map(kind => {
      const check = byKind.get(kind);
      return <div key={kind} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{kind}</span><span className={`text-sm font-black ${check?.ok ? 'text-emerald-600 dark:text-emerald-300' : check ? 'text-rose-600 dark:text-rose-300' : 'text-slate-400'}`}>{check ? check.ok ? 'PASS' : 'FAIL' : absentLabel}</span></div>
        <p className="mt-2 text-xs text-slate-500">{check ? `exit ${check.exitCode ?? 'null'}${check.timedOut ? ' · timeout' : ''}` : absentDetail}</p>
      </div>;
    })}</div>
  </section>;
}

function DiffPanel({ result, state, changedPaths }: { result: CodingJobResult | null; state: ResultDetailsState; changedPaths: string[] }) {
  return <section className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/50" aria-labelledby="coding-diff-title">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="coding-diff-title" className="font-bold">Diff / Changed files</h2><span className="text-xs text-slate-500">{changedPaths.length} file{changedPaths.length === 1 ? '' : 's'}</span></div>
    {state === 'unavailable' && <p role="status" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">暗号化された差分詳細を取得できませんでした。ジョブ状態と changed paths は保持されています。</p>}
    {changedPaths.length === 0 && !result?.diffs.length ? <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">変更はまだ確定していません。</div> : null}
    <div className="space-y-4">
      {result?.diffs.map((diff, index) => <article key={`${diff.path}-${index}`} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/70"><code className="break-all text-xs font-semibold">{diff.path}</code><span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">{diff.kind}</span></header>
        {!diff.previewAvailable ? <p className="p-4 text-xs text-slate-500">Preview unavailable; path-level change evidence remains available.</p> : <div className="grid md:grid-cols-2">
          <div className="min-w-0 border-b border-slate-200 md:border-b-0 md:border-r dark:border-slate-800"><div className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:border-slate-800 dark:text-rose-300">Before</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{diff.before ?? '(new file)'}</pre>{diff.beforeTruncated && <p className="px-3 pb-3 text-[10px] font-bold text-amber-700 dark:text-amber-300">Preview truncated</p>}</div>
          <div className="min-w-0"><div className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:border-slate-800 dark:text-emerald-300">After</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{diff.after ?? '(unavailable)'}</pre>{diff.afterTruncated && <p className="px-3 pb-3 text-[10px] font-bold text-amber-700 dark:text-amber-300">Preview truncated</p>}</div>
        </div>}
      </article>)}
      {!result?.diffs.length && changedPaths.map(path => <div key={path} className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-800">{path}</div>)}
    </div>
  </section>;
}

export default function CodingJobWorkspaceV14() {
  const [goal, setGoal] = useState('');
  const [existingJobId, setExistingJobId] = useState('');
  const [capability, setCapability] = useState<CapabilityResponse | null>(null);
  const [job, setJob] = useState<CodingJobRecord | null>(null);
  const [result, setResult] = useState<CodingJobResult | null>(null);
  const [resultState, setResultState] = useState<ResultDetailsState>('pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingCapability, setCheckingCapability] = useState(true);
  const credentialInputRef = useRef<HTMLInputElement | null>(null);
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
      .then(async response => { const data = await response.json() as CapabilityResponse; if (mountedRef.current) setCapability(data); })
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
    const credential = credentialInputRef.current?.value.trim() ?? '';
    if (!credential) { setError('CODING_JOB_AUTHENTICATION_REQUIRED'); credentialInputRef.current?.focus(); return; }
    const epoch = beginOperation(credential);
    try {
      const response = await fetch('/api/coding/v1.4/jobs', { method: 'POST', headers: authHeaders(credential), body: JSON.stringify({ goal: trimmedGoal, confirmRun: true }) });
      const data = await jsonBody(response);
      if (epoch !== requestEpochRef.current) return;
      if (!response.ok || !data.ok || !data.job) { credentialRef.current = ''; setError(safeCode(data.code, `CODING_UI_CREATE_${response.status}`)); return; }
      currentJobIdRef.current = data.job.jobId;
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      applyResponse(data, epoch);
    } catch { if (epoch === requestEpochRef.current) { credentialRef.current = ''; setError('CODING_UI_CREATE_UNAVAILABLE'); } }
    finally { if (epoch === requestEpochRef.current) setBusy(false); }
  }, [applyResponse, beginOperation, busy, capability?.ready, goal]);

  const openExistingJob = useCallback(async () => {
    const jobId = existingJobId.trim();
    if (busy) return;
    if (!JOB_ID.test(jobId)) { setError('CODING_UI_INVALID_JOB_ID'); return; }
    const credential = credentialInputRef.current?.value.trim() ?? '';
    if (!credential) { setError('CODING_JOB_AUTHENTICATION_REQUIRED'); credentialInputRef.current?.focus(); return; }
    const epoch = beginOperation(credential, jobId);
    try {
      const loaded = await loadJob(jobId, credential, epoch);
      if (loaded && credentialInputRef.current) credentialInputRef.current.value = '';
      if (!loaded && epoch === requestEpochRef.current) credentialRef.current = '';
    } catch { if (epoch === requestEpochRef.current) { credentialRef.current = ''; setError('CODING_UI_STATUS_UNAVAILABLE'); } }
    finally { if (epoch === requestEpochRef.current) setBusy(false); }
  }, [beginOperation, busy, existingJobId, loadJob]);

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
  const dedicatedAuthorizationReady = capability?.authorizationReady === true && capability.authorizationMode === 'coding-operator';
  const readinessItems = [
    ['Control plane', capability?.controlPlaneReady],
    ['Database config', capability?.storeConfigured === true && capability?.resultStoreConfigured === true],
    ['Live job/result schema', capability?.databaseReady === true && capability?.storeReady === true && capability?.resultStoreReady === true],
    ['Owner binding', capability?.ownerBindingReady],
    ['Encryption', capability?.dataKeyReady === true && capability?.cryptoReady === true],
    ['Dedicated coding auth', dedicatedAuthorizationReady],
    ['GitHub dispatch', capability?.dispatchReady],
    ['Worker opt-in', capability?.workerEnabled],
  ] as const;
  const progress = job ? STATUS_PROGRESS[job.status] : 0;
  const verificationReached = Boolean(result?.verificationChecks.length);
  const stageReached = [Boolean(job), Boolean(job && job.status !== 'queued' && job.status !== 'leased'), Boolean(job && (job.status === 'repairing' || (result?.repairRounds ?? 0) > 0)), Boolean(job && (job.status === 'verified' || verificationReached))];

  return <section className="min-h-[calc(100vh-5rem)] bg-slate-50 p-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:p-5" aria-label="Coding Job Workspace">
    <div className="mx-auto grid max-w-[1600px] gap-4 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.65fr)]">
      <aside className="origin-workspace rounded-2xl p-4 xl:sticky xl:top-4 xl:self-start">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">V1.4 · Agentic Coding OS</p><h1 className="mt-1 text-xl font-black">Coding Job</h1><p className="mt-2 text-xs leading-5 text-slate-500">自然言語で変更を依頼し、隔離workerで探索・編集・検証・修復を実行します。</p></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">$0 only</span></div>

        <div className="mt-4 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
          <div className="flex items-center justify-between gap-2"><span className="font-bold">Hosted worker</span><span className={ready ? 'font-bold text-emerald-600 dark:text-emerald-300' : 'font-bold text-amber-700 dark:text-amber-300'}>{checkingCapability ? 'checking…' : ready ? 'ready' : 'not ready'}</span></div>
          <div className="mt-2 flex items-center justify-between gap-2"><span className="text-slate-500">Encrypted result details</span><span>{capability?.resultDetailsReady ? 'configured' : 'unavailable'}</span></div>
          <div className="mt-1 flex items-center justify-between gap-2"><span className="text-slate-500">Authorization</span><span>{authorizationLabel(capability?.authorizationMode)}</span></div>
          <div className="mt-1 flex items-center justify-between gap-2"><span className="text-slate-500">Git publish</span><span>not authorized</span></div>
          <div className="mt-1 flex items-center justify-between gap-2"><span className="text-slate-500">Deploy</span><span>not authorized</span></div>
        </div>

        {!checkingCapability && <div className="mt-4 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800" aria-label="Coding production readiness">
          <div className="mb-2 font-bold">Production readiness</div>
          <div className="space-y-1">{readinessItems.map(([label, itemReady]) => <div key={label} className="flex items-center justify-between gap-3"><span className="text-slate-500">{label}</span><ReadinessValue ready={itemReady} /></div>)}</div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">公開statusの非秘密booleanのみを表示しています。secret値・DB URI・tokenは表示しません。</p>
        </div>}

        {capability?.authorizationMode === 'legacy-agent-compat' && <div role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">互換モードです。`ORIGIN_CODING_OPERATOR_SECRET` を設定するとCoding権限を他のAgent操作から分離できます。</div>}
        {!checkingCapability && !ready && <div role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">Coding workerは現在fail-closedです。上のreadinessが揃うまで新規ジョブは開始されません。既存ジョブの参照・取消はcontrol-plane条件が揃っていれば利用できます。</div>}

        <label htmlFor="coding-operator-key" className="mt-4 block text-xs font-bold text-slate-600 dark:text-slate-300">Coding operator credential</label>
        <input ref={credentialInputRef} id="coding-operator-key" type="password" autoComplete="off" spellCheck={false} placeholder="Coding operator key" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950" />
        <p className="mt-1 text-[10px] leading-4 text-slate-500">この値はReact state・localStorage・ログへ保存しません。開始/再接続後は入力欄を消去し、active jobの操作中のみページメモリでAPI認証に使用します。</p>

        <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <label htmlFor="coding-existing-job" className="block text-xs font-bold text-slate-600 dark:text-slate-300">Open existing job</label>
          <input id="coding-existing-job" value={existingJobId} onChange={event => setExistingJobId(event.target.value)} autoComplete="off" spellCheck={false} placeholder="coding-…" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950" />
          <button type="button" onClick={() => void openExistingJob()} disabled={busy || !JOB_ID.test(existingJobId.trim())} className="mt-2 min-h-11 w-full rounded-xl border border-indigo-300 bg-indigo-50 px-3 text-sm font-bold text-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200">{busy ? 'Processing…' : 'Open job'}</button>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">Job IDとcredentialはブラウザ保存しません。ページ再読込後は両方を再入力してください。</p>
        </div>

        <label htmlFor="coding-goal" className="mt-4 block text-xs font-bold text-slate-600 dark:text-slate-300">Coding goal</label>
        <textarea id="coding-goal" value={goal} onChange={event => setGoal(event.target.value)} maxLength={4000} placeholder="例: ログイン画面のフォーム検証を修正し、関連テストを追加してすべての検証を通してください。" className="mt-2 min-h-40 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950" />
        <div className="mt-1 text-right text-[10px] text-slate-500">{goal.length}/4000</div>
        <button type="button" onClick={() => void startJob()} disabled={!ready || !goal.trim() || busy || Boolean(job && ACTIVE.has(job.status))} className="origin-primary-button mt-3 min-h-11 w-full rounded-xl px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Processing…' : job && ACTIVE.has(job.status) ? 'Job running' : 'Start coding job'}</button>

        {job && <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge status={job.status} cancelRequested={job.cancelRequested} /><span className="text-[10px] text-slate-500">attempt {job.attempt}</span></div>
          <div><div className="mb-1 flex items-center justify-between text-[10px] text-slate-500"><span>Lifecycle position</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={STATUS_LABELS[job.status]} aria-label="Coding job lifecycle position"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} /></div></div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]"><dt className="text-slate-500">Job</dt><dd className="truncate font-mono" title={job.jobId}>{job.jobId}</dd><dt className="text-slate-500">Updated</dt><dd>{formatTime(job.updatedAt)}</dd><dt className="text-slate-500">Result</dt><dd className="break-all font-mono">{job.resultCode ?? 'pending'}</dd></dl>
          <button type="button" onClick={() => void cancelJob()} disabled={!ACTIVE.has(job.status) || job.cancelRequested || busy} className="min-h-11 w-full rounded-xl border border-rose-300 bg-rose-50 px-3 text-sm font-bold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{job.cancelRequested && ACTIVE.has(job.status) ? 'Cancellation requested…' : 'Cancel job'}</button>
        </div>}
        {error && <div role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 font-mono text-xs text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
      </aside>

      <main className="min-w-0 space-y-4">
        <section className="origin-workspace rounded-2xl p-4" aria-labelledby="coding-progress-title">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Execution</p><h2 id="coding-progress-title" className="mt-1 text-lg font-black">Progress & evidence</h2></div>{job ? <StatusBadge status={job.status} cancelRequested={job.cancelRequested} /> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500 dark:bg-slate-800">No active job</span>}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">{(['Queue', 'Discover / Edit', 'Repair', 'Verify'] as const).map((label, index) => <div key={label} className={`rounded-xl border p-3 ${stageReached[index] ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/20' : 'border-slate-200 dark:border-slate-800'}`}><div className="text-[10px] font-black uppercase tracking-wider text-slate-500">{index + 1}</div><div className="mt-1 text-sm font-bold">{label}</div></div>)}</div>
          <p className="mt-3 text-[10px] leading-4 text-slate-500">Lifecycle positionは永続ジョブ状態の位置を示し、成功率や残り時間の予測ではありません。Verify段階は実際の検証証拠が存在する場合だけ到達表示します。</p>
        </section>
        <VerificationPanel result={result} state={resultState} />
        <DiffPanel result={result} state={resultState} changedPaths={job?.changedPaths ?? []} />
        <section className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-900/50"><strong className="text-slate-700 dark:text-slate-200">Safety boundary:</strong> UIからrepository/ref/pathは指定できません。targetはserver-ownedの <code>origin:self</code> に固定され、Git公開・デプロイはこのV1.4経路では実行されません。</section>
      </main>
    </div>
  </section>;
}
