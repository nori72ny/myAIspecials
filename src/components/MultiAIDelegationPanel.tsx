import { useMemo, useState } from "react";
import { Bot, Check, Clipboard, ShieldAlert, Sparkles, X } from "lucide-react";
import {
  createDelegationInstruction,
  DEFAULT_AI_CAPABILITIES,
  routeTask,
  type AICapabilityProfile,
  type AIRoutingDecision,
} from "../lib/orchestration/MultiAIOrchestrator";

const SECRET_HINTS = ["api key", "apiキー", "secret", "token", "password", "認証情報"];

const HUMAN_APPROVAL_GATE: AICapabilityProfile = {
  id: "human-approval-gate",
  displayName: "Human Approval Gate",
  capabilities: ["operations"],
  available: true,
  freeOnly: true,
  preferredFor: ["operations"],
  limitations: [
    "Does not execute operations",
    "Requires explicit owner approval",
  ],
};

const PLANNER_PROFILES: readonly AICapabilityProfile[] = [
  ...DEFAULT_AI_CAPABILITIES,
  HUMAN_APPROVAL_GATE,
];

export default function MultiAIDelegationPanel() {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [decision, setDecision] = useState<AIRoutingDecision | null>(null);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const containsSecrets = useMemo(() => {
    const normalized = goal.toLowerCase();
    return SECRET_HINTS.some((keyword) => normalized.includes(keyword));
  }, [goal]);

  const plan = () => {
    setError("");
    setCopied(false);
    const trimmed = goal.trim();
    if (!trimmed) {
      setDecision(null);
      setInstruction("");
      setError("依頼内容を入力してください。");
      return;
    }

    try {
      const request = {
        goal: trimmed,
        requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(trimmed),
        requiresFreshResearch: /最新|調査|料金|current|research/i.test(trimmed),
        containsSecrets,
      };
      const nextDecision = routeTask(request, PLANNER_PROFILES);
      setDecision(nextDecision);
      setInstruction(createDelegationInstruction(request, nextDecision));
    } catch (planningError) {
      setDecision(null);
      setInstruction("");
      setError(planningError instanceof Error ? planningError.message : "振り分けに失敗しました。");
    }
  };

  const copyInstruction = async () => {
    if (!instruction) return;
    await navigator.clipboard.writeText(instruction);
    setCopied(true);
  };

  return (
    <>
      <button
        type="button"
        data-testid="multi-ai-planner-open"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[80] flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-indigo-500"
        aria-label="AI作業振り分けを開く"
      >
        <Sparkles className="h-4 w-4" />
        AI作業振り分け
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-end bg-black/40 p-4 sm:items-center sm:p-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="AI作業振り分け"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-neutral-950"
          >
            <header className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
                  <Bot className="h-5 w-5 text-indigo-500" />
                  AI作業振り分け
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
                  外部AIを呼ばず、依頼に適した担当と検証方法をローカルで判定します。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <label className="block text-xs font-semibold text-slate-700 dark:text-neutral-300">
              依頼内容
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="例: 認証処理のセキュリティレビューをしてください"
                className="mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-neutral-900 dark:text-white"
              />
            </label>

            <button
              type="button"
              onClick={plan}
              className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-black"
            >
              担当AIと検証方法を判定
            </button>

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

            {decision && (
              <div className="mt-5 space-y-3">
                <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">担当AI</div>
                  <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                    {decision.selectedProviderName}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
                    {decision.reason}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <div className="text-[11px] font-semibold text-slate-400">タスク分類</div>
                    <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-white">{decision.taskType}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <div className="text-[11px] font-semibold text-slate-400">検証担当</div>
                    <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-white">
                      {decision.verificationProvider ?? "決定論的テストのみ"}
                    </div>
                  </div>
                </div>

                {decision.requiresHumanApproval && (
                  <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <div className="text-sm font-bold">人の明示承認が必要です</div>
                      <p className="mt-1 text-xs leading-relaxed">
                        マージ、デプロイ、DNS、秘密情報、課金、本番、アカウント操作は自動実行しません。
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-600 dark:text-neutral-300">コピー用の委譲指示</div>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                    {instruction}
                  </pre>
                  <button
                    type="button"
                    onClick={copyInstruction}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-white dark:hover:bg-white/5"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                    {copied ? "コピーしました" : "指示をコピー"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
