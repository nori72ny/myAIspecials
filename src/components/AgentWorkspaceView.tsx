import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadCheckpointsFromIndexedDB, saveCheckpointToIndexedDB } from '../agent/indexedDbCheckpointStore';

type AgentStep = { id: string; title: string; status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'aborted'; detail: string; dependsOn?: string[] };
type Checkpoint = { checkpointId: string; taskId: string; version: number; status: string; artifact: string; createdAt: number };

const initialSteps: AgentStep[] = [
  { id: 'goal', title: 'Goal analysis', status: 'queued', detail: '目標と成功条件を整理' },
  { id: 'plan', title: 'Task decomposition', status: 'queued', detail: '依存関係を持つサブタスクへ分解', dependsOn: ['goal'] },
  { id: 'critique', title: 'Self-critique', status: 'queued', detail: '計画の抜け・リスクを点検', dependsOn: ['plan'] },
  { id: 'execute', title: 'Execution', status: 'queued', detail: '承認後に登録済みツールだけを実行', dependsOn: ['critique'] },
];
const tools = ['document_generator', 'code_interpreter', 'image_prompt_compiler', 'web_search_grounding'] as const;

function StepSkeleton() {
  return <div className="space-y-2" aria-label="Loading checkpoints" aria-busy="true">
    {[1, 2, 3].map((item) => <div key={item} className="origin-skeleton h-14 w-full" />)}
  </div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="origin-zero-state">
    <div>
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-400">◇</div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  </div>;
}

