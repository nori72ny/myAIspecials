import React from 'react';

export type OriginAgentJobStatusV31 =
  | 'queued'
  | 'leased'
  | 'running'
  | 'repairing'
  | 'verified'
  | 'blocked'
  | 'failed'
  | 'cancelled';

type ActionStepId = 'plan' | 'execute' | 'test' | 'verify' | 'deliver';
type StepState = 'done' | 'current' | 'pending' | 'unknown';

type ActionStep = {
  id: ActionStepId;
  label: string;
  detail: string;
};

type OriginAgentActionProgressV31Props = {
  status: OriginAgentJobStatusV31 | null;
};

const STEPS: readonly ActionStep[] = [
  { id: 'plan', label: 'Plan', detail: '対象と実行条件を確認' },
  { id: 'execute', label: 'Execute', detail: 'コードを確認・変更' },
  { id: 'test', label: 'Test', detail: '検査と必要な修復' },
  { id: 'verify', label: 'Verify', detail: '検証結果を確定' },
  { id: 'deliver', label: 'Deliver', detail: '結果と変更内容を提示' },
];

function currentStep(status: OriginAgentJobStatusV31 | null): ActionStepId | null {
  if (status === 'queued' || status === 'leased') return 'plan';
  if (status === 'running') return 'execute';
  if (status === 'repairing') return 'test';
  if (status === 'verified') return 'deliver';
  return null;
}

function stepState(status: OriginAgentJobStatusV31 | null, step: ActionStepId): StepState {
  if (!status) return 'pending';
  if (status === 'blocked' || status === 'failed' || status === 'cancelled') return 'unknown';
  const current = currentStep(status);
  if (status === 'verified') return 'done';
  const order = STEPS.map(item => item.id);
  const currentIndex = current ? order.indexOf(current) : -1;
  const stepIndex = order.indexOf(step);
  if (stepIndex < currentIndex) return 'done';
  if (stepIndex === currentIndex) return 'current';
  return 'pending';
}

function stateLabel(state: StepState): string {
  if (state === 'done') return '完了';
  if (state === 'current') return '進行中';
  if (state === 'unknown') return '未確定';
  return '待機';
}

function stateClass(state: StepState): string {
  if (state === 'done') return 'text-emerald-700 dark:text-emerald-300';
  if (state === 'current') return 'text-indigo-700 dark:text-indigo-300';
  if (state === 'unknown') return 'text-amber-700 dark:text-amber-300';
  return 'text-slate-400';
}

export function projectAgentActionStateV31(status: OriginAgentJobStatusV31 | null) {
  return STEPS.map(step => ({ id: step.id, state: stepState(status, step.id) }));
}

export default function OriginAgentActionProgressV31({ status }: OriginAgentActionProgressV31Props) {
  if (!status) return null;

  return <details className="rounded-2xl border border-slate-200 bg-white/70 px-4 dark:border-slate-800 dark:bg-slate-900/50">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">実行詳細</summary>
    <ol className="grid gap-2 pb-3 sm:grid-cols-5" aria-label="Agent action steps">
      {STEPS.map(step => {
        const state = stepState(status, step.id);
        return <li key={step.id} aria-current={state === 'current' ? 'step' : undefined} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wide">{step.label}</span>
            <span className={`text-[10px] font-bold ${stateClass(state)}`}>{stateLabel(state)}</span>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">{step.detail}</p>
        </li>;
      })}
    </ol>
    <p className="pb-4 text-[11px] leading-5 text-slate-500">進捗率・残り時間・内部思考は推測しません。取得済みの実行状態だけを表示します。</p>
  </details>;
}
