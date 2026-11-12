import React, { useEffect, useRef, useState } from 'react';
import { driveAgentRun } from '../agent/agentRunClient';

/**
 * Task board (multitask Phase 1, PR 1-F; design §5.2 and §8.8).
 *
 * Placement: the design forbids a new top-level screen, so the board is a
 * section inside the existing agent workspace, below the composer/output
 * grid. It reads the durable run records through the owner-scoped API
 * from PR 1-B (`GET /api/agent/v3/runs`) and groups them into the four
 * sections the design allows: awaiting approval / active / held / done.
 *
 * Auth follows the API's existing owner bindings (PR 1-B, design §11
 * U5): an operator credential lists the operator's runs; otherwise the
 * plan capability currently open in the workspace lists the runs bound
 * to it. Nothing is persisted — the credential and plan tokens live in
 * memory only, exactly like the workspace's own approval flow.
 *
 * Loading policy (revised 2026-11-09, owner direction: delegated work
 * must be visible as the agent screen's showcase): when the workspace
 * holds a browser plan binding, the board loads automatically once per
 * plan, so the work the user just delegated appears without another
 * action. Without a plan binding nothing is fetched until the user asks
 * (operator-credential listing stays an explicit action), so opening the
 * workspace still costs no request in the common case and cannot
 * surprise the shared rate limiter. Row actions are limited to what the API already offers:
 * starting a resume (PR 1-C, which re-plans and requires a fresh
 * approval before anything runs again) and cancelling a run. Changing
 * priority has no board wiring.
 *
 * Re-driving (PR-D3, wiring design §4.5): the operator binding spans
 * every operator run across plans, so when the operator explicitly
 * loads the board and finds runs still queued or running — work whose
 * driver went away, e.g. the workspace tab was closed mid-drive — the
 * board resumes driving them with the same bounded advance loop the
 * workspace uses, then refreshes the list. This only continues work a
 * human already approved; held runs are never driven from here (they
 * need the resume flow's fresh approval, design §8), browser-bound
 * loads never drive (the binding is per-plan and auto-loads during
 * planning), and internal reloads after row actions do not re-trigger
 * driving.
 */

const TOOL_LABELS: Record<string, string> = {
  document_generator: '文書作成',
  code_interpreter: 'コード作成・確認',
  image_prompt_compiler: '画像の指示づくり',
  web_search_grounding: 'ウェブ調査',
  repository_explorer: 'ファイル一覧の確認',
  file_reader: 'ファイルの読み取り',
  file_writer: 'ファイルの作成・編集',
  verification_runner: 'テスト・動作確認',
};
const toolLabel = (name: string | null | undefined): string => (name ? TOOL_LABELS[name] ?? '作業ステップ' : '作業ステップ');

const RUN_STATUS_LABELS: Record<string, string> = {
  planning: '計画中',
  awaiting_approval: '承認待ち',
  queued: '実行待ち',
  running: '実行中',
  held: '保留中',
  completed: '完了',
  failed: '失敗',
  cancelled: '取り消し済み',
  expired: '期限切れ',
};
const KNOWN_RUN_STATUSES = new Set(Object.keys(RUN_STATUS_LABELS));
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const CANCELLABLE_STATUSES = new Set(['planning', 'awaiting_approval', 'queued', 'held']);

const STEP_STATUS_LABELS: Record<string, string> = {
  queued: '未実行',
  running: '実行中',
  completed: '完了',
  failed: '失敗',
  blocked: '停止中',
};

const HOLD_REASON_LABELS: Record<string, string> = {
  quota_exhausted: '無料枠の回復待ち',
  awaiting_approval: '承認されないまま期限を過ぎたため',
  scheduled_time: '指定した時刻を待っています',
  condition_wait: '条件が整うのを待っています',
  dependency_wait: '他の作業の完了を待っています',
  user_paused: '手動で保留にしています',
  driver_unavailable: '進める担当がいないため',
};

const GROUP_DEFS: Array<{ key: string; title: string; statuses: string[] }> = [
  { key: 'approval', title: '承認待ち', statuses: ['awaiting_approval'] },
  { key: 'active', title: '実行中', statuses: ['planning', 'queued', 'running'] },
  { key: 'held', title: '保留中', statuses: ['held'] },
  { key: 'done', title: '完了・終了', statuses: ['completed', 'failed', 'cancelled', 'expired'] },
];