export default function AgentWorkspaceView() {
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState<AgentStep[]>(initialSteps);
  const [log, setLog] = useState<string[]>([]);
  const [artifact, setArtifact] = useState('// Live Artifact Sandbox\n// Agent output will appear here after planning.');
  const [running, setRunning] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);
  const [selectedTool, setSelectedTool] = useState<(typeof tools)[number]>('document_generator');
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [restoring, setRestoring] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadCheckpointsFromIndexedDB()
      .then((restored) => {
        if (!mounted) return;
        setCheckpoints(restored);
        if (restored.length) setCheckpoint(restored[restored.length - 1]);
      })
      .catch(() => { if (mounted) setLog((current) => [...current, 'Checkpoint history unavailable; starting with a clean workspace.']); })
      .finally(() => { if (mounted) setRestoring(false); });
    return () => { mounted = false; abortRef.current?.abort(); };
  }, []);

  const persistCheckpoint = useCallback(async (next: Checkpoint) => {
    setCheckpoint(next);
    setCheckpoints((current) => [...current.filter((item) => item.checkpointId !== next.checkpointId), next].sort((a, b) => a.createdAt - b.createdAt));
    try { await saveCheckpointToIndexedDB(next); } catch { setLog((current) => [...current, 'Checkpoint persistence unavailable; session state remains active.']); }
  }, []);

  const runAgent = useCallback(async () => {
    const trimmed = goal.trim();
    if (!trimmed || running) return;
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setRunning(true); setLog(['Agent session started.']); setArtifact('// Planning…'); setAutoFixing(false); setSteps(initialSteps);
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: trimmed }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Agent request failed: ${response.status}`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const frames = buffer.split('\n\n'); buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim(); if (!data) continue;
          try {
            const event = JSON.parse(data) as { type?: string; step?: AgentStep; message?: string; artifact?: string };
            if (event.step) setSteps((current) => current.map((step) => step.id === event.step!.id ? event.step! : step));
            if (event.message) setLog((current) => [...current.slice(-49), event.message!]);
            if (event.artifact) setArtifact(event.artifact);
          } catch { /* fail-safe */ }
        }
      }
    } catch (error) { if ((error as Error).name !== 'AbortError') setLog((current) => [...current, 'Agent session stopped safely.']); }
    finally { setRunning(false); abortRef.current = null; }
  }, [goal, running]);

  const approve = useCallback(async () => {
    if (!goal.trim() || running) return;
    setRunning(true); setAutoFixing(false); setLog((current) => [...current, `Approve: ${selectedTool}`]);
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execute', toolName: selectedTool, taskId: `goal-${goal.trim().slice(0, 40)}`, params: selectedTool === 'code_interpreter' ? { code: artifact } : selectedTool === 'image_prompt_compiler' ? { prompt: goal.trim() } : { content: artifact } }) });
      const result = await response.json() as { ok?: boolean; artifact?: string; message?: string; checkpoint?: Checkpoint; code?: string; verification?: { attempts?: number; selfFixed?: boolean; diagnosis?: string } };
      if (result.verification?.selfFixed) {
        setAutoFixing(true);
        setLog((current) => [...current, `⚙️ Auto-Fixing Artifact… ${result.verification?.diagnosis ?? ''}`]);
      }
      if (!response.ok || !result.ok) { setLog((current) => [...current, `Execution blocked: ${result.code ?? 'policy'}`]); return; }
      if (result.artifact) setArtifact(result.artifact);
      if (result.checkpoint) await persistCheckpoint(result.checkpoint);
      setLog((current) => [...current, result.message ?? 'Execution completed.']);
      if (result.verification?.selfFixed) setLog((current) => [...current, `Self-fix completed after ${result.verification?.attempts ?? 0} repair pass(es).`]);
    } catch { setLog((current) => [...current, 'Execution failed safely; no external side effect was performed.']); }
    finally { setRunning(false); }
  }, [artifact, goal, persistCheckpoint, running, selectedTool]);

  const rollback = useCallback(async (target: Checkpoint) => {
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rollback', checkpointId: target.checkpointId }) });
      const result = await response.json() as { ok?: boolean; checkpoint?: Checkpoint };
      if (response.ok && result.ok && result.checkpoint) {
        setArtifact(result.checkpoint.artifact); await persistCheckpoint(result.checkpoint); setLog((current) => [...current, `Rolled back to ${target.checkpointId}.`]); return;
      }
    } catch { /* use local encrypted history as a safe fallback */ }
    setArtifact(target.artifact); setCheckpoint(target);
    setLog((current) => [...current, `Restored local checkpoint ${target.checkpointId}.`]);
  }, [persistCheckpoint]);

  const abort = () => { abortRef.current?.abort(); setSteps((current) => current.map((step) => step.status === 'running' || step.status === 'awaiting_approval' ? { ...step, status: 'aborted' } : step)); setLog((current) => [...current, 'Execution aborted by human.']); };

  return <section className="grid min-h-[calc(100vh-5rem)] grid-cols-1 gap-4 bg-slate-50 p-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)] md:p-5" aria-label="Agent Workspace">
    <aside className="origin-workspace flex min-h-0 flex-col gap-4 rounded-2xl p-4">
      <div><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Task Control</p><h1 className="mt-1 text-xl font-bold">Agent Workspace</h1></div>
      {autoFixing && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">⚙️ Auto-Fixing Artifact...</div>}
      <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="達成したい目標を入力…" aria-label="Agent goal" className="min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950" />
      <button type="button" disabled={!goal.trim() || running} onClick={runAgent} className="origin-primary-button min-h-11 rounded-xl px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{running ? 'Working…' : 'Start Agent'}</button>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold">DAG / Steps</p><span className="text-[11px] text-slate-500">依存関係</span></div>
        {restoring ? <StepSkeleton /> : (
          <div className="origin-dag">
            <span className="origin-dag__edge" aria-hidden="true" />
            {steps.map((step, index) => <div key={step.id} className="origin-dag__node">
              <span className="origin-dag__dot">{index + 1}</span>
              <div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate font-semibold">{step.title}</span><span className="text-[10px] font-bold uppercase text-slate-500">{step.status}</span></div><p className="mt-1 text-xs text-slate-500">{step.detail}</p></div>
              {step.dependsOn?.length ? <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500 dark:bg-slate-800">← {step.dependsOn.join(', ')}</span> : <span />}
            </div>)}
          </div>
        )}
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Checkpoints</p>
          {restoring ? <StepSkeleton /> : checkpoints.length === 0 ? <EmptyState title="まだチェックポイントはありません" description="承認したタスクを実行すると v1, v2… がここに保存されます。" /> : (
            <div className="space-y-2">{checkpoints.slice().reverse().map((item) => <div key={item.checkpointId} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700"><span className="rounded-full bg-cyan-100 px-2 py-1 text-xs font-bold text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300">v{item.version}{item.status === 'self_fixed' ? ' · Self-Fixed' : ''}</span><button type="button" onClick={() => void rollback(item)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold dark:border-slate-600">↺ Rollback</button></div>)}</div>
          )}
        </div>
      </div>
      <label className="text-xs font-bold text-slate-500">Tool Registry</label><select value={selectedTool} onChange={(e) => setSelectedTool(e.target.value as (typeof tools)[number])} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">{tools.map((tool) => <option key={tool}>{tool}</option>)}</select>
      <div className="grid grid-cols-2 gap-2"><button type="button" onClick={approve} disabled={running || !goal.trim()} className="min-h-11 rounded-xl border border-emerald-300 bg-emerald-50 font-bold text-emerald-800 disabled:opacity-50 dark:bg-emerald-950/30 dark:text-emerald-300">Approve</button><button type="button" onClick={abort} className="min-h-11 rounded-xl border border-rose-300 bg-rose-50 font-bold text-rose-800 disabled:opacity-50 dark:bg-rose-950/30 dark:text-rose-300">Abort</button></div>
      <div className="max-h-32 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-xs text-slate-300">{log.length ? log.map((line, i) => <div key={`${i}-${line}`}>{line}</div>) : 'Thinking log will appear here.'}</div>
    </aside>
    <main className="origin-workspace min-h-0 overflow-hidden rounded-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800"><div><p className="text-xs font-bold uppercase tracking-widest text-indigo-400">Live Artifact Sandbox</p><h2 className="font-bold">Preview / Working Artifact</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800">$0 · permission gated</span></div><pre className="h-[calc(100%-4.5rem)] overflow-auto whitespace-pre-wrap p-5 font-mono text-sm leading-6">{artifact}</pre></main>
  </section>;
}
