import React, { useCallback, useEffect, useRef, useState } from 'react';

type AgentStep = { id: string; title: string; status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'aborted'; detail: string };

const initialSteps: AgentStep[] = [
  { id: 'goal', title: 'Goal analysis', status: 'queued', detail: '目標と成功条件を整理' },
  { id: 'plan', title: 'Task decomposition', status: 'queued', detail: '依存関係を持つサブタスクへ分解' },
  { id: 'critique', title: 'Self-critique', status: 'queued', detail: '計画の抜け・リスクを点検' },
  { id: 'execute', title: 'Execution', status: 'queued', detail: '承認後に実行可能なステップを進行' },
];

export default function AgentWorkspaceView() {
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState<AgentStep[]>(initialSteps);
  const [log, setLog] = useState<string[]>([]);
  const [artifact, setArtifact] = useState('// Live Artifact Sandbox\n// Agent output will appear here after planning.');
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runAgent = useCallback(async () => {
    const trimmed = goal.trim();
    if (!trimmed || running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setLog(['Agent session started.']);
    setArtifact('// Planning…');
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: trimmed }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Agent request failed: ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
          if (!data) continue;
          try {
            const event = JSON.parse(data) as { type?: string; step?: AgentStep; message?: string; artifact?: string };
            if (event.step) setSteps((current) => current.map((step) => step.id === event.step!.id ? event.step! : step));
            if (event.message) setLog((current) => [...current.slice(-49), event.message!]);
            if (event.artifact) setArtifact(event.artifact);
          } catch { /* malformed event is ignored by the UI fail-safe */ }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setLog((current) => [...current, 'Agent session stopped safely.']);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [goal, running]);

  const approve = () => setLog((current) => [...current, 'Human approval recorded. Execution remains sandboxed and policy-gated.']);
  const abort = () => { abortRef.current?.abort(); setSteps((current) => current.map((step) => step.status === 'running' || step.status === 'awaiting_approval' ? { ...step, status: 'aborted' } : step)); setLog((current) => [...current, 'Execution aborted by human.']); };

  return (
    <section className="grid min-h-[calc(100vh-5rem)] grid-cols-1 gap-4 bg-slate-50 p-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)] md:p-5" aria-label="Agent Workspace">
      <aside className="flex min-h-0 flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Task Control</p><h1 className="mt-1 text-xl font-bold">Agent Workspace</h1></div>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="達成したい目標を入力…" aria-label="Agent goal" className="min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-3 outline-none focus:ring-2 focus:ring-cyan-500 dark:border-slate-700 dark:bg-slate-950" />
        <button type="button" disabled={!goal.trim() || running} onClick={runAgent} className="min-h-11 rounded-xl bg-slate-950 px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950">{running ? 'Planning / Running…' : 'Start Agent'}</button>
        <div className="min-h-0 flex-1 overflow-auto"><p className="mb-2 text-sm font-bold">DAG / Steps</p><ol className="space-y-2">{steps.map((step) => <li key={step.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{step.title}</span><span className="text-xs font-bold uppercase text-slate-500">{step.status}</span></div><p className="mt-1 text-xs text-slate-500">{step.detail}</p></li>)}</ol></div>
        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={approve} className="min-h-11 rounded-xl border border-emerald-300 bg-emerald-50 font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">Approve</button><button type="button" onClick={abort} className="min-h-11 rounded-xl border border-rose-300 bg-rose-50 font-bold text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">Abort</button></div>
        <div className="max-h-32 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-xs text-slate-300">{log.length ? log.map((line, i) => <div key={`${i}-${line}`}>{line}</div>) : 'Thinking log will appear here.'}</div>
      </aside>
      <main className="min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800"><div><p className="text-xs font-bold uppercase tracking-widest text-cyan-600">Live Artifact Sandbox</p><h2 className="font-bold">Preview / Working Artifact</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800">$0 · local UI</span></div><pre className="h-[calc(100%-4.5rem)] overflow-auto whitespace-pre-wrap p-5 font-mono text-sm leading-6">{artifact}</pre></main>
    </section>
  );
}
