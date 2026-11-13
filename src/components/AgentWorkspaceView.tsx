import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OriginCatState, { type OriginCatStateKind } from './OriginCatState';
import AgentTaskBoard from './AgentTaskBoard';
import AgentLivePanel, { AgentResearchSourceCards, parseAgentResearchArtifact } from './AgentLivePanel';
import FormattedMarkdown from './FormattedMarkdown';
import { loadCheckpointsFromIndexedDB, saveCheckpointToIndexedDB } from '../agent/indexedDbCheckpointStore';
import type { CheckpointState } from '../agent/checkpointManager';
import {
  AGENT_RUN_SMALL_ADVANCE_BUDGET_MS,
  createAgentRunRecord,
  driveAgentRun,
  fetchAgentRunView,
  type AgentRunAuth,
  type AgentRunView,
} from '../agent/agentRunClient';
import { reportAgentActivity } from '../agent/agentActivityStore';

type AgentCapability = {
  ready: boolean;
  approvalSigningConfigured: boolean;
  replayProtectionConfigured: boolean;
  browserApprovalEnabled: boolean;
  freeOnly: boolean;
  costUsd: number;
  paidFallbackEnabled: boolean;
};

const tools = [
  'document_generator',
  'code_interpreter',
  'image_prompt_compiler',
  'web_search_grounding',
  'repository_explorer',
  'file_reader',
  'file_writer',
  'verification_runner',
] as const;
type AgentTool = (typeof tools)[number];
const isAgentTool = (value: unknown): value is AgentTool => typeof value === 'string' && tools.includes(value as AgentTool);

type AgentPlanStep = { id: string; title: string };
type AgentToolStep = { toolName: AgentTool; params: Record<string, unknown> };
type AgentPlan = {
  runId: string;
  planToken: string;
  expiresAt: string;
  selectedTool: AgentTool;
  params: Record<string, unknown>;
  steps: AgentToolStep[];
  goal: string;
  plan: AgentPlanStep[];
};

// 'held' and 'recorded' are the runs-path end states (PR-D2/D3): the
// work now lives in the durable record on the task board, not in this
// screen's stateless execution.
type Phase = 'idle' | 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed' | 'held' | 'recorded';

// The runs path returns no checkpoint object (PR-D1 delivers only the
// artifact body), so the on-device save is a local record built from
// the run id and the delivered body. It carries no file mutation, so
// it can be redisplayed from this screen but never rolled back to.
function localRunCheckpoint(runId: string, artifact: string): CheckpointState {
  return {
    checkpointId: `${runId}-runs-v1`,
    taskId: runId,
    executionId: 'agent-run',
    version: 1,
    status: 'completed',
    artifact,
    createdAt: Date.now(),
  };
}
type VerificationKind = 'test' | 'typecheck' | 'lint' | 'build';

// One execution shown in the live panel (agent live view PR-L2). The
// step snapshot and the owner binding are kept in memory only, like
// every other credential in this screen, so the panel can keep
// following the recorded run after this screen's driving stops.
type LiveSession = {
  runId: string;
  steps: AgentToolStep[];
  auth: AgentRunAuth;
};

const AGENT_RUN_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const AGENT_RUN_LIVE_POLL_INTERVAL_MS = 5000;

