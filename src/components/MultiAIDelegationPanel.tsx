import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Clipboard, History, Save, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import {
  createDelegationInstruction,
  DEFAULT_AI_CAPABILITIES,
  routeTask,
  type AICapabilityProfile,
  type AIRoutingDecision,
  type AITaskType,
} from "../lib/orchestration/MultiAIOrchestrator";
import {
  appendDelegationAudit,
  clearDelegationAudit,
  createDelegationAuditRecord,
  readDelegationAudit,
  updateDelegationAuditRecord,
  type AuditStorage,
  type AuditStorageFailureReason,
  type DelegationAuditRecord,
  type DelegationResultStatus,
  type DelegationVerificationStatus,
} from "../lib/orchestration/DelegationAuditStore";
import { containsSensitiveInput } from "../lib/orchestration/SensitiveInputDetector";

const HUMAN_APPROVAL_GATE: AICapabilityProfile = {
  id: "human-approval-gate",
  displayName: "Human Approval Gate",
  capabilities: ["operations"],
  available: true,
  freeOnly: true,
  preferredFor: ["operations"],
  limitations: ["Does not execute operations", "Requires explicit owner approval"],
};

const PLANNER_PROFILES: readonly AICapabilityProfile[] = [
  ...DEFAULT_AI_CAPABILITIES,
  HUMAN_APPROVAL_GATE,
];

const TASK_LABELS: Record<AITaskType, string> = {
  implementation: "実装",
  review: "レビュー",
  security: "セキュリティ",
  ux: "UX・画面設計",
  research: "調査",
  test: "テスト",
  documentation: "ドキュメント",
  operations: "運用操作",
  architecture: "アーキテクチャ",
  "current-information": "最新情報の確認",
};

const RESULT_LABELS: Record<DelegationResultStatus, string> = {
  pending: "未完了",
  success: "成功",
  "changes-required": "要修正",
  failed: "失敗",
};

const VERIFICATION_LABELS: Record<DelegationVerificationStatus, string> = {
  "not-required": "検証不要",
  pending: "検証待ち",
  passed: "検証合格",
  failed: "検証失敗",
};

function providerDisplayName(providerId?: string): string {
  if (!providerId) return "決定論的テストのみ";
  return PLANNER_PROFILES.find((profile) => profile.id === providerId)?.displayName ?? "未登録の検証担当";
}

function humanReadableReason(decision: AIRoutingDecision): string {
  if (decision.taskType === "implementation" && decision.selectedProvider === "ai-studio-primary") {
    return "実装タスクの第一候補で、無料枠が利用可能なため選択しました。";
  }
  if (/fallback/i.test(decision.reason)) {
    return "第一候補が利用できないため、無料枠内で信頼性と応答速度を比較し、この担当を選択しました。";
  }
  if (decision.selectedProvider === "human-approval-gate") {
    return "権限を伴う操作のため、自動実行せず人の明示承認を受ける担当へ切り替えました。";
  }
  return "この依頼に適した専門性があり、無料枠・信頼性・応答速度の条件を満たすため選択しました。";
}

function storageFailureMessage(reason: AuditStorageFailureReason | "unavailable"): string {
  if (reason === "quota-exceeded") {
    return "ブラウザーの保存容量が不足しているため、監査履歴を保存できませんでした。";
  }
  return "この環境では監査履歴を保存できません。ブラウザー設定、プライベートモード、またはiframe制限を確認してください。";
}

type BrowserAuditStorageResult =
  | { ok: true; storage: AuditStorage; reason?: never }
  | { ok: false; reason: "unavailable"; storage?: never };

