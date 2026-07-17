import type { AIRoutingDecision } from "../lib/orchestration/MultiAIOrchestrator";
import {
  providerDisplayName,
  selectionReason,
  taskDisplayName,
  verificationDescription,
} from "../lib/orchestration/DelegationPresentation";

interface DelegationDecisionSummaryProps {
  decision: AIRoutingDecision;
}

export default function DelegationDecisionSummary({ decision }: DelegationDecisionSummaryProps) {
  return (
    <div className="space-y-4" data-testid="delegation-decision-summary">
      <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-400/20 dark:bg-indigo-400/10">
        <div className="text-xs font-semibold tracking-wide text-indigo-700 dark:text-indigo-300">
          おすすめの担当
        </div>
        <div
          data-testid="selected-provider-label"
          className="mt-1 text-xl font-bold text-slate-900 dark:text-white"
        >
          {providerDisplayName(decision.selectedProvider)}
        </div>
        <p
          data-testid="selection-reason"
          className="mt-2 text-sm leading-6 text-slate-700 dark:text-neutral-200"
        >
          {selectionReason(decision)}
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
          <div className="text-xs font-semibold text-slate-600 dark:text-neutral-400">
            依頼の種類
          </div>
          <div
            data-testid="task-label"
            className="mt-1 text-sm font-semibold text-slate-800 dark:text-white"
          >
            {taskDisplayName(decision.taskType)}
          </div>
        </section>

        <section className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
          <div className="text-xs font-semibold text-slate-600 dark:text-neutral-400">
            結果の確認方法
          </div>
          <div
            data-testid="verification-provider"
            className="mt-1 text-sm font-semibold text-slate-800 dark:text-white"
          >
            {providerDisplayName(decision.verificationProvider)}
          </div>
          <p
            data-testid="verification-description"
            className="mt-1 text-xs leading-5 text-slate-600 dark:text-neutral-300"
          >
            {verificationDescription(decision.verificationProvider)}
          </p>
        </section>
      </div>
    </div>
  );
}