function authorizationHeaders(credential: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` };
}

function toolLabel(tool: AgentTool): string {
  const labels: Record<AgentTool, string> = {
    document_generator: '文書作成',
    code_interpreter: 'コード作成・確認',
    image_prompt_compiler: '画像の指示づくり',
    web_search_grounding: 'ウェブ調査',
    repository_explorer: 'ファイル一覧の確認',
    file_reader: 'ファイルの読み取り',
    file_writer: 'ファイルの作成・編集',
    verification_runner: 'テスト・動作確認',
  };
  return labels[tool];
}

function hasExecutableParams(tool: AgentTool, params: Record<string, unknown>): boolean {
  if (tool === 'web_search_grounding') return typeof params.query === 'string' && params.query.trim().length > 0;
  if (tool === 'file_writer') {
    if (typeof params.path !== 'string' || params.path.trim().length === 0) return false;
    return (typeof params.content === 'string' && params.content.length > 0) || params.contentFromPreviousArtifact === true;
  }
  if (tool === 'file_reader') return typeof params.path === 'string' && params.path.trim().length > 0;
  if (tool === 'verification_runner') return ['test', 'typecheck', 'lint', 'build'].includes(String(params.kind));
  if (tool === 'image_prompt_compiler') return typeof params.prompt === 'string' && params.prompt.trim().length > 0;
  if (tool === 'document_generator') {
    return (typeof params.title === 'string' && params.title.trim().length > 0)
      || (typeof params.content === 'string' && params.content.trim().length > 0);
  }
  if (tool === 'code_interpreter') {
    if (params.mode === 'provided-code') return typeof params.code === 'string' && params.code.trim().length > 0;
    if (params.mode === 'generate') return typeof params.instruction === 'string' && params.instruction.trim().length > 0;
    return typeof params.code === 'string' && params.code.trim().length > 0;
  }
  return tool === 'repository_explorer';
}

function hasExecutableSteps(plan: AgentPlan): boolean {
  return plan.steps.length > 0 && plan.steps.every((step) => hasExecutableParams(step.toolName, step.params));
}

export function catStateForPhase(phase: Phase, checkingCapability: boolean, ready: boolean): OriginCatStateKind {
  if (checkingCapability) return 'thinking';
  if (!ready) return 'sorry';
  if (phase === 'planning') return 'thinking';
  if (phase === 'awaiting_approval') return 'waiting';
  if (phase === 'executing') return 'working';
  if (phase === 'completed') return 'done';
  if (phase === 'failed') return 'sorry';
  if (phase === 'held') return 'waiting';
  if (phase === 'recorded') return 'working';
  return 'sleep';
}

function checkpointStatusLabel(status: string): string {
  if (status === 'completed') return '完了';
  if (status === 'self_fixed') return '修正済み';
  if (status === 'rolled_back') return '巻き戻し済み';
  return '保存済み';
}

function phaseLabel(phase: Phase): string {
  if (phase === 'planning') return '計画を準備中';
  if (phase === 'awaiting_approval') return '承認待ち';
  if (phase === 'executing') return '実行・検証中';
  if (phase === 'completed') return '完了';
  if (phase === 'failed') return '安全に停止';
  if (phase === 'held') return '保留中';
  if (phase === 'recorded') return '記録済み・実行中';
  return '待機中';
}

export default function AgentWorkspaceView() {
  const [goal, setGoal] = useState('');
  const [capability, setCapability] = useState<AgentCapability | null>(null);
  const [checkingCapability, setCheckingCapability] = useState(true);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  // The task board keeps the most recent plan's binding even after the
  // plan itself is approved or discarded, so delegated work stays
  // visible on the agent screen (the board is the screen's showcase).
  const [boardPlanToken, setBoardPlanToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  // Live view (PR-L2): the run being watched in the 「いまの作業」
  // panel, and the latest run view fed by the drive's progress
  // callback (then by polling once driving hands over at the caps).
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [liveRunView, setLiveRunView] = useState<AgentRunView | null>(null);
  const [artifact, setArtifact] = useState('実行が完了すると、確認済みの結果がここに表示されます。');
  const [checkpoints, setCheckpoints] = useState<CheckpointState[]>([]);
  const [restoring, setRestoring] = useState(true);
  const credentialInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCheckingCapability(true);
    void fetch('/api/agent/v3/status', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as Partial<AgentCapability>;
        if (!response.ok) throw new Error('AGENT_STATUS_UNAVAILABLE');
        setCapability({
          ready: data.ready === true,
          approvalSigningConfigured: data.approvalSigningConfigured === true,
          replayProtectionConfigured: data.replayProtectionConfigured === true,
          browserApprovalEnabled: data.browserApprovalEnabled === true,
          freeOnly: data.freeOnly === true,
          costUsd: typeof data.costUsd === 'number' ? data.costUsd : -1,
          paidFallbackEnabled: data.paidFallbackEnabled === true,
        });
      })
      .catch(() => setCapability(null))
      .finally(() => setCheckingCapability(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadCheckpointsFromIndexedDB()
      .then((restored) => { if (mounted) setCheckpoints(restored); })
      .catch(() => { if (mounted) setLog((current) => [...current, '端末内の実行履歴を読み込めませんでした。']); })
      .finally(() => { if (mounted) setRestoring(false); });
    return () => {
      mounted = false;
      abortRef.current?.abort();
      if (credentialInputRef.current) credentialInputRef.current.value = '';
    };
  }, []);

  const persistCheckpoint = useCallback(async (checkpoint: CheckpointState) => {
    setCheckpoints((current) => [...current.filter((item) => item.checkpointId !== checkpoint.checkpointId), checkpoint].sort((a, b) => a.createdAt - b.createdAt));
    try { await saveCheckpointToIndexedDB(checkpoint); }
    catch { setLog((current) => [...current, '結果はこの画面では利用できますが、端末への保存を確認できませんでした。']); }
  }, []);

  // Live view (PR-L2, design §5.1): once this screen's driving stops
  // at the caps ('recorded') while the run continues, keep the panel
  // current by re-reading the run every few seconds. Polling runs
  // only while the panel is on screen, the last known state is
  // non-terminal, and this screen is no longer driving; it stops on
  // unmount, on a new plan, and when the run reaches a terminal state.
  useEffect(() => {
    if (!liveSession || phase !== 'recorded' || !liveRunView) return undefined;
    if (AGENT_RUN_TERMINAL_STATUSES.has(liveRunView.status)) return undefined;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void fetchAgentRunView(liveSession.runId, liveSession.auth, controller.signal)
        .then((view) => { if (view && !controller.signal.aborted) setLiveRunView(view); })
        .catch(() => undefined);
    }, AGENT_RUN_LIVE_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [liveSession, phase, liveRunView]);

  // 「いまの作業」シート／ヘッダー常駐オリンへの要約の共有（PR-β）。
  // 駆動やポーリングの結果（liveRunView）が変わるたびに、平易な
  // ステップタイトルと進み具合だけを共有ストアへ書く。実行系の
  // 挙動には一切影響しない（書き込み専用の副作用）。
  useEffect(() => {
    if (!liveSession) return;
    const steps = liveSession.steps;
    const total = steps.length;
    const stateAt = (index: number) => liveRunView?.stepsState.find((item) => item.id === `task-${index + 1}`) ?? liveRunView?.stepsState[index];
    const runningIndex = steps.findIndex((_, index) => stateAt(index)?.status === 'running');
    const completedCount = steps.filter((_, index) => stateAt(index)?.status === 'completed').length;
    const runStatus = liveRunView?.status ?? null;
    const terminal = runStatus !== null && AGENT_RUN_TERMINAL_STATUSES.has(runStatus);
    const active = !terminal && (phase === 'executing' || phase === 'recorded' || runningIndex >= 0);
    const currentIndex = runningIndex >= 0 ? runningIndex : Math.min(completedCount, Math.max(0, total - 1));
    reportAgentActivity({
      active,
      outcome: terminal ? (runStatus === 'completed' ? 'completed' : 'failed') : active ? 'running' : null,
      stepTitle: total > 0 ? toolLabel(steps[currentIndex].toolName) : null,
      currentStep: total > 0 ? currentIndex + 1 : 0,
      totalSteps: total,
      updatedAt: Date.now(),
    });
  }, [liveSession, phase, liveRunView]);

  const requestPlan = useCallback(async () => {
    const trimmed = goal.trim();
    const planCapable = capability?.ready === true || capability?.browserApprovalEnabled === true;
    if (!trimmed || phase === 'planning' || phase === 'executing' || !planCapable) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPlan(null);
    setLiveSession(null);
    setLiveRunView(null);
    setPhase('planning');
    setLog(['エージェント: 実行計画を準備しています。']);
    setArtifact('計画を作成しています…');
    try {
      const response = await fetch('/api/agent/v3/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ goal: trimmed }),
        signal: controller.signal,
      });
      const data = await response.json() as Partial<AgentPlan> & { ok?: boolean; code?: string; steps?: Array<{ toolName?: unknown; params?: unknown }> };
      if (!response.ok || data.ok !== true || typeof data.runId !== 'string' || typeof data.planToken !== 'string' || !Array.isArray(data.plan) || !isAgentTool(data.selectedTool) || !data.params || typeof data.params !== 'object' || Array.isArray(data.params)) {
        throw new Error(data.code ?? 'AGENT_PLAN_FAILED');
      }
      const parsedSteps: AgentToolStep[] = Array.isArray(data.steps)
        ? data.steps
          .filter((step): step is { toolName: AgentTool; params: Record<string, unknown> } => Boolean(step) && isAgentTool(step.toolName) && Boolean(step.params) && typeof step.params === 'object' && !Array.isArray(step.params))
          .map((step) => ({ toolName: step.toolName, params: step.params }))
        : [];
      const next: AgentPlan = {
        runId: data.runId,
        planToken: data.planToken,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
        selectedTool: data.selectedTool,
        params: data.params as Record<string, unknown>,
        steps: parsedSteps.length > 0 ? parsedSteps : [{ toolName: data.selectedTool, params: data.params as Record<string, unknown> }],
        goal: trimmed,
        plan: data.plan.filter((step): step is AgentPlanStep => Boolean(step) && typeof step.id === 'string' && typeof step.title === 'string').slice(0, 12),
      };
      setPlan(next);
      setBoardPlanToken(next.planToken);
      setPhase('awaiting_approval');
      setArtifact([
        '# 実行計画',
        '',
        `依頼: ${next.goal}`,
        `機能: ${next.steps.map((step) => toolLabel(step.toolName)).join(' → ')}`,
        '',
        ...next.plan.map((step, index) => `${index + 1}. ${step.title}`),
        '',
        '実行には、この計画の内容に限定した承認が必要です。',
        '承認はこの実行内容だけに有効で、再利用はできません。',
      ].join('\n'));
      setLog((current) => [...current, `計画を作成しました。実行する機能: ${next.steps.map((step) => toolLabel(step.toolName)).join(' → ')}。まだツールは実行していません。`]);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPhase('failed');
        setLog((current) => [...current, '計画を作成できませんでした。依頼内容をご確認のうえ、もう一度お試しください。']);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [capability?.browserApprovalEnabled, capability?.ready, goal, phase]);

  const approveAndExecute = useCallback(async () => {
    if (!plan || phase !== 'awaiting_approval') return;
    // Two approval modes: with an operator credential the admin endpoint is
    // used; without one, the browser approval endpoint authorizes the exact
    // plan from this same-origin session after the explicit approve action.
    const credential = credentialInputRef.current?.value.trim() ?? '';
    if (plan.expiresAt && Date.parse(plan.expiresAt) <= Date.now()) {
      setPlan(null);
      setPhase('failed');
      setLog((current) => [...current, '計画の承認期限が切れました。新しい計画を作成してください。']);
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      return;
    }

    if (!hasExecutableSteps(plan)) {
      setPhase('failed');
      setLog((current) => [...current, '計画のステップに必要な指定が不足しているため、承認前に停止しました。']);
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('executing');
    setLog((current) => [...current, `承認対象: ${plan.steps.map((step) => toolLabel(step.toolName)).join(' → ')}`, credential ? '実行前の安全確認を取得しています。' : 'このブラウザで承認し、実行前の安全確認を取得しています。']);
    // Single-step plans keep the legacy {toolName, params} wire shape; the
    // server canonicalizes both shapes to the same signed operation.
    const operationBody = plan.steps.length === 1
      ? { toolName: plan.steps[0].toolName, params: plan.steps[0].params }
      : { steps: plan.steps };
    try {
      const approvalResponse = await fetch(credential ? '/api/agent/v3/approval' : '/api/agent/v3/browser-approval', {
        method: 'POST',
        headers: credential ? authorizationHeaders(credential) : { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          runId: plan.runId,
          planToken: plan.planToken,
          ...operationBody,
          ...(credential ? {} : { confirm: true }),
        }),
        signal: controller.signal,
      });
      const approval = await approvalResponse.json() as { ok?: boolean; approvalToken?: string; code?: string };
      if (!approvalResponse.ok || approval.ok !== true || typeof approval.approvalToken !== 'string') {
        throw new Error(approval.code ?? 'AGENT_APPROVAL_FAILED');
      }

      // Both approval modes (PR-D2 browser, PR-D3 operator; wiring
      // design §4.1/§4.4): the approved plan is recorded as a durable
      // run first and then driven from here, replacing the stateless
      // /execute call. Only the owner binding differs — the plan token
      // in the body for the browser, the Bearer credential for the
      // operator; the creation body and the drive are identical. If
      // the record cannot be created, nothing executes — there is no
      // fallback (design §4.6).
      const runAuth: AgentRunAuth = credential
        ? { kind: 'operator', credential }
        : { kind: 'browser', planToken: plan.planToken };
      const creation = await createAgentRunRecord(
        { runId: plan.runId, goal: plan.goal, planToken: plan.planToken, steps: plan.steps },
        approval.approvalToken,
        runAuth,
        controller.signal,
      );
      if (creation === 'store_unavailable') {
        setPhase('failed');
        setArtifact('実行は開始していません。タスクの記録が利用できないため、安全に停止しました。');
        setLog((current) => [...current, 'タスクの記録が利用できないため、安全に停止しました。実行は開始していません。']);
        return;
      }
      setLog((current) => [...current, '実行を記録しました。進み具合はタスクボードにも表示されます。']);
      // Live view (PR-L2): from here the 「いまの作業」 panel follows
      // this run. Driving uses the small per-advance budget so each
      // advance returns after a step or two, and every response's run
      // view is fed into the panel as it arrives (design §5.1).
      setLiveSession({ runId: plan.runId, steps: plan.steps, auth: runAuth });
      setLiveRunView(null);
      const outcome = await driveAgentRun(plan.runId, runAuth, controller.signal, {
        budgetMs: AGENT_RUN_SMALL_ADVANCE_BUDGET_MS,
        onProgress: (view) => { if (view.runId === plan.runId) setLiveRunView(view); },
      });
      if (outcome.kind === 'completed') {
        setArtifact(outcome.artifact ?? '実行が完了しました。');
        if (outcome.artifact) await persistCheckpoint(localRunCheckpoint(plan.runId, outcome.artifact));
        setPhase('completed');
        setLog((current) => [...current, '機能の実行と確認が完了しました。', outcome.artifact ? '結果を端末内に保存しました。' : '']);
        setPlan(null);
        return;
      }
      if (outcome.kind === 'held') {
        setPhase('held');
        setArtifact('実行は保留中です。無料枠が回復したら、下のタスクボードから再開できます。');
        setLog((current) => [...current, '無料枠の上限に達したため、実行を保留にしました。記録は残っているので、タスクボードから再開できます。']);
        setPlan(null);
        return;
      }
      if (outcome.kind === 'recorded') {
        setPhase('recorded');
        setArtifact('実行は記録され、続行しています。この画面での見守りはここまでです。進み具合は下のタスクボードで確認できます。');
        setLog((current) => [...current, '実行は記録済みで続行しています。進み具合はタスクボードで確認できます。']);
        setPlan(null);
        return;
      }
      if (outcome.kind === 'store_unavailable') {
        setPhase('failed');
        setArtifact('タスクの記録が利用できなくなったため、安全に停止しました。記録の状態はタスクボードで確認できます。');
        setLog((current) => [...current, 'タスクの記録が利用できなくなったため、安全に停止しました。']);
        return;
      }
      // outcome.kind === 'failed': the server's reason code stays off
      // screen; the log line is the plain-language mapping (design §4.6).
      console.error('Agent run failed:', outcome.code ?? 'AGENT_RUN_FAILED');
      setPhase('failed');
      setLog((current) => [...current, '実行が完了できませんでした。タスクボードの記録もあわせてご確認ください。']);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPhase('failed');
        setLog((current) => [...current, '処理を完了できませんでした。設定や依頼内容をご確認のうえ、もう一度お試しください。']);
      }
    } finally {
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [persistCheckpoint, phase, plan]);

  const resetPlan = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPlan(null);
    setLiveSession(null);
    setLiveRunView(null);
    setPhase('idle');
    setLog((current) => [...current, '計画をリセットしました。未承認の操作は実行していません。']);
    if (credentialInputRef.current) credentialInputRef.current.value = '';
  };

  const restoreLocalCheckpoint = (checkpoint: CheckpointState) => {
    setArtifact(checkpoint.artifact);
    setLog((current) => [...current, '端末内に保存した結果を表示しました（サーバーの状態は変わりません）。']);
  };

  const ready = (capability?.ready === true || capability?.browserApprovalEnabled === true)
    && capability.freeOnly === true
    && capability.costUsd === 0
    && capability.paidFallbackEnabled === false;
  const plannedParamsReady = plan ? hasExecutableSteps(plan) : false;
  // A research-final run delivers its artifact as a sources JSON
  // string; show it as source cards instead of raw JSON (PR-L2).
  const researchArtifact = useMemo(() => parseAgentResearchArtifact(artifact), [artifact]);

  // 実況パネルのオリンは、実行中ステップがウェブ調査のときは専用の
  // 「調べている」状態にする（working からの分離、動きの作り直し
  // 第1段 PR-β）。それ以外は従来のフェーズ連動のまま。
  const livePanelCatState: OriginCatStateKind = (() => {
    if (liveSession && liveRunView) {
      const runningIndex = liveSession.steps.findIndex((_, index) => {
        const state = liveRunView.stepsState.find((item) => item.id === `task-${index + 1}`) ?? liveRunView.stepsState[index];
        return state?.status === 'running';
      });
      if (runningIndex >= 0 && liveSession.steps[runningIndex]?.toolName === 'web_search_grounding') return 'searching';
    }
    return catStateForPhase(phase, checkingCapability, ready);
  })();

  return <section className="min-h-full bg-origin-paper p-3 text-origin-ink md:p-5" aria-label="エージェント">
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.35fr)]">
      <aside className="origin-workspace rounded-2xl p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-origin-brand">エージェント</p>
        <h1 className="mt-1 text-xl font-black">エージェントに任せる</h1>
        <p className="mt-1 text-sm leading-6 text-origin-muted">計画を確認してから、選択した機能を実行し、結果を確認します。</p>

        <label htmlFor="agent-goal" className="mt-4 block text-sm font-bold">達成したいこと</label>
        <textarea id="agent-goal" value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={4000}
          disabled={phase === 'planning' || Boolean(plan) || phase === 'executing'}
          placeholder="例: この要件を整理して、実行可能な文書案を作ってください。"
          className="mt-2 min-h-28 w-full resize-y rounded-xl border border-origin-border bg-origin-surface p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-origin-brand disabled:cursor-not-allowed disabled:opacity-70" />

        <div role="status" className="mt-3 flex items-center justify-between gap-3 text-xs">
          <span className="text-origin-muted">{checkingCapability ? 'エージェント機能を確認中…' : ready ? 'エージェントを利用できます' : 'エージェントは現在利用できません'}</span>
          <span className="flex items-center gap-2">
            <OriginCatState state={catStateForPhase(phase, checkingCapability, ready)} pedestal />
            <span className={ready ? 'font-bold text-emerald-700 dark:text-emerald-300' : 'font-bold text-amber-700 dark:text-amber-300'}>
              {checkingCapability ? '確認中' : ready ? phaseLabel(phase) : '利用できません'}
            </span>
          </span>
        </div>

        <button type="button" onClick={() => void requestPlan()} disabled={!ready || !goal.trim() || Boolean(plan) || phase === 'planning' || phase === 'executing'}
          className="origin-primary-button mt-3 min-h-11 w-full rounded-xl px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {phase === 'planning' ? '計画中…' : '実行計画を作る'}
        </button>

        {plan && <section className="mt-4 rounded-xl border border-origin-border p-3" aria-label="実行計画">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black">実行の流れ</h2>
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">未実行 · 承認待ち</span>
          </div>
          <ol className="mt-2 space-y-2 text-sm">{plan.plan.map((step, index) => <li key={step.id} className="flex gap-2">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-origin-brand-soft text-[11px] font-black text-origin-brand">{index + 1}</span>
            <span>{step.title}</span>
          </li>)}</ol>

          <p className="mt-4 block text-xs font-bold text-origin-muted">実行する機能</p>
          <div aria-label="実行する機能" className="mt-1 min-h-11 w-full rounded-xl border border-origin-border bg-origin-surface-muted px-3 py-3 text-sm font-semibold">
            {plan.steps.map((step) => toolLabel(step.toolName)).join(' → ')}
          </div>
          <p className="mt-1 text-xs leading-5 text-origin-muted">実行する機能は、この計画の内容と一致するよう確認されます。依頼内容を変える場合は計画を破棄して作り直します。</p>
          {!plannedParamsReady && <p role="alert" className="mt-2 text-xs font-semibold leading-5 text-amber-700 dark:text-amber-300">この操作には、対象の場所や内容などの具体的な指定が不足しています。依頼文を具体化して計画を作り直してください。</p>}

          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold">管理者用の実行認証キー（任意）</summary>
            <p className="mb-2 text-xs leading-5 text-origin-muted">通常は空欄のままで問題ありません。「承認して実行」を押すと、このブラウザ上で計画を確認したものとして承認されます。管理者キーを入力した場合は管理者用の承認経路を使います。キーはブラウザーに保存しません。</p>
            <input ref={credentialInputRef} id="execution-credential" aria-label="実行認証キー" type="password" autoComplete="off" spellCheck={false}
              placeholder="実行認証キー（任意）"
              className="min-h-11 w-full rounded-xl border border-origin-border bg-origin-surface px-3 text-sm" />
          </details>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void approveAndExecute()} disabled={phase !== 'awaiting_approval' || !plannedParamsReady}
              className="origin-primary-button min-h-11 rounded-xl px-3 text-sm font-bold disabled:opacity-50">
              承認して実行
            </button>
            <button type="button" onClick={resetPlan} className="origin-secondary-button min-h-11 rounded-xl px-3 text-sm font-semibold">計画を破棄</button>
          </div>
        </section>}

        <div className="mt-4 max-h-36 overflow-auto rounded-xl border border-origin-border bg-origin-surface p-3 text-xs leading-5 text-origin-muted" aria-label="実行履歴">
          {log.length ? log.filter(Boolean).map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : '実行の経過はここに表示されます。'}
        </div>
      </aside>

      <main className="origin-workspace min-h-[28rem] overflow-hidden rounded-2xl">
        {liveSession && <div className="border-b border-origin-border">
          <AgentLivePanel
            steps={liveSession.steps}
            runView={liveRunView}
            statusHint={phase === 'completed' ? 'completed' : phase === 'failed' ? 'failed' : phase === 'held' ? 'held' : 'active'}
            catState={livePanelCatState}
          />
        </div>}
        <div className="flex items-center justify-between gap-3 border-b border-origin-border px-4 py-3">
          <div><h2 className="font-bold">作業結果</h2></div>
        </div>
        <div className="max-h-[60dvh] overflow-auto p-5">
          {researchArtifact
            ? <AgentResearchSourceCards sources={researchArtifact.sources} />
            : <FormattedMarkdown text={artifact} />}
        </div>

        <section className="border-t border-origin-border p-4">
          <h3 className="text-sm font-black">端末内に保存した結果</h3>
          {restoring ? <p className="mt-2 text-xs text-origin-muted">読み込み中…</p> : checkpoints.length === 0
            ? <p className="mt-2 text-xs text-origin-muted">確認済みの実行が完了するとここに保存されます。</p>
            : <div className="mt-2 flex flex-wrap gap-2">{checkpoints.slice().reverse().slice(0, 8).map((item) =>
              <button type="button" key={item.checkpointId} onClick={() => restoreLocalCheckpoint(item)}
                className="origin-secondary-button min-h-11 rounded-xl px-3 text-xs font-semibold">
                v{item.version} · {checkpointStatusLabel(item.status)}
              </button>)}</div>}
        </section>
      </main>
    </div>

    <div className="mx-auto mt-4 max-w-6xl">
      <AgentTaskBoard browserPlanToken={boardPlanToken} />
    </div>
  </section>;
}