function getBrowserAuditStorage(): BrowserAuditStorageResult {
  try {
    return { ok: true, storage: window.localStorage };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export default function MultiAIDelegationPanel() {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [decision, setDecision] = useState<AIRoutingDecision | null>(null);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [history, setHistory] = useState<DelegationAuditRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resultStatus, setResultStatus] = useState<DelegationResultStatus>("success");
  const [verificationStatus, setVerificationStatus] = useState<DelegationVerificationStatus>("passed");
  const [elapsedSeconds, setElapsedSeconds] = useState("");
  const goalRef = useRef<HTMLTextAreaElement>(null);

  const containsSecrets = useMemo(() => containsSensitiveInput(goal), [goal]);

  useEffect(() => {
    if (!open) return;
    goalRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const openPanel = () => {
    setOpen(true);
    setStorageWarning("");
    const storage = getBrowserAuditStorage();
    if (storage.ok === false) {
      setHistory([]);
      setStorageWarning(storageFailureMessage(storage.reason));
      return;
    }
    const result = readDelegationAudit(storage.storage);
    setHistory(result.value);
    if (result.ok === false) setStorageWarning(storageFailureMessage(result.reason));
  };

  const plan = () => {
    setError("");
    setCopied(false);
    setCopyAnnouncement("");
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
      const safeRequest = containsSecrets ? { ...request, goal: "[REDACTED]" } : request;
      const record = createDelegationAuditRecord(safeRequest, nextDecision);
      setDecision(nextDecision);
      setInstruction(createDelegationInstruction(safeRequest, nextDecision));

      const storage = getBrowserAuditStorage();
      if (storage.ok === false) {
        setStorageWarning(storageFailureMessage(storage.reason));
        return;
      }
      const result = appendDelegationAudit(storage.storage, record);
      if (result.ok) {
        setHistory(result.value);
        setStorageWarning("");
      } else {
        setStorageWarning(storageFailureMessage(result.reason));
      }
    } catch (planningError) {
      setDecision(null);
      setInstruction("");
      setError(planningError instanceof Error ? planningError.message : "振り分けに失敗しました。");
    }
  };

  const copyInstruction = async () => {
    if (!instruction) return;
    setError("");
    setCopyAnnouncement("");
    try {
      await navigator.clipboard.writeText(instruction);
      setCopied(true);
      setCopyAnnouncement("委譲指示をコピーしました。");
    } catch {
      setCopied(false);
      setCopyAnnouncement("クリップボードへのコピーに失敗しました。");
      setError("クリップボードへのコピーに失敗しました。指示を選択して手動でコピーしてください。");
    }
  };

  const clearHistory = () => {
    const storage = getBrowserAuditStorage();
    if (storage.ok === false) {
      setStorageWarning(storageFailureMessage(storage.reason));
      return;
    }
    const result = clearDelegationAudit(storage.storage);
    if (result.ok === false) {
      setStorageWarning(storageFailureMessage(result.reason));
      return;
    }
    setHistory([]);
    setEditingId(null);
    setStorageWarning("");
  };

  const beginResultEntry = (record: DelegationAuditRecord) => {
    setEditingId(record.id);
    setResultStatus(record.resultStatus === "pending" ? "success" : record.resultStatus);
    setVerificationStatus(record.verificationStatus === "not-required" ? "not-required" : "passed");
    setElapsedSeconds(record.elapsedSeconds?.toString() ?? "");
    setError("");
  };

  const saveResult = () => {
    if (!editingId || !/^\d+$/.test(elapsedSeconds)) {
      setError("所要時間は0以上の整数秒で入力してください。");
      return;
    }
    const storage = getBrowserAuditStorage();
    if (storage.ok === false) {
      setStorageWarning(storageFailureMessage(storage.reason));
      return;
    }
    const result = updateDelegationAuditRecord(storage.storage, editingId, {
      resultStatus,
      verificationStatus,
      elapsedSeconds: Number(elapsedSeconds),
    });
    if (result.ok === false) {
      setStorageWarning(storageFailureMessage(result.reason));
      return;
    }
    setHistory(result.value);
    setEditingId(null);
    setError("");
    setStorageWarning("");
  };

  return (
    <>
      <button
        type="button"
        data-testid="multi-ai-planner-open"
        onClick={openPanel}
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
                <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-neutral-300">
                  外部AIを呼ばず、依頼に適した担当と検証方法をこの端末内で判定します。
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="閉じる" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-neutral-300 dark:hover:bg-white/10">
                <X className="h-4 w-4" />
              </button>
            </header>

            <label className="block text-sm font-semibold text-slate-700 dark:text-neutral-300">
              依頼内容
              <textarea
                ref={goalRef}
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="例: 認証処理のセキュリティレビューをしてください"
                className="mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-white/10 dark:bg-neutral-900 dark:text-white"
              />
            </label>

            {containsSecrets && (
              <div data-testid="secret-redaction-warning" className="mt-3 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm leading-relaxed">秘密情報を検出したため、依頼本文を委譲指示と監査履歴から除外します。</p>
              </div>
            )}

            <button type="button" onClick={plan} className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-white dark:text-black">
              担当AIと検証方法を判定
            </button>

            {storageWarning && <p role="status" data-testid="audit-storage-warning" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">{storageWarning}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {copyAnnouncement && <p role={copied ? "status" : "alert"} aria-live={copied ? "polite" : "assertive"} className="sr-only">{copyAnnouncement}</p>}

            {decision && (
              <div className="mt-5 space-y-3">
                <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                  <div className="text-xs font-semibold tracking-wide text-slate-600 dark:text-neutral-400">担当AI</div>
                  <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{decision.selectedProviderName}</div>
                  <p data-testid="selection-reason" className="mt-2 text-sm leading-6 text-slate-600 dark:text-neutral-300">{humanReadableReason(decision)}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <div className="text-xs font-semibold text-slate-600 dark:text-neutral-400">タスク分類</div>
                    <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-white">{TASK_LABELS[decision.taskType]}</div>
                    <div className="mt-0.5 text-xs text-slate-600 dark:text-neutral-300">{decision.taskType}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <div className="text-xs font-semibold text-slate-600 dark:text-neutral-400">検証担当</div>
                    <div data-testid="verification-provider" className="mt-1 text-sm font-semibold text-slate-800 dark:text-white">{providerDisplayName(decision.verificationProvider)}</div>
                  </div>
                </div>

                {decision.requiresHumanApproval && (
                  <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <div className="text-sm font-bold">人の明示承認が必要です</div>
                      <p className="mt-1 text-sm leading-relaxed">マージ、デプロイ、DNS、秘密情報、課金、本番、アカウント操作は自動実行しません。</p>
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-2 text-sm font-semibold text-slate-600 dark:text-neutral-300">コピー用の委譲指示</div>
                  <pre tabIndex={0} aria-label="委譲指示" className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-sm leading-6 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">{instruction}</pre>
                  <button type="button" onClick={copyInstruction} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-white/10 dark:text-white dark:hover:bg-white/5">
                    {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                    {copied ? "コピーしました" : "指示をコピー"}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-white/10">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setShowHistory((value) => !value)} className="flex items-center gap-2 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white">
                  <History className="h-4 w-4" />
                  ローカル監査履歴 ({history.length})
                </button>
                {history.length > 0 && (
                  <button type="button" onClick={clearHistory} className="flex items-center gap-1 text-sm font-semibold text-red-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-red-400">
                    <Trash2 className="h-4 w-4" />
                    履歴を消去
                  </button>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-neutral-300">保存に成功した場合だけ、この端末のブラウザー内へ記録します。秘密情報や外部AIの回答本文は保存しません。</p>
              {showHistory && (
                <div className="mt-3 space-y-2">
                  {history.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-white/5 dark:text-neutral-300">履歴はありません。</p>
                  ) : history.slice(0, 10).map((record) => (
                    <div key={record.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-white/10">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-800 dark:text-white">{record.selectedProviderName}</span>
                        <span className="text-xs text-slate-600 dark:text-neutral-400">{new Date(record.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mt-1 text-slate-600 dark:text-neutral-300">{TASK_LABELS[record.taskType]} · 無料枠のみ{record.requiresHumanApproval ? " · 要承認" : ""}</div>
                      <div className="mt-1 truncate text-slate-600 dark:text-neutral-300">{record.goal}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700 dark:bg-white/10 dark:text-neutral-300">結果: {RESULT_LABELS[record.resultStatus]}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700 dark:bg-white/10 dark:text-neutral-300">{VERIFICATION_LABELS[record.verificationStatus]}</span>
                        {record.elapsedSeconds !== undefined && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700 dark:bg-white/10 dark:text-neutral-300">{record.elapsedSeconds}秒</span>}
                      </div>

                      {editingId === record.id ? (
                        <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-white/5 sm:grid-cols-3">
                          <label className="text-sm text-slate-600 dark:text-neutral-300">結果
                            <select value={resultStatus} onChange={(event) => setResultStatus(event.target.value as DelegationResultStatus)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 dark:border-white/10 dark:bg-neutral-900 dark:text-white">
                              <option value="success">成功</option>
                              <option value="changes-required">要修正</option>
                              <option value="failed">失敗</option>
                            </select>
                          </label>
                          <label className="text-sm text-slate-600 dark:text-neutral-300">検証
                            <select value={verificationStatus} onChange={(event) => setVerificationStatus(event.target.value as DelegationVerificationStatus)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 dark:border-white/10 dark:bg-neutral-900 dark:text-white">
                              <option value="not-required">検証不要</option>
                              <option value="pending">検証待ち</option>
                              <option value="passed">検証合格</option>
                              <option value="failed">検証失敗</option>
                            </select>
                          </label>
                          <label className="text-sm text-slate-600 dark:text-neutral-300">所要時間（秒）
                            <input inputMode="numeric" value={elapsedSeconds} onChange={(event) => setElapsedSeconds(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900 dark:border-white/10 dark:bg-neutral-900 dark:text-white" />
                          </label>
                          <button type="button" onClick={saveResult} className="flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:col-span-3">
                            <Save className="h-4 w-4" /> 結果を保存
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => beginResultEntry(record)} className="mt-2 text-sm font-semibold text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-indigo-400">結果・検証を記録</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
