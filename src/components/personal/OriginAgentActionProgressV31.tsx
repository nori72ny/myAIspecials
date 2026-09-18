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
  cancelRequested?: boolean;
  busy?: boolean;
  onStop?: () => void;
};

const STEPS: readonly ActionStep[] = [
  { id: 'plan', label: 'Plan', detail: '対象と実行条件を確認' },
  { id: 'execute', label: 'Execute', detail: 'コードを確認・変更' },
  { id: 'test', label: 'Test', detail: '検査と必要な修復' },
  { id: 'verify', label: 'Verify', detail: '検証結果を確定' },
  { id: 'deliver', label: 'Deliver', detail: '結果と変更内容を提示' },
];

const STATUS_COPY: Record<OriginAgentJobStatusV31, string> = {
  queued: '依頼は受付済みです。workerの開始を待っています。',
  leased: 'workerが依頼を受け取り、実行準備に入りました。',
  running: 'コードの確認・変更を実行しています。',
  repairing: '検証で見つかった問題を修復しています。',
  verified: '検証済みです。取得できた結果と変更内容を提示します。',
  blocked: '安全条件または実行条件により停止しました。',
  failed: '処理が失敗して終了しました。未完了工程を成功として扱いません。',
  cancelled: '停止要求が反映され、ジョブは取消済みです。',
};

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
  if (state === 'done') return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200';
  if (state === 'current') return 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200';
  if (state === 'unknown') return 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200';
  return 'border-slate-200 bg-white/60 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400';
}

export function projectAgentActionStateV31(status: OriginAgentJobStatusV31 | null) {
  return STEPS.map(step => ({ id: step.id, state: stepState(status, step.id) }));
}

export default function OriginAgentActionProgressV31({ status, cancelRequested = false, busy = false, onStop }: OriginAgentActionProgressV31Props) {
  const active = status === 'queued' || status === 'leased' || status === 'running' || status === 'repairing';
  const stopDisabled = !active || cancelRequested || busy || !onStop;
  const statusCopy = status ? STATUS_COPY[status] : '変更依頼を開始すると、取得できたjob stateだけをAction UIへ反映します。';

  return <>
    <section className="origin-workspace rounded-2xl p-4" aria-labelledby="agent-action-progress-title" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Agent Action</p>
          <h2 id="agent-action-progress-title" className="mt-1 text-lg font-black">Plan → Execute → Test → Verify → Deliver</h2>
        </div>
        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">実行前承認あり</span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{cancelRequested && active ? '停止を要求しました。server側の停止確認を待っています。' : statusCopy}</p>

      <ol className="mt-4 grid gap-2 sm:grid-cols-5" aria-label="Agent action steps">
        {STEPS.map(step => {
          const state = stepState(status, step.id);
          return <li key={step.id} aria-current={state === 'current' ? 'step' : undefined} className={`rounded-xl border p-3 ${stateClass(state)}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-wide">{step.label}</span>
              <span className="text-[10px] font-bold">{stateLabel(state)}</span>
            </div>
            <p className="mt-2 text-[11px] leading-4 opacity-90">{step.detail}</p>
          </li>;
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800">
        <p className="m-0 max-w-3xl leading-5">進捗率・残り時間・内部思考は推測しません。表示は取得済みjob statusのUI projectionで、Git公開・デプロイの承認を意味しません。</p>
        {active && <button type="button" onClick={onStop} disabled={stopDisabled} className="hidden min-h-11 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-bold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200 md:inline-flex md:items-center">
          {cancelRequested ? '停止確認中…' : 'Stop'}
        </button>}
      </div>
    </section>

    {active && <>
      <div className="h-20 md:hidden" aria-hidden="true" />
      <div className="origin-mobile-agent-controls fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 pt-3 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:hidden" aria-label="Agent mobile controls">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-500">Agent</p>
            <p className="m-0 truncate text-sm font-semibold">{cancelRequested ? '停止確認中' : statusCopy}</p>
          </div>
          <button type="button" onClick={onStop} disabled={stopDisabled} className="min-h-11 shrink-0 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-bold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
            {cancelRequested ? '確認中…' : 'Stop'}
          </button>
        </div>
      </div>
    </>}
  </>;
}