type ResumeConditionView =
  | { kind: 'manual' }
  | { kind: 'at_time'; at: number }
  | { kind: 'quota_reset'; provider: string; resetAt?: number }
  | { kind: 'dependency'; targetKind: string; targetId: string }
  | { kind: 'condition'; conditionRef: string };

type RunHoldView = {
  reason: string;
  resumeCondition: ResumeConditionView;
  heldSince: number;
  resumeAttempts: number;
};

type RunStepStateView = { id: string; status: string; attempts: number };
type RunPlanStepView = { toolName: string; params: Record<string, unknown> };

type RunView = {
  runId: string;
  status: string;
  goal: string;
  plan: RunPlanStepView[] | null;
  stepsState: RunStepStateView[];
  hold: RunHoldView | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type PlanDiffStepView = {
  change: string;
  toolName: string | null;
  previousToolName: string | null;
};

type ResumeSession = {
  runId: string;
  planToken: string;
  planExpiresAt: string;
  planChanged: boolean;
  diffSteps: PlanDiffStepView[];
  steps: RunPlanStepView[];
  titles: string[];
  busy: boolean;
  message: string | null;
};

type BoardAuth = { kind: 'operator'; credential: string } | { kind: 'browser'; planToken: string };
type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'auth-error' | 'error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseResumeCondition(raw: unknown): ResumeConditionView | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null;
  if (raw.kind === 'manual') return { kind: 'manual' };
  if (raw.kind === 'at_time' && typeof raw.at === 'number') return { kind: 'at_time', at: raw.at };
  if (raw.kind === 'quota_reset' && typeof raw.provider === 'string') {
    return { kind: 'quota_reset', provider: raw.provider, resetAt: typeof raw.resetAt === 'number' ? raw.resetAt : undefined };
  }
  if (raw.kind === 'dependency' && typeof raw.targetKind === 'string' && typeof raw.targetId === 'string') {
    return { kind: 'dependency', targetKind: raw.targetKind, targetId: raw.targetId };
  }
  if (raw.kind === 'condition' && typeof raw.conditionRef === 'string') return { kind: 'condition', conditionRef: raw.conditionRef };
  return null;
}

function parseRunView(raw: unknown): RunView | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.runId !== 'string' || !raw.runId.startsWith('run-')) return null;
  if (typeof raw.status !== 'string' || !KNOWN_RUN_STATUSES.has(raw.status)) return null;
  if (typeof raw.goal !== 'string') return null;
  const plan = Array.isArray(raw.plan)
    ? raw.plan.filter((step): step is RunPlanStepView => isRecord(step) && typeof step.toolName === 'string' && isRecord(step.params))
    : null;
  const stepsState = Array.isArray(raw.stepsState)
    ? raw.stepsState.filter((step): step is RunStepStateView => isRecord(step) && typeof step.id === 'string' && typeof step.status === 'string' && typeof step.attempts === 'number')
    : [];
  let hold: RunHoldView | null = null;
  if (isRecord(raw.hold) && typeof raw.hold.reason === 'string') {
    const condition = parseResumeCondition(raw.hold.resumeCondition);
    if (condition) {
      hold = {
        reason: raw.hold.reason,
        resumeCondition: condition,
        heldSince: typeof raw.hold.heldSince === 'number' ? raw.hold.heldSince : 0,
        resumeAttempts: typeof raw.hold.resumeAttempts === 'number' ? raw.hold.resumeAttempts : 0,
      };
    }
  }
  return {
    runId: raw.runId,
    status: raw.status,
    goal: raw.goal,
    plan,
    stepsState,
    hold,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : '',
  };
}

