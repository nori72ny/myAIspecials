import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadCheckpointsFromIndexedDB, saveCheckpointToIndexedDB } from '../agent/indexedDbCheckpointStore';
import type { CheckpointState } from '../agent/checkpointManager';

type AgentCapability = {
  ready: boolean;
  approvalSigningConfigured: boolean;
  replayProtectionConfigured: boolean;
  replayProtection: string;
  freeOnly: boolean;
  costUsd: number;
  paidFallbackEnabled: boolean;
};

type AgentPlanStep = { id: string; title: string };
type AgentPlan = {
  runId: string;
  planToken: string;
  expiresAt: string;
  plan: AgentPlanStep[];
};

type AgentExecutionResponse = {
  ok?: boolean;
  code?: string;
  status?: string;
  artifact?: string;
  checkpoint?: CheckpointState;
};

const tools = [
  'document_generator',
  'code_interpreter',
  'image_prompt_compiler',
  'web_search_grounding',
] as const;
type AgentTool = (typeof tools)[number];
type Phase = 'idle' | 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed';

function authorizationHeaders(credential: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` };
}

function paramsFor(tool: AgentTool, goal: string, artifact: string): Record<string, unknown> {
  if (tool === 'code_interpreter') return { code: artifact || goal };
  if (tool === 'image_prompt_compiler') return { prompt: goal };
  if (tool === 'web_search_grounding') return { query: goal };
  return { content: artifact && !artifact.startsWith('//') ? artifact : goal };
}

function phaseLabel(phase: Phase): string {
  if (phase === 'planning') return '計画を準備中';
  if (phase === 'awaiting_approval') return '承認待ち';
  if (phase === 'executing') return '実行・検証中';
  if (phase === 'completed') return '完了';
  if (phase === 'failed') return '安全に停止';
  return '待機中';
}

export default function AgentWorkspaceView() {
  const [goal, setGoal] = useState('');
  const [capability, setCapability] = useState<AgentCapability | null>(null);
  const [checkingCapability, setCheckingCapability] = useState(true);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [artifact, setArtifact] = useState('// Agent v3 の検証済み出力がここに表示されます。');
  const [selectedTool, setSelectedTool] = useState<AgentTool>('document_generator');
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
          replayProtection: typeof data.replayProtection === 'string' ? data.replayProtection : 'unavailable',
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
      .catch(() => { if (mounted) setLog((current) => [...current, '端末内のAgent履歴を読み込めませんでした。']); })
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
    catch { setLog((current) => [...current, 'チェックポイントはこのセッションでは利用できますが、端末保存を確認できませんでした。']); }
  }, []);

  const requestPlan = useCallback(async () => {
    const trimmed = goal.trim();
    if (!trimmed || phase === 'planning' || phase === 'executing' || capability?.ready !== true) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPlan(null);
    setPhase('planning');
    setLog(['Agent v3: 実行計画を準備しています。']);
    setArtifact('// Plan preparing…');
    try {
      const response = await fetch('/api/agent/v3/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ goal: trimmed }),
        signal: controller.signal,
      });
      const data = await response.json() as Partial<AgentPlan> & { ok?: boolean; code?: string };
      if (!response.ok || data.ok !== true || typeof data.runId !== 'string' || typeof data.planToken !== 'string' || !Array.isArray(data.plan)) {
        throw new Error(data.code ?? 'AGENT_PLAN_FAILED');
      }
      const next: AgentPlan = {
        runId: data.runId,
        planToken: data.planToken,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
        plan: data.plan.filter((step): step is AgentPlanStep => Boolean(step) && typeof step.id === 'string' && typeof step.title === 'string').slice(0, 12),
      };
      setPlan(next);
      setPhase('awaiting_approval');
      setArtifact([
        '# Agent v3 実行計画',
        '',
        `Goal: ${trimmed}`,
        '',
        ...next.plan.map((step, index) => `${index + 1}. ${step.title}`),
        '',
        '実行には、選択した1つの登録済みツールに限定した認証付き承認が必要です。',
        '承認トークンはそのrun・tool・paramsだけに有効で、再利用はできません。',
      ].join('\n'));
      setLog((current) => [...current, '計画を作成しました。まだツールは実行していません。']);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPhase('failed');
        setLog((current) => [...current, `計画を作成できませんでした: ${(error as Error).message}`]);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [capability?.ready, goal, phase]);

  const approveAndExecute = useCallback(async () => {
    if (!plan || phase !== 'awaiting_approval') return;
    const credential = credentialInputRef.current?.value.trim() ?? '';
    if (!credential) {
      setLog((current) => [...current, '実行にはAgent認証キーが必要です。キーは端末へ保存しません。']);
      credentialInputRef.current?.focus();
      return;
    }
    if (plan.expiresAt && Date.parse(plan.expiresAt) <= Date.now()) {
      setPlan(null);
      setPhase('failed');
      setLog((current) => [...current, '計画の承認期限が切れました。新しい計画を作成してください。']);
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      return;
    }

    const toolParams = paramsFor(selectedTool, goal.trim(), artifact);
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('executing');
    setLog((current) => [...current, `承認対象: ${selectedTool}`, 'exact-operation approvalを取得しています。']);
    try {
      const approvalResponse = await fetch('/api/agent/v3/approval', {
        method: 'POST',
        headers: authorizationHeaders(credential),
        cache: 'no-store',
        body: JSON.stringify({
          runId: plan.runId,
          planToken: plan.planToken,
          toolName: selectedTool,
          params: toolParams,
        }),
        signal: controller.signal,
      });
      const approval = await approvalResponse.json() as { ok?: boolean; approvalToken?: string; code?: string };
      if (!approvalResponse.ok || approval.ok !== true || typeof approval.approvalToken !== 'string') {
        throw new Error(approval.code ?? 'AGENT_APPROVAL_FAILED');
      }

      const executeResponse = await fetch('/api/agent/v3/execute', {
        method: 'POST',
        headers: authorizationHeaders(credential),
        cache: 'no-store',
        body: JSON.stringify({
          runId: plan.runId,
          toolName: selectedTool,
          params: toolParams,
          approvalToken: approval.approvalToken,
        }),
        signal: controller.signal,
      });
      const result = await executeResponse.json() as AgentExecutionResponse;
      if (!executeResponse.ok || result.ok !== true || result.status !== 'completed' || typeof result.artifact !== 'string') {
        throw new Error(result.code ?? 'AGENT_EXECUTION_FAILED');
      }
      setArtifact(result.artifact);
      if (result.checkpoint) await persistCheckpoint(result.checkpoint);
      setPhase('completed');
      setLog((current) => [...current, '登録済みツールの実行と検証が完了しました。', result.checkpoint ? `Checkpoint: ${result.checkpoint.checkpointId}` : '']);
      setPlan(null);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPhase('failed');
        setLog((current) => [...current, `実行は完了扱いにしていません: ${(error as Error).message}`]);
      }
    } finally {
      if (credentialInputRef.current) credentialInputRef.current.value = '';
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [artifact, goal, persistCheckpoint, phase, plan, selectedTool]);

  const resetPlan = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPlan(null);
    setPhase('idle');
    setLog((current) => [...current, '計画をリセットしました。未承認の操作は実行していません。']);
    if (credentialInputRef.current) credentialInputRef.current.value = '';
  };

  const restoreLocalCheckpoint = (checkpoint: CheckpointState) => {
    setArtifact(checkpoint.artifact);
    setLog((current) => [...current, `端末内のチェックポイント ${checkpoint.checkpointId} を表示しました。サーバー側の変更を巻き戻したとは主張しません。`]);
  };

  const ready = capability?.ready === true
    && capability.freeOnly === true
    && capability.costUsd === 0
    && capability.paidFallbackEnabled === false;

  return <section className="min-h-full bg-slate-50 p-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:p-5" aria-label="Agent Workspace">
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.35fr)]">
      <aside className="origin-workspace rounded-2xl p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-500">Agent v3</p>
        <h1 className="mt-1 text-xl font-black">エージェントに任せる</h1>
        <p className="mt-1 text-sm leading-6 text-slate-500">計画を確認してから、承認した1つの登録済みツールだけを実行・検証します。</p>

        <label htmlFor="agent-goal" className="mt-4 block text-sm font-bold">達成したいこと</label>
        <textarea id="agent-goal" value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={4000}
          placeholder="例: この要件を整理して、実行可能な文書案を作ってください。"
          className="mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950" />

        <div role="status" className="mt-3 flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-500">{checkingCapability ? 'Agent基盤を確認中…' : ready ? 'Agent v3 基盤を確認済み' : 'Agent v3 は現在利用できません'}</span>
          <span className={ready ? 'font-bold text-emerald-700 dark:text-emerald-300' : 'font-bold text-amber-700 dark:text-amber-300'}>
            {checkingCapability ? '確認中' : ready ? phaseLabel(phase) : 'Fail-closed'}
          </span>
        </div>

        <button type="button" onClick={() => void requestPlan()} disabled={!ready || !goal.trim() || phase === 'planning' || phase === 'executing'}
          className="origin-primary-button mt-3 min-h-11 w-full rounded-xl px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {phase === 'planning' ? '計画中…' : '実行計画を作る'}
        </button>

        {plan && <section className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800" aria-label="Agent plan">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black">実行フロー</h2>
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">未実行 · 承認待ち</span>
          </div>
          <ol className="mt-2 space-y-2 pl-5 text-sm">{plan.plan.map((step) => <li key={step.id}>{step.title}</li>)}</ol>

          <label htmlFor="agent-tool" className="mt-4 block text-xs font-bold text-slate-500">今回承認するツール</label>
          <select id="agent-tool" value={selectedTool} onChange={(event) => setSelectedTool(event.target.value as AgentTool)}
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950">
            {tools.map((tool) => <option key={tool} value={tool}>{tool}</option>)}
          </select>

          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold">実行に必要な認証</summary>
            <p className="mb-2 text-xs leading-5 text-slate-500">Agent実行時だけ使用します。ブラウザ保存・localStorage保存はしません。</p>
            <input ref={credentialInputRef} id="agent-operator-key" aria-label="Agent認証キー" type="password" autoComplete="off" spellCheck={false}
              placeholder="Agent operator key"
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
          </details>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void approveAndExecute()} disabled={phase !== 'awaiting_approval'}
              className="min-h-11 rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-sm font-bold text-emerald-900 disabled:opacity-50 dark:bg-emerald-950/30 dark:text-emerald-200">
              承認して実行
            </button>
            <button type="button" onClick={resetPlan} className="origin-secondary-button min-h-11 rounded-xl px-3 text-sm font-semibold">計画を破棄</button>
          </div>
        </section>}

        <details className="mt-4 border-t border-slate-200 pt-2 text-xs dark:border-slate-800">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold">安全境界</summary>
          <p className="leading-5 text-slate-500">署名済み計画、exact-operation承認、共有リプレイ防止、$0・有料fallback禁止を満たさない実行は停止します。画面に「完了」と出すのは検証済み成果だけです。</p>
          {capability && <div className="mt-2 space-y-1 text-slate-500">
            <p>Approval signing: {capability.approvalSigningConfigured ? 'ready' : 'unavailable'}</p>
            <p>Replay protection: {capability.replayProtectionConfigured ? capability.replayProtection : 'unavailable'}</p>
          </div>}
        </details>

        <div className="mt-4 max-h-36 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-xs text-slate-300" aria-label="Agent log">
          {log.length ? log.filter(Boolean).map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : '実行ログはここに表示されます。'}
        </div>
      </aside>

      <main className="origin-workspace min-h-[28rem] overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div><p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Verified output</p><h2 className="font-bold">作業結果</h2></div>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs dark:border-slate-700">$0 · permission gated</span>
        </div>
        <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap p-5 font-mono text-sm leading-6">{artifact}</pre>

        <section className="border-t border-slate-200 p-4 dark:border-slate-800">
          <h3 className="text-sm font-black">端末内チェックポイント</h3>
          {restoring ? <p className="mt-2 text-xs text-slate-500">読み込み中…</p> : checkpoints.length === 0
            ? <p className="mt-2 text-xs text-slate-500">検証済み実行が完了するとここに保存されます。</p>
            : <div className="mt-2 flex flex-wrap gap-2">{checkpoints.slice().reverse().slice(0, 8).map((item) =>
              <button type="button" key={item.checkpointId} onClick={() => restoreLocalCheckpoint(item)}
                className="origin-secondary-button min-h-11 rounded-xl px-3 text-xs font-semibold">
                v{item.version} · {item.status}
              </button>)}</div>}
        </section>
      </main>
    </div>
  </section>;
}
