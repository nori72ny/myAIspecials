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
  { id: 'plan', label: '計画', detail: '何を作る・直すか確認' },
  { id: 'execute', label: '作成・変更', detail: 'コードを作成・変更' },
  { id: 'test', label: '確認', detail: '確認と、必要な修正' },
  { id: 'verify', label: '最終確認', detail: '結果をまとめる' },
  { id: 'deliver', label: '結果表示', detail: '結果と変更内容を表示' },
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
  if (state === 'done') return 'text-origin-success';
  if (state === 'current') return 'text-origin-brand';
  if (state === 'unknown') return 'text-origin-warning';
  return 'text-origin-placeholder';
}

export function projectAgentActionStateV31(status: OriginAgentJobStatusV31 | null) {
  return STEPS.map(step => ({ id: step.id, state: stepState(status, step.id) }));
}

export default function OriginAgentActionProgressV31({ status }: OriginAgentActionProgressV31Props) {
  if (!status) return null;

  return <details className="rounded-2xl border border-origin-border bg-origin-surface/70 px-4">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">進み具合</summary>
    <ol className="grid gap-2 pb-3 sm:grid-cols-5" aria-label="Agent action steps">
      {STEPS.map(step => {
        const state = stepState(status, step.id);
        return <li key={step.id} aria-current={state === 'current' ? 'step' : undefined} className="rounded-xl border border-origin-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-black uppercase tracking-wide">{step.label}</span>
            <span className={`text-[13px] font-bold ${stateClass(state)}`}>{stateLabel(state)}</span>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-origin-muted">{step.detail}</p>
        </li>;
      })}
    </ol>
    <p className="pb-4 text-[13px] leading-5 text-origin-muted">分かった状態だけを表示します。進み具合や残り時間は推測しません。</p>
  </details>;
}
