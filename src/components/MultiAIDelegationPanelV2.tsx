import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, History, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import DelegationDecisionSummary from "./DelegationDecisionSummary";
import {
  createDelegationInstruction,
  DEFAULT_AI_CAPABILITIES,
  routeTask,
  type AICapabilityProfile,
  type AIRoutingDecision,
} from "../lib/orchestration/MultiAIOrchestrator";
import {
  appendDelegationAudit,
  clearDelegationAudit,
  createDelegationAuditRecord,
  readDelegationAudit,
  type AuditStorage,
  type AuditStorageFailureReason,
  type DelegationAuditRecord,
} from "../lib/orchestration/DelegationAuditStore";
import { containsSensitiveInput } from "../lib/orchestration/SensitiveInputDetector";
import { providerDisplayName, taskDisplayName } from "../lib/orchestration/DelegationPresentation";

const HUMAN_APPROVAL_GATE: AICapabilityProfile = {
  id: "human-approval-gate",
  displayName: "Human Approval Gate",
  capabilities: ["operations"],
  available: true,
  freeOnly: true,
  preferredFor: ["operations"],
  limitations: ["Does not execute operations", "Requires explicit owner approval"],
};

const PROFILES: readonly AICapabilityProfile[] = [...DEFAULT_AI_CAPABILITIES, HUMAN_APPROVAL_GATE];
const FOCUSABLE = "button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[href],[tabindex]:not([tabindex='-1'])";

type StorageResult = { ok: true; storage: AuditStorage } | { ok: false; reason: "unavailable" };

