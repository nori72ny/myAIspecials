import React, { useEffect, useMemo, useState } from "react";
import { detectSensitiveInput } from "../../lib/orchestration/SensitiveInputDetector";
import {
  addOwnerImprovement,
  listOwnerImprovements,
  type OwnerImprovementCategory,
  type OwnerImprovementItem,
} from "../../lib/local/OwnerImprovementStore";
import { classifyOwnerImprovementCategory } from "../../lib/owner/OwnerImprovementIntent";
import type { OriginLanguage } from "../../i18n";

const CATEGORY_LABELS: Record<OwnerImprovementCategory, { ja: string; en: string }> = {
  product: { ja: "製品・機能", en: "Product / feature" },
  security: { ja: "セキュリティ・個人情報", en: "Security / privacy" },
  design: { ja: "UI・UX・デザイン", en: "UI / UX / design" },
  ai: { ja: "AI・モデル・回答品質", en: "AI / model / answer quality" },
  reliability: { ja: "不具合・信頼性", en: "Bug / reliability" },
  performance: { ja: "速度・性能", en: "Performance" },
  external: { ja: "外部サービス・技術", en: "External service / technology" },
  other: { ja: "その他", en: "Other" },
};

const STATE_LABELS: Record<string, { ja: string; en: string }> = {
  received: { ja: "受付済み", en: "Received" },
  researching: { ja: "調査中", en: "Researching" },
  "decision-ready": { ja: "判断準備完了", en: "Decision ready" },
  building: { ja: "実装中", en: "Building" },
  verifying: { ja: "検証中", en: "Verifying" },
  "owner-approval-required": { ja: "Owner承認待ち", en: "Owner approval required" },
  "ready-to-release": { ja: "公開準備完了", en: "Ready to release" },
  released: { ja: "公開済み", en: "Released" },
  "rejected-or-deferred": { ja: "見送り・保留", en: "Rejected / deferred" },
};