function formatDateTime(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function goalSummary(goal: string): string {
  const collapsed = goal.replace(/\s+/g, ' ').trim();
  return collapsed.length > 90 ? `${collapsed.slice(0, 90)}…` : collapsed;
}

function resumeConditionText(condition: ResumeConditionView): string {
  if (condition.kind === 'manual') return '手動で再開できます';
  if (condition.kind === 'at_time') return `${formatDateTime(condition.at)} 以降に再開できます`;
  if (condition.kind === 'quota_reset') {
    return condition.resetAt
      ? `無料枠の回復後に再開できます（目安: ${formatDateTime(condition.resetAt)}頃）`
      : '無料枠の回復後に再開できます';
  }
  if (condition.kind === 'dependency') return '対象の作業が終わったら再開できます';
  return '条件が整ったら再開できます';
}

function statusChipClass(status: string): string {
  if (status === 'awaiting_approval') return 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300';
  if (status === 'running' || status === 'queued' || status === 'planning') return 'border-origin-brand-border text-origin-brand';
  if (status === 'completed') return 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300';
  if (status === 'failed') return 'border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300';
  return 'border-origin-border text-origin-muted';
}

function diffLines(diffSteps: PlanDiffStepView[]): string[] {
  const lines: string[] = [];
  for (const step of diffSteps) {
    if (step.change === 'added') lines.push(`追加: ${toolLabel(step.toolName)}`);
    else if (step.change === 'removed') lines.push(`削除: ${toolLabel(step.previousToolName)}`);
    else if (step.change === 'modified') {
      lines.push(step.previousToolName && step.toolName && step.previousToolName !== step.toolName
        ? `変更: ${toolLabel(step.previousToolName)} → ${toolLabel(step.toolName)}`
        : `内容の変更: ${toolLabel(step.toolName)}`);
    }
  }
  return lines;
}

export default function AgentTaskBoard({ browserPlanToken }: { browserPlanToken?: string | null }) {
  const [auth, setAuth] = useState<BoardAuth | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunView[] | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [confirmingCancelRunId, setConfirmingCancelRunId] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ runId: string; text: string } | null>(null);
  const [resumeSession, setResumeSession] = useState<ResumeSession | null>(null);
  const credentialInputRef = useRef<HTMLInputElement>(null);
  const previousTokenRef = useRef<string | null>(browserPlanToken ?? null);
  const autoLoadedTokenRef = useRef<string | null>(null);
  const redriveAbortRef = useRef<AbortController | null>(null);
  const redriveInFlightRef = useRef(false);

  // If the workspace moves to a different plan, browser-bound results of
  // the previous plan no longer belong on screen.
  useEffect(() => {
    const next = browserPlanToken ?? null;
    if (previousTokenRef.current !== next) {
      previousTokenRef.current = next;
      setAuth((current) => {
        if (current?.kind === 'browser' && current.planToken !== next) {
          setRuns(null);
          setLoadState('idle');
          setResumeSession(null);
          setExpandedRunId(null);
          return null;
        }
        return current;
      });
    }
  }, [browserPlanToken]);

  useEffect(() => () => {
    redriveAbortRef.current?.abort();
    if (credentialInputRef.current) credentialInputRef.current.value = '';
  }, []);

  const resolveAuth = (): BoardAuth | null => {
    const credential = credentialInputRef.current?.value.trim() ?? '';
    if (credential) return { kind: 'operator', credential };
    if (browserPlanToken) return { kind: 'browser', planToken: browserPlanToken };
    return null;
  };

  const authHeaders = (value: BoardAuth): HeadersInit => (value.kind === 'operator'
    ? { Authorization: `Bearer ${value.credential}` }
    : { 'x-agent-plan-token': value.planToken });
  const postHeaders = (value: BoardAuth): HeadersInit => (value.kind === 'operator'
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${value.credential}` }
    : { 'Content-Type': 'application/json' });

  const load = async (authOverride?: BoardAuth) => {
    const resolved = authOverride ?? resolveAuth();
    if (!resolved) {
      setNotice('タスクを表示するには、管理者キーを入力するか、この画面で計画を作成してください。');
      return;
    }
    setAuth(resolved);
    setLoadState('loading');
    setNotice(null);
    try {
      const response = await fetch('/api/agent/v3/runs?limit=50', {
        headers: authHeaders(resolved),
        cache: 'no-store',
      });
      const data = await response.json() as { ok?: boolean; code?: string; runs?: unknown };
      if (response.status === 503 && data.code === 'AGENT_RUN_STORE_UNAVAILABLE') {
        setLoadState('unavailable');
        setRuns(null);
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setLoadState('auth-error');
        return;
      }
      if (!response.ok || data.ok !== true || !Array.isArray(data.runs)) {
        setLoadState('error');
        return;
      }
      const parsed = data.runs.map(parseRunView).filter((run): run is RunView => run !== null);
      setRuns(parsed);
      setLoadState('ready');
      // Re-drive (PR-D3): only an explicit load by the operator — the
      // board's "show tasks" action with a credential, never an
      // internal reload or a browser-bound auto-load — picks up
      // orphaned queued/running runs (design §4.5).
      if (!authOverride && resolved.kind === 'operator') {
        void redriveOperatorRuns(resolved, parsed);
      }
    } catch {
      setLoadState('error');
    }
  };

  // Continues already-approved operator runs whose driver went away.
  // Each run is driven with the workspace's bounded advance loop; a
  // run that fails or parks (held, store unavailable) simply stops and
  // keeps its record state. Afterwards the list is reloaded through
  // the internal path, which never re-triggers driving — but only when
  // at least one drive actually got a server response; if every drive
  // died on the wire nothing could have changed, and the display the
  // operator is looking at stays untouched.
  const redriveOperatorRuns = async (auth: BoardAuth & { kind: 'operator' }, listed: RunView[]) => {
    const pending = listed.filter((run) => run.status === 'queued' || run.status === 'running');
    if (pending.length === 0 || redriveInFlightRef.current) return;
    redriveInFlightRef.current = true;
    const controller = new AbortController();
    redriveAbortRef.current = controller;
    let anyResponse = false;
    try {
      for (const run of pending) {
        if (controller.signal.aborted) break;
        const outcome = await driveAgentRun(run.runId, auth, controller.signal).catch(() => null);
        if (outcome) anyResponse = true;
      }
      if (anyResponse && !controller.signal.aborted) await load(auth);
    } finally {
      redriveInFlightRef.current = false;
      if (redriveAbortRef.current === controller) redriveAbortRef.current = null;
    }
  };

  // Auto-display: once per browser plan binding, load the runs bound to
  // it so delegated work is visible without pressing "タスクを表示".
  useEffect(() => {
    const token = browserPlanToken ?? null;
    if (!token || autoLoadedTokenRef.current === token) return;
    autoLoadedTokenRef.current = token;
    void load({ kind: 'browser', planToken: token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserPlanToken]);

  const startResume = async (run: RunView) => {
    const resolved = auth ?? resolveAuth();
    if (!resolved) {
      setNotice('タスクを表示するには、管理者キーを入力するか、この画面で計画を作成してください。');
      return;
    }
    setAuth(resolved);
    setBusyRunId(run.runId);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/agent/v3/runs/${encodeURIComponent(run.runId)}/resume`, {
        method: 'POST',
        headers: postHeaders(resolved),
        cache: 'no-store',
        body: JSON.stringify(resolved.kind === 'browser' ? { planToken: resolved.planToken } : {}),
      });
      const data = await response.json() as {
        ok?: boolean; code?: string; planToken?: string; planExpiresAt?: string; planChanged?: boolean;
        planDiff?: { steps?: unknown };
        steps?: unknown; plan?: unknown;
      };
      if (!response.ok || data.ok !== true || typeof data.planToken !== 'string') {
        const text = response.status === 422
          ? '今のルールでは計画を作り直せないため、再開できませんでした。'
          : response.status === 403
            ? '再開に必要な確認の期限が切れているため、再開できませんでした。'
            : '再開を開始できませんでした。';
        setActionMessage({ runId: run.runId, text });
        return;
      }
      const steps = Array.isArray(data.steps)
        ? data.steps.filter((step): step is RunPlanStepView => isRecord(step) && typeof step.toolName === 'string' && isRecord(step.params))
        : [];
      const titles = Array.isArray(data.plan)
        ? data.plan.filter((step): step is { id: string; title: string } => isRecord(step) && typeof step.title === 'string').map((step) => step.title)
        : [];
      const diffSteps = isRecord(data.planDiff) && Array.isArray(data.planDiff.steps)
        ? data.planDiff.steps.filter((step): step is PlanDiffStepView => isRecord(step) && typeof step.change === 'string')
          .map((step) => ({
            change: step.change,
            toolName: typeof step.toolName === 'string' ? step.toolName : null,
            previousToolName: typeof step.previousToolName === 'string' ? step.previousToolName : null,
          }))
        : [];
      setResumeSession({
        runId: run.runId,
        planToken: data.planToken,
        planExpiresAt: typeof data.planExpiresAt === 'string' ? data.planExpiresAt : '',
        planChanged: data.planChanged === true,
        diffSteps,
        steps,
        titles,
        busy: false,
        message: null,
      });
      setExpandedRunId(run.runId);
    } catch {
      setActionMessage({ runId: run.runId, text: '再開を開始できませんでした。' });
    } finally {
      setBusyRunId(null);
    }
  };

  const approveResume = async (session: ResumeSession) => {
    const resolved = auth ?? resolveAuth();
    if (!resolved) return;
    setResumeSession({ ...session, busy: true, message: null });
    try {
      const approvalResponse = await fetch(resolved.kind === 'operator' ? '/api/agent/v3/approval' : '/api/agent/v3/browser-approval', {
        method: 'POST',
        headers: postHeaders(resolved),
        cache: 'no-store',
        body: JSON.stringify({
          runId: session.runId,
          planToken: session.planToken,
          steps: session.steps,
          ...(resolved.kind === 'browser' ? { confirm: true } : {}),
        }),
      });
      const approval = await approvalResponse.json() as { ok?: boolean; approvalToken?: string };
      if (!approvalResponse.ok || approval.ok !== true || typeof approval.approvalToken !== 'string') {
        throw new Error('AGENT_APPROVAL_FAILED');
      }
      const confirmResponse = await fetch(`/api/agent/v3/runs/${encodeURIComponent(session.runId)}/resume/confirm`, {
        method: 'POST',
        headers: postHeaders(resolved),
        cache: 'no-store',
        body: JSON.stringify({
          ...(resolved.kind === 'browser' ? { planToken: resolved.planToken } : {}),
          approvalToken: approval.approvalToken,
        }),
      });
      const confirmed = await confirmResponse.json() as { ok?: boolean };
      if (!confirmResponse.ok || confirmed.ok !== true) throw new Error('AGENT_RUN_CONFIRM_FAILED');
      setResumeSession(null);
      setActionMessage(null);
      await load(resolved);
    } catch {
      setResumeSession((current) => (current && current.runId === session.runId
        ? { ...current, busy: false, message: '承認を完了できませんでした。期限が切れている場合は、閉じてから「再開する」を押し直してください。' }
        : current));
    }
  };

  const cancelRun = async (run: RunView) => {
    const resolved = auth ?? resolveAuth();
    if (!resolved) return;
    setBusyRunId(run.runId);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/agent/v3/runs/${encodeURIComponent(run.runId)}/cancel`, {
        method: 'POST',
        headers: postHeaders(resolved),
        cache: 'no-store',
        body: JSON.stringify(resolved.kind === 'browser' ? { planToken: resolved.planToken } : {}),
      });
      const data = await response.json() as { ok?: boolean; code?: string };
      if (!response.ok || data.ok !== true) {
        setActionMessage({
          runId: run.runId,
          text: data.code === 'AGENT_RUN_IN_PROGRESS' ? '実行中のため取り消せませんでした。' : '取り消せませんでした。',
        });
        return;
      }
      setConfirmingCancelRunId(null);
      await load(resolved);
    } catch {
      setActionMessage({ runId: run.runId, text: '取り消せませんでした。' });
    } finally {
      setBusyRunId(null);
    }
  };

  const renderRunDetail = (run: RunView) => {
    const planSteps = run.plan ?? [];
    const hasWriteStep = planSteps.some((step) => step.toolName === 'file_writer');
    const stepRows = Math.max(planSteps.length, run.stepsState.length);
    return <div className="mt-3 border-t border-origin-border pt-3">
      {stepRows > 0 ? <ol className="space-y-1 text-sm">
        {Array.from({ length: stepRows }, (_, index) => {
          const planStep = planSteps[index];
          const state = run.stepsState[index];
          return <li key={planStep ? `${index}-${planStep.toolName}` : state?.id ?? index} className="flex items-center justify-between gap-3">
            <span>{index + 1}. {planStep ? toolLabel(planStep.toolName) : '作業ステップ'}</span>
            <span className="text-xs text-origin-muted">
              {state ? STEP_STATUS_LABELS[state.status] ?? '未実行' : '未実行'}
              {state && state.attempts > 1 ? ` · ${state.attempts}回試行` : ''}
            </span>
          </li>;
        })}
      </ol> : <p className="text-sm text-origin-muted">計画はまだありません。</p>}
      {hasWriteStep && (run.status === 'queued' || run.status === 'running') && (
        <p className="mt-2 text-xs leading-5 text-origin-muted">ファイルの作成・編集は、他の作業の書き込みと重ならないよう、1件ずつ順番に実行されます。</p>
      )}
      {run.hold && <div className="mt-2 space-y-1 text-xs leading-5 text-origin-muted">
        <p>保留の理由: {HOLD_REASON_LABELS[run.hold.reason] ?? '保留中です'}</p>
        <p>再開の条件: {resumeConditionText(run.hold.resumeCondition)}</p>
        <p>保留した日時: {formatDateTime(run.hold.heldSince)}</p>
      </div>}
      <p className="mt-2 text-xs text-origin-muted">
        作成: {formatDateTime(run.createdAt)} · 更新: {formatDateTime(run.updatedAt)} · 記録の期限: {formatDateTime(run.expiresAt)}
      </p>
    </div>;
  };

  const renderResumePanel = (run: RunView, session: ResumeSession) => {
    const lines = diffLines(session.diffSteps);
    return <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30" role="group" aria-label="再開する計画の承認">
      <p className="text-sm font-black">再開する計画</p>
      {session.planChanged
        ? <>
          <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">計画が前回から変わっています。内容を確認してから承認してください。</p>
          {lines.length > 0 && <ul className="mt-1 space-y-1 text-xs leading-5">{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
        </>
        : <p className="mt-1 text-xs leading-5">計画は前回と同じ内容です。</p>}
      <ol className="mt-2 space-y-1 pl-5 text-sm">
        {(session.titles.length > 0 ? session.titles : session.steps.map((step) => toolLabel(step.toolName))).map((title, index) => (
          <li key={`${index}-${title}`}>{title}</li>
        ))}
      </ol>
      <p className="mt-2 text-xs leading-5 text-origin-muted">再開には新しい承認が必要です。承認すると、この仕事は実行待ちに入ります。やめた場合、この仕事は「承認待ち」のまま残ります。</p>
      {session.message && <p role="alert" className="mt-2 text-xs font-semibold leading-5 text-rose-700 dark:text-rose-300">{session.message}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void approveResume(session)} disabled={session.busy}
          className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-bold disabled:opacity-50">
          {session.busy ? '承認中…' : '承認して再開する'}
        </button>
        <button type="button" onClick={() => setResumeSession(null)} disabled={session.busy}
          className="origin-secondary-button min-h-11 rounded-xl px-3 text-sm font-semibold">やめる</button>
      </div>
    </div>;
  };

  const renderRun = (run: RunView) => {
    const total = run.stepsState.length > 0 ? run.stepsState.length : (run.plan?.length ?? 0);
    const done = run.stepsState.filter((step) => step.status === 'completed').length;
    const session = resumeSession?.runId === run.runId ? resumeSession : null;
    const expanded = expandedRunId === run.runId;
    return <article key={run.runId} className="rounded-xl border border-origin-border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-bold leading-6">{goalSummary(run.goal)}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${statusChipClass(run.status)}`}>
          {RUN_STATUS_LABELS[run.status]}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-origin-muted">
        {total > 0 ? `ステップ ${done}/${total}` : ''}
        {run.status === 'held' && run.hold ? `${total > 0 ? ' · ' : ''}${HOLD_REASON_LABELS[run.hold.reason] ?? '保留中です'} · ${resumeConditionText(run.hold.resumeCondition)}` : ''}
      </p>
      {actionMessage?.runId === run.runId && (
        <p role="alert" className="mt-2 text-xs font-semibold leading-5 text-rose-700 dark:text-rose-300">{actionMessage.text}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => setExpandedRunId(expanded ? null : run.runId)}
          className="origin-secondary-button min-h-11 rounded-xl px-3 text-xs font-semibold">
          {expanded ? '詳細を閉じる' : '詳細'}
        </button>
        {(run.status === 'held' || run.status === 'awaiting_approval') && !session && (
          <button type="button" onClick={() => void startResume(run)} disabled={busyRunId === run.runId}
            className="origin-primary-button min-h-11 rounded-xl px-3 text-xs font-bold disabled:opacity-50">
            {busyRunId === run.runId ? '準備中…' : '再開する'}
          </button>
        )}
        {CANCELLABLE_STATUSES.has(run.status) && (confirmingCancelRunId === run.runId ? (
          <>
            <button type="button" onClick={() => void cancelRun(run)} disabled={busyRunId === run.runId}
              className="min-h-11 rounded-xl border border-rose-300 bg-rose-50 px-3 text-xs font-bold text-rose-900 disabled:opacity-50 dark:bg-rose-950/30 dark:text-rose-200">
              {busyRunId === run.runId ? '取り消し中…' : '本当に取り消す'}
            </button>
            <button type="button" onClick={() => setConfirmingCancelRunId(null)}
              className="origin-secondary-button min-h-11 rounded-xl px-3 text-xs font-semibold">やめる</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmingCancelRunId(run.runId)}
            className="origin-secondary-button min-h-11 rounded-xl px-3 text-xs font-semibold">取り消す</button>
        ))}
      </div>
      {expanded && renderRunDetail(run)}
      {session && renderResumePanel(run, session)}
    </article>;
  };

  const grouped = GROUP_DEFS.map((group) => ({
    ...group,
    items: (runs ?? []).filter((run) => group.statuses.includes(run.status)),
  })).filter((group) => group.items.length > 0);

  return <section className="origin-workspace rounded-2xl p-4" aria-label="タスク">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-black">タスク</h2>
      </div>
      <button type="button" onClick={() => void load()} disabled={loadState === 'loading'}
        className="origin-secondary-button min-h-11 rounded-xl px-3 text-xs font-semibold disabled:opacity-50">
        {loadState === 'loading' ? '読み込み中…' : runs ? '更新' : 'タスクを表示'}
      </button>
    </div>
    <p className="mt-1 text-sm leading-6 text-origin-muted">保留中の仕事や、これまでの仕事の進み具合を確認できます。再開するときは、新しい計画を確認して承認します。</p>

    <details className="mt-2">
      <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold">管理者用の実行認証キー（任意）</summary>
      <p className="mb-2 text-xs leading-5 text-origin-muted">管理者キーを入力すると、管理者として作成されたタスクを表示・操作できます。キーはブラウザーに保存しません。空欄の場合は、この画面で作成した計画に紐づくタスクが対象になります。</p>
      <input ref={credentialInputRef} aria-label="タスク用の実行認証キー" type="password" autoComplete="off" spellCheck={false}
        placeholder="実行認証キー（任意）"
        className="min-h-11 w-full rounded-xl border border-origin-border bg-origin-surface px-3 text-sm" />
    </details>

    {notice && <p role="status" className="mt-2 text-xs leading-5 text-origin-muted">{notice}</p>}
    {loadState === 'unavailable' && <p role="status" className="mt-2 text-sm text-origin-muted">タスクの記録は現在利用できません。</p>}
    {loadState === 'auth-error' && <p role="alert" className="mt-2 text-sm font-semibold text-rose-700 dark:text-rose-300">認証できませんでした。キーを確認してください。</p>}
    {loadState === 'error' && <p role="alert" className="mt-2 text-sm font-semibold text-rose-700 dark:text-rose-300">タスクを読み込めませんでした。</p>}
    {loadState === 'ready' && runs !== null && runs.length === 0 && (
      <p className="mt-2 text-sm text-origin-muted">表示できるタスクはありません。</p>
    )}
    {grouped.map((group) => (
      <div key={group.key} className="mt-4">
        <h3 className="text-sm font-black">{group.title} <span className="text-xs font-semibold text-origin-muted">{group.items.length}件</span></h3>
        <div className="mt-2 space-y-2">{group.items.map(renderRun)}</div>
      </div>
    ))}
  </section>;
}