function browserStorage(): StorageResult {
  try {
    return { ok: true, storage: window.localStorage };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function storageMessage(reason: AuditStorageFailureReason | "unavailable"): string {
  if (reason === "read-failed") return "監査履歴を読み込めませんでした。新しい判定は続けられます。";
  if (reason === "quota-exceeded") return "保存容量が不足しているため、監査履歴を保存できませんでした。";
  if (reason === "remove-failed") return "監査履歴を削除できませんでした。ブラウザー設定を確認してください。";
  if (reason === "write-failed") return "監査履歴を保存できませんでした。ブラウザー設定またはプライベートモードを確認してください。";
  return "この環境では監査履歴を利用できません。新しい判定は保存せずに続けられます。";
}

export default function MultiAIDelegationPanelV2() {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [decision, setDecision] = useState<AIRoutingDecision | null>(null);
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<DelegationAuditRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const wasOpen = useRef(false);
  const containsSecrets = useMemo(() => containsSensitiveInput(goal), [goal]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    goalRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const openPanel = () => {
    setOpen(true);
    setStorageWarning("");
    const storage = browserStorage();
    if (!storage.ok) {
      setHistory([]);
      setStorageWarning(storageMessage(storage.reason));
      return;
    }
    const result = readDelegationAudit(storage.storage);
    setHistory(result.value);
    if (!result.ok) setStorageWarning(storageMessage(result.reason));
  };

  const plan = () => {
    setError("");
    setCopied(false);
    setAnnouncement("");
    const trimmed = goal.trim();
    if (!trimmed) {
      setDecision(null);
      setInstruction("");
      setError("依頼内容を入力してください。");
      return;
    }

    const request = {
      goal: trimmed,
      requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(trimmed),
      requiresFreshResearch: /最新|調査|料金|current|research/i.test(trimmed),
      containsSecrets,
    };
    const nextDecision = routeTask(request, PROFILES);
    const safeRequest = containsSecrets ? { ...request, goal: "[REDACTED]" } : request;
    const record = createDelegationAuditRecord(safeRequest, nextDecision);
    setDecision(nextDecision);
    setInstruction(createDelegationInstruction(safeRequest, nextDecision));

    const storage = browserStorage();
    if (!storage.ok) {
      setStorageWarning(storageMessage(storage.reason));
      return;
    }
    const result = appendDelegationAudit(storage.storage, record);
    if (result.ok) {
      setHistory(result.value);
      setStorageWarning("");
    } else {
      setStorageWarning(storageMessage(result.reason));
    }
  };

  const copy = async () => {
    if (!instruction) return;
    setError("");
    setAnnouncement("");
    try {
      await navigator.clipboard.writeText(instruction);
      setCopied(true);
      setAnnouncement("委譲指示をコピーしました。");
    } catch {
      setCopied(false);
      setError("クリップボードへのコピーに失敗しました。指示を選択して手動でコピーしてください。");
    }
  };

  const clearHistory = () => {
    const storage = browserStorage();
    if (!storage.ok) {
      setStorageWarning(storageMessage(storage.reason));
      return;
    }
    const result = clearDelegationAudit(storage.storage);
    if (!result.ok) {
      setStorageWarning(storageMessage(result.reason));
      return;
    }
    setHistory([]);
    setStorageWarning("");
  };

  return (
    <>
      <button ref={openerRef} type="button" data-testid="multi-ai-planner-v2-open" onClick={openPanel} aria-label="AI作業振り分けを開く" className="fixed bottom-5 right-5 z-[80] flex min-h-11 items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400">
        <Sparkles className="h-4 w-4" /> AI作業振り分け
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-end bg-black/45 p-2 sm:items-center sm:justify-center sm:p-5">
          <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="delegation-v2-title" className="max-h-[96vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92vh] sm:max-w-3xl dark:border-white/10 dark:bg-neutral-950">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6 dark:border-white/10 dark:bg-neutral-950/95">
              <div>
                <h2 id="delegation-v2-title" className="text-lg font-bold text-slate-950 dark:text-white">AI作業振り分け</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-neutral-300">依頼に適した担当、選定理由、確認方法を端末内で整理します。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="閉じる" className="min-h-11 min-w-11 rounded-xl p-3 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-neutral-300 dark:hover:bg-white/10"><X className="h-5 w-5" /></button>
            </header>

            <div className="space-y-4 p-4 sm:p-6">
              <label className="block text-sm font-semibold text-slate-700 dark:text-neutral-200">依頼内容
                <textarea ref={goalRef} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例: 認証処理の安全性を確認してください" className="mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-3 text-base leading-7 text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-white/15 dark:bg-neutral-900 dark:text-white" />
              </label>

              {containsSecrets && <div role="status" aria-live="polite" data-testid="secret-redaction-warning-v2" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm leading-6">秘密情報を検出したため、依頼本文を委譲指示と監査履歴から除外します。</p></div>}

              <button type="button" onClick={plan} className="min-h-12 w-full rounded-xl bg-slate-950 px-4 py-3 text-base font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-white dark:text-black">担当と確認方法を判定</button>

              {storageWarning && <p role="status" data-testid="audit-storage-warning-v2" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">{storageWarning}</p>}
              {error && <p role="alert" className="text-sm leading-6 text-red-600 dark:text-red-400">{error}</p>}
              {announcement && <p role="status" aria-live="polite" className="sr-only">{announcement}</p>}

              {decision && <>
                <DelegationDecisionSummary decision={decision} />
                {decision.requiresHumanApproval && <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><h3 className="font-bold">ノリさんの承認が必要です</h3><p className="mt-1 text-sm leading-6">マージ、デプロイ、DNS、課金、本番、アカウント操作は自動実行しません。</p></div></div>}
                <section aria-labelledby="delegation-instruction-title">
                  <h3 id="delegation-instruction-title" className="text-sm font-semibold text-slate-700 dark:text-neutral-200">コピーして担当AIへ渡す指示</h3>
                  <pre tabIndex={0} aria-label="委譲指示" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-sm leading-6 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">{instruction}</pre>
                  <button type="button" onClick={copy} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-white/15 dark:text-white dark:hover:bg-white/5">{copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}{copied ? "コピーしました" : "指示をコピー"}</button>
                </section>
              </>}

              <section className="border-t border-slate-200 pt-4 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => setShowHistory((value) => !value)} className="flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"><History className="h-4 w-4" />ローカル監査履歴 ({history.length})</button>
                  {history.length > 0 && <button type="button" onClick={clearHistory} className="flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-red-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-red-400"><Trash2 className="h-4 w-4" />履歴を消去</button>}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-neutral-300">保存に成功した場合だけ、この端末内へ記録します。秘密情報や外部AIの回答本文は保存しません。</p>
                {showHistory && <div className="mt-3 space-y-2">{history.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-white/5 dark:text-neutral-300">履歴はありません。</p> : history.slice(0, 10).map((record) => <article key={record.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10"><div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-slate-900 dark:text-white">{providerDisplayName(record.selectedProvider)}</strong><time className="text-xs text-slate-500 dark:text-neutral-400">{new Date(record.createdAt).toLocaleString()}</time></div><p className="mt-1 text-sm text-slate-600 dark:text-neutral-300">{taskDisplayName(record.taskType)} · 無料枠のみ{record.requiresHumanApproval ? " · 要承認" : ""}</p><p className="mt-1 line-clamp-2 break-words text-sm text-slate-600 dark:text-neutral-300">{record.goal}</p></article>)}</div>}
              </section>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