export const OwnerImprovementInbox: React.FC<{
  language: OriginLanguage;
  onCaptured?: (item: OwnerImprovementItem) => void;
}> = ({ language, onCaptured }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<OwnerImprovementCategory>("product");
  const [items, setItems] = useState<OwnerImprovementItem[]>([]);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isJa = language !== "en";

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void listOwnerImprovements()
      .then((next) => { if (active) setItems(next); })
      .catch(() => { if (active) setStatus(isJa ? "端末内Backlogを読み込めませんでした。" : "Could not read the local backlog."); });
    return () => { active = false; };
  }, [isJa, isOpen]);

  const suggested = useMemo(() => classifyOwnerImprovementCategory(body), [body]);
  useEffect(() => {
    if (!body.trim()) return;
    setCategory(suggested);
  }, [suggested, body]);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || isSaving) return;
    const sensitive = detectSensitiveInput(trimmed);
    if (sensitive.containsSensitiveInput) {
      setStatus(isJa
        ? "個人情報・認証情報・金融/医療情報などの可能性があるため保存しません。機密値を削除してから再入力してください。"
        : "This may contain personal, credential, financial, or medical data. Remove sensitive values before saving.");
      return;
    }
    setIsSaving(true);
    setStatus("");
    try {
      const item = await addOwnerImprovement({ body: trimmed, category, source: "owner-inbox" });
      setItems((current) => [item, ...current].slice(0, 200));
      setBody("");
      setStatus(isJa ? "改善案件として端末内Backlogへ保存しました。" : "Saved to the local improvement backlog.");
      onCaptured?.(item);
    } catch {
      setStatus(isJa ? "改善案件を保存できませんでした。" : "Could not save the improvement request.");
    } finally {
      setIsSaving(false);
    }
  };

  return <>
    <button
      type="button"
      data-testid="owner-improvement-toggle"
      aria-label={isJa ? "ORIGINを改善" : "Improve ORIGIN"}
      aria-pressed={isOpen}
      onClick={() => setIsOpen((value) => !value)}
      className="origin-secondary-button inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-[10px] px-0 text-[13px] font-semibold sm:w-auto sm:px-3"
    >
      <span aria-hidden="true">✦</span><span className="hidden sm:ml-1.5 sm:inline">{isJa ? "改善" : "Improve"}</span>
    </button>

    {isOpen && <section
      data-testid="owner-improvement-inbox"
      aria-label={isJa ? "ORIGIN改善依頼" : "ORIGIN improvement requests"}
      className="origin-surface absolute right-4 top-20 z-50 w-[min(94vw,520px)] p-4 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-bold">{isJa ? "ORIGINを改善" : "Improve ORIGIN"}</h2>
          <p className="origin-muted m-0 mt-1 text-[13px] leading-5">
            {isJa
              ? "要望・不具合・セキュリティ情報・他AIの案を自然な文章で入力できます。Phase 1では端末内Backlogに保存し、勝手にコード変更や公開はしません。"
              : "Submit ideas, bugs, security findings, or external AI suggestions in natural language. Phase 1 stores them locally and never changes or deploys code automatically."}
          </p>
        </div>
        <span className="origin-badge rounded-[10px] px-2 py-1 text-[13px] font-mono">Owner</span>
      </div>

      <label htmlFor="owner-improvement-body" className="mt-4 block text-[13px] font-semibold">
        {isJa ? "改善・相談内容" : "Request"}
      </label>
      <textarea
        id="owner-improvement-body"
        data-testid="owner-improvement-body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={5}
        maxLength={20_000}
        placeholder={isJa ? "例：この回答画面をもっと見やすくして。Claude Codeのこの機能も調べて採用可否を判断して。" : "Example: Make this answer view easier to scan and evaluate whether this Claude Code feature belongs in ORIGIN."}
        className="origin-input mt-1 w-full resize-y rounded-[10px] border bg-transparent px-3 py-2 text-base leading-6"
      />

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-[13px] font-semibold">
          {isJa ? "分類" : "Category"}
          <select
            data-testid="owner-improvement-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as OwnerImprovementCategory)}
            className="origin-input ml-2 min-h-11 rounded-[10px] border bg-transparent px-3 text-[13px]"
          >
            {(Object.keys(CATEGORY_LABELS) as OwnerImprovementCategory[]).map((key) =>
              <option key={key} value={key}>{CATEGORY_LABELS[key][isJa ? "ja" : "en"]}</option>)}
          </select>
        </label>
        <button
          type="button"
          data-testid="owner-improvement-submit"
          disabled={!body.trim() || isSaving}
          onClick={() => void submit()}
          className="origin-primary-button min-h-11 rounded-[10px] px-4 text-[13px] font-semibold disabled:opacity-50"
        >
          {isSaving ? (isJa ? "保存中…" : "Saving…") : (isJa ? "改善案件として保存" : "Save improvement")}
        </button>
      </div>

      {status && <p data-testid="owner-improvement-status" role="status" className="origin-muted mt-3 text-[13px] leading-5">{status}</p>}

      <div className="mt-4 border-t border-[var(--border-default)] pt-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-[13px] font-bold">{isJa ? "Owner Backlog" : "Owner Backlog"}</h3>
          <span className="origin-badge rounded-[10px] px-2 py-1 text-[13px] font-mono">{items.length}</span>
        </div>
        <div className="mt-2 grid max-h-52 gap-2 overflow-auto">
          {items.length ? items.slice(0, 20).map((item) => <article key={item.id} className="origin-surface-muted rounded-[10px] p-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="min-w-0 truncate text-[13px]">{item.title}</strong>
              <span className="origin-badge shrink-0 rounded-[10px] px-2 py-1 text-[13px]">{STATE_LABELS[item.state]?.[isJa ? "ja" : "en"] ?? item.state}</span>
            </div>
            <p className="origin-muted m-0 mt-1 line-clamp-2 text-[13px] leading-5">{item.body}</p>
            <p className="origin-muted m-0 mt-1 text-[13px]">{CATEGORY_LABELS[item.category][isJa ? "ja" : "en"]} · Local only</p>
          </article>) : <p className="origin-muted m-0 py-3 text-center text-[13px]">{isJa ? "改善案件はまだありません。" : "No improvement requests yet."}</p>}
        </div>
      </div>
    </section>}
  </>;
};
