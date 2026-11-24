import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import OriginCatState, { ORIGIN_CAT_SEASON_FULL_SRC, resolveOriginCatSeason } from './OriginCatState';
import type { OriginLanguage } from '../i18n';
import { getSessionCredential } from '../security/sessionCredentials';
import {
  getVoiceOutputAvailability,
  subscribeVoiceOutputAvailability,
} from '../voice/voiceOutputAvailability';
import {
  groupOrinPanelRuns,
  orinPanelProgressText,
  orinPanelStepStatusText,
  orinPanelStepTitle,
  parseOrinPanelRun,
  type OrinPanelAgentItem,
  type OrinPanelRunGroups,
} from './orinPanelModel';
import {
  buildOrinFeatureCatalog,
  orinFeatureStatusText,
  type OrinFeatureAction,
} from './orinFeatureCatalog';

/**
 * オリンパネル（第1段、設計 ORIN_PANEL_DESIGN_2026-11-24）。
 *
 * 常駐オリンのタップで開く表示を、旧プロフィールカード
 * （OriginWorkSheet）から発展させたもの。上部はプロフィール
 * ヘッダー（大きなオリン＋名前「Orin」＋ひとこと。名前表記は
 * 2026-11-24 の統括裁定で「Orin」に統一）、その下に
 * 「作業状況」「できること」の2タブを持つ。
 *
 * 形態は幅で分ける（CSS の .origin-orin-panel が担う）：
 * 1024px 未満は全画面に切り替わり（上部に「戻る」）、1024px 以上は
 * 右端のレールが本文を押し出す（本文側に padding を付けて確保し、
 * 浮かせて本文を隠す形は採らない＝P4 の教訓）。閉じる操作は
 * オリンの再タップ（トグル）・Esc・「戻る」／×で、閉じたら
 * 起点のオリンのタップ対象へフォーカスを戻す。
 *
 * 作業状況のデータの正は runs 一覧 API（所有者束縛）。管理者
 * 資格情報がある場合だけ一覧が引ける（ブラウザ側の所有者束縛は
 * 設計 §11 U5 が未決で、計画トークンはエージェント画面の中に
 * 閉じている）。一覧が引けない時は断定せず、従来カードと同じ
 * 共有ストア要約（現在の run 1件）に倒す（fail closed）。
 * 取り直しはパネルを開いている間だけ（5秒間隔）で、閉じたら
 * 止める。常駐ポーリングは新設しない。
 */

/** 作業中ステップ列の1件（共有ストア由来の平易なタイトル＋状態）。 */
export interface OrinPanelLocalStep {
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
}

export interface OrinPanelProps {
  open: boolean;
  language: OriginLanguage;
  /** 前景のチャット・画像の作業中項目（段階文のタイトル＋出典などの補足）。 */
  foregroundItems: readonly { id: string; title: string; meta?: string }[];
  /** 共有ストア由来のエージェント作業中項目（一覧が引けない時の受け皿）。 */
  agentFallbackItem: {
    title: string;
    currentStep: number;
    totalSteps: number;
    steps?: readonly OrinPanelLocalStep[];
  } | null;
  /** 直近の完了1件（チャット由来）。 */
  lastCompletedChat: { label: string; at: number } | null;
  /** 直近の完了1件（エージェント由来。ステップ列つき）。 */
  lastCompletedAgent: { label: string; at: number; steps?: readonly OrinPanelLocalStep[] } | null;
  /** 送信待ちの依頼（未対応）。 */
  queuedRequests: readonly { id: string; summary: string }[];
  onClose: () => void;
  onOpenAgent?: () => void;
  onOpenCoding?: () => void;
  onOpenCreative?: () => void;
}

/** カードに出すオリンの姿の寸法（px）。旧プロフィールカードから継承。 */
export const ORIN_PANEL_ART_SIZE_PX = 80;

const RUNS_POLL_MS = 5_000;

type RunsState =
  | { kind: 'unavailable' }
  | { kind: 'ready'; groups: OrinPanelRunGroups };

export default function OrinPanel({
  open,
  language,
  foregroundItems,
  agentFallbackItem,
  lastCompletedChat,
  lastCompletedAgent,
  queuedRequests,
  onClose,
  onOpenAgent,
  onOpenCoding,
  onOpenCreative,
}: OrinPanelProps) {
  const ja = language !== 'en';
  const [tab, setTab] = useState<'work' | 'features'>('work');
  const [runsState, setRunsState] = useState<RunsState>({ kind: 'unavailable' });
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const voiceOutput = useSyncExternalStore(
    subscribeVoiceOutputAvailability,
    getVoiceOutputAvailability,
    getVoiceOutputAvailability,
  );

  // Escで閉じる（旧カードから継承）。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // 閉じたら起点（常駐オリンのタップ対象）へフォーカスを戻す。
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      document.querySelector<HTMLElement>('.origin-orin-presence__tap')?.focus();
    }
  }, [open ]);

  // 開くたびに「作業状況」タブから始める。
  useEffect(() => {
    if (open) setTab('work');
  }, [open ]);

  // できることタブのヘルス連動（添付の可否）は開いた時に1回だけ
  // 確認する。取れなければ「準備中」側（false）に倒す。
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch('/api/agent/v3/status', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { attachmentsEnabled?: unknown };
        if (!controller.signal.aborted) setAttachmentsEnabled(data.attachmentsEnabled === true);
      })
      .catch(() => { /* fail closed: 添付は準備中のまま */ });
    return () => controller.abort();
  }, [open ]);

  // runs 一覧の取り直し：作業状況タブを開いている間だけ。
  // 資格情報が無い場合は一覧を引かず、共有ストアの要約に倒す。
  useEffect(() => {
    if (!open || tab !== 'work') return;
    const credential = getSessionCredential('admin').trim();
    if (!credential) {
      setRunsState({ kind: 'unavailable' });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch('/api/agent/v3/runs?limit=50', {
          headers: { Authorization: `Bearer ${credential}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await response.json() as { ok?: unknown; runs?: unknown };
        if (cancelled || controller.signal.aborted) return;
        if (!response.ok || data.ok !== true || !Array.isArray(data.runs)) {
          // 一度も引けていない時だけ「引けない」に倒す。引けた後の
          // 一時的な失敗では、最後に確認できた状態を保つ（§4.4）。
          setRunsState((current) => (current.kind === 'ready' ? current : { kind: 'unavailable' }));
          return;
        }
        const runs = data.runs.map(parseOrinPanelRun).filter((run) => run !== null);
        setRunsState({ kind: 'ready', groups: groupOrinPanelRuns(runs, Date.now()) });
      } catch {
        if (cancelled || controller.signal.aborted) return;
        setRunsState((current) => (current.kind === 'ready' ? current : { kind: 'unavailable' }));
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, RUNS_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [open, tab ]);

  if (!open) return null;
  const season = resolveOriginCatSeason(new Date());
  const runsReady = runsState.kind === 'ready';
  const groups = runsReady ? runsState.groups : null;

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openFeature = (action: OrinFeatureAction) => {
    if (action === 'agent' && onOpenAgent) { onClose(); onOpenAgent(); return; }
    if (action === 'coding' && onOpenCoding) { onClose(); onOpenCoding(); return; }
    if (action === 'creative' && onOpenCreative) { onClose(); onOpenCreative(); return; }
    onClose();
  };
  const featureActionAvailable = (action: OrinFeatureAction): boolean => {
    if (action === 'agent') return Boolean(onOpenAgent);
    if (action === 'coding') return Boolean(onOpenCoding);
    if (action === 'creative') return Boolean(onOpenCreative);
    return true; // chat はこの画面そのもの（閉じるだけ）
  };

  // ---- 作業状況の節の組み立て ----
  interface PanelRow {
    id: string;
    title: string;
    statusText: string;
    meta?: string;
    note?: string;
    progressText?: string;
    steps?: readonly { title: string; status: OrinPanelLocalStep['status'] }[];
    agentLink?: boolean;
    pulsing: boolean;
  }
  const activeRows: PanelRow[] = [];
  for (const item of foregroundItems) {
    activeRows.push({ id: item.id, title: item.title, statusText: ja ? '作業中' : 'Working', meta: item.meta, pulsing: true });
  }
  if (groups) {
    for (const item of groups.active) {
      activeRows.push({
        id: item.runId,
        title: item.title,
        statusText: ja ? item.statusText.ja : item.statusText.en,
        meta: item.startedHint ? (ja ? item.startedHint.ja : item.startedHint.en) : undefined,
        progressText: item.progress ? orinPanelProgressText(item.progress, ja) : undefined,
        steps: item.steps.map((step) => ({ title: orinPanelStepTitle(step.toolName, ja), status: step.status })),
        agentLink: true,
        pulsing: true,
      });
    }
  } else if (agentFallbackItem) {
    const doneCount = agentFallbackItem.steps?.filter((step) => step.status === 'completed').length ?? 0;
    const total = agentFallbackItem.totalSteps;
    activeRows.push({
      id: 'agent-fallback',
      title: agentFallbackItem.title,
      statusText: ja ? '作業中' : 'Working',
      progressText: total > 0
        ? (ja ? `${Math.floor((doneCount / total) * 100)}%（${total}ステップ中 ${doneCount}つ完了）` : `${Math.floor((doneCount / total) * 100)}% (${doneCount} of ${total} steps done)`)
        : undefined,
      steps: agentFallbackItem.steps,
      agentLink: true,
      pulsing: true,
    });
  }
  const pendingRows: PanelRow[] = [];
  if (groups) {
    for (const item of groups.pending) {
      pendingRows.push({
        id: item.runId,
        title: item.title,
        statusText: ja ? item.statusText.ja : item.statusText.en,
        meta: item.startedHint ? (ja ? item.startedHint.ja : item.startedHint.en) : undefined,
        steps: item.steps.map((step) => ({ title: orinPanelStepTitle(step.toolName, ja), status: step.status })),
        agentLink: true,
        pulsing: false,
      });
    }
  }
  for (const queued of queuedRequests) {
    pendingRows.push({ id: `queue-${queued.id}`, title: queued.summary, statusText: ja ? '送信待ち' : 'Waiting to send', pulsing: false });
  }
  const stoppedRows: PanelRow[] = groups
    ? groups.stopped.map((item) => ({
      id: item.runId,
      title: item.title,
      statusText: ja ? item.statusText.ja : item.statusText.en,
      note: item.note ? (ja ? item.note.ja : item.note.en) : undefined,
      meta: item.startedHint ? (ja ? item.startedHint.ja : item.startedHint.en) : undefined,
      progressText: item.progress ? orinPanelProgressText(item.progress, ja) : undefined,
      steps: item.steps.map((step) => ({ title: orinPanelStepTitle(step.toolName, ja), status: step.status })),
      agentLink: true,
      pulsing: false,
    }))
    : [];
  const doneRows: PanelRow[] = [];
  if (groups) {
    for (const item of groups.done) {
      doneRows.push({
        id: item.runId,
        title: item.title,
        statusText: ja ? item.statusText.ja : item.statusText.en,
        meta: item.startedHint ? (ja ? item.startedHint.ja : item.startedHint.en) : undefined,
        progressText: item.progress ? orinPanelProgressText(item.progress, ja) : undefined,
        steps: item.steps.map((step) => ({ title: orinPanelStepTitle(step.toolName, ja), status: step.status })),
        agentLink: true,
        pulsing: false,
      });
    }
    if (lastCompletedChat) {
      doneRows.push({ id: 'last-completed-chat', title: lastCompletedChat.label, statusText: ja ? '完了' : 'Done', pulsing: false });
    }
  } else {
    // 一覧が引けない時は従来どおり直近の完了1件だけ（新しい方）。
    const candidates = [
      lastCompletedChat ? { label: lastCompletedChat.label, at: lastCompletedChat.at, steps: undefined as readonly OrinPanelLocalStep[] | undefined } : null,
      lastCompletedAgent ? { label: lastCompletedAgent.label, at: lastCompletedAgent.at, steps: lastCompletedAgent.steps } : null,
    ].filter((candidate) => candidate !== null).sort((a, b) => b.at - a.at);
    const localDone = candidates[0];
    if (localDone) {
      doneRows.push({
        id: 'last-completed',
        title: localDone.label,
        statusText: ja ? '完了' : 'Done',
        steps: localDone.steps,
        pulsing: false,
      });
    }
  }
  const sections: Array<{ key: string; label: string; rows: PanelRow[] }> = [
    { key: 'active', label: ja ? '作業中' : 'Working on it', rows: activeRows },
    { key: 'pending', label: ja ? '未対応' : 'Waiting', rows: pendingRows },
    { key: 'stopped', label: ja ? '止まっています' : 'Stopped', rows: stoppedRows },
    { key: 'done', label: ja ? '完了' : 'Done', rows: doneRows },
  ];
  const totalRows = sections.reduce((sum, section) => sum + section.rows.length, 0);

  const catalog = buildOrinFeatureCatalog({
    voiceOutput: voiceOutput === 'available',
    attachments: attachmentsEnabled,
  });

  const renderRow = (row: PanelRow) => {
    const isExpanded = expanded.has(row.id);
    const hasSteps = Boolean(row.steps && row.steps.length > 0);
    return (
      <li key={row.id} className="origin-orin-panel__row">
        <div className="flex min-h-11 items-center gap-2 px-1 text-sm">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${row.pulsing ? 'animate-pulse bg-[var(--accent-primary)]' : 'bg-[var(--text-secondary)]'}`}
          />
          <span className="min-w-0 flex-1 truncate font-semibold">{row.title}</span>
          {row.meta && <span className="origin-muted shrink-0 text-[13px]">{row.meta}</span>}
          <span className="origin-muted shrink-0 text-[13px]">{row.statusText}</span>
        </div>
        {row.progressText && (
          <p data-testid="origin-orin-panel-progress" className="m-0 px-1 pl-5 text-[13px] font-semibold text-[var(--accent-primary)]">{row.progressText}</p>
        )}
        {row.note && <p className="m-0 px-1 pl-5 text-[13px] leading-5 origin-muted">{row.note}</p>}
        {(hasSteps || (row.agentLink && onOpenAgent)) && (
          <div className="flex flex-wrap gap-2 px-1 pl-5 pb-1">
            {hasSteps && (
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => toggleExpanded(row.id)}
                className="origin-secondary-button inline-flex min-h-9 items-center px-3 text-[13px] font-semibold"
              >
                {isExpanded ? (ja ? 'ステップを閉じる' : 'Hide steps') : (ja ? 'ステップを見る' : 'See steps')}
              </button>
            )}
            {row.agentLink && onOpenAgent && (
              <button
                type="button"
                data-testid="origin-orin-panel-agent-link"
                onClick={() => { onClose(); onOpenAgent(); }}
                className="origin-secondary-button inline-flex min-h-9 items-center px-3 text-[13px] font-semibold"
              >
                {ja ? 'エージェント画面で見る' : 'Open the agent screen'}
              </button>
            )}
          </div>
        )}
        {hasSteps && isExpanded && (
          <ol data-testid="origin-orin-panel-steps" className="m-0 mb-1 grid list-none gap-0.5 p-0 pl-6 pr-3">
            {row.steps!.map((step, stepIndex) => (
              <li key={`${stepIndex}-${step.title}`} className="flex min-h-8 items-center gap-2 text-sm">
                <span aria-hidden="true" className="origin-muted shrink-0">{stepIndex + 1}.</span>
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${step.status === 'running' ? 'animate-pulse bg-[var(--accent-primary)]' : step.status === 'completed' ? 'bg-[var(--text-secondary)]' : 'bg-[var(--border-default)]'}`}
                />
                <span className="min-w-0 flex-1 truncate font-semibold">{step.title}</span>
                <span className="origin-muted shrink-0">{orinPanelStepStatusText(step.status, ja)}</span>
              </li>
            ))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <div className="origin-orin-panel" data-testid="origin-orin-panel">
      <div className="origin-orin-panel__topbar">
        <button
          type="button"
          data-testid="origin-orin-panel-back"
          onClick={onClose}
          className="origin-orin-panel__back"
        >
          <ChevronLeft aria-hidden="true" size={20} />
          {ja ? '戻る' : 'Back'}
        </button>
        <span className="text-sm font-bold">Orin</span>
        <span aria-hidden="true" className="w-16" />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={ja ? '閉じる' : 'Close'}
        className="origin-secondary-button origin-close-button origin-orin-panel__close absolute right-3 top-3"
      >
        <X aria-hidden="true" size={18} />
      </button>
      <div className="origin-orin-panel__scroll">
        <div className="flex flex-col items-center px-2 text-center">
          <span data-testid="origin-orin-profile-art" className="inline-flex">
            <OriginCatState state="idle" size={ORIN_PANEL_ART_SIZE_PX} />
          </span>
          <h2 data-testid="origin-orin-profile-name" className="m-0 mt-3 text-xl font-bold">Orin</h2>
          <p data-testid="origin-orin-profile-intro" className="m-0 mt-2 max-w-xs text-sm leading-6">
            {ja
              ? 'こんにちは、オリンです。調べものや資料づくりなど、やりたいことを伝えてください。'
              : "Hi, I'm Orin. Tell me what you'd like to do — looking things up, making documents, and more."}
          </p>
          {season !== null && (
            <figure data-testid="origin-orin-profile-season" className="m-0 mt-4">
              <img
                src={ORIGIN_CAT_SEASON_FULL_SRC[season]}
                alt=""
                draggable={false}
                className="h-auto w-full max-w-[300px] rounded-2xl"
              />
              <figcaption className="origin-muted mt-2 text-[13px]">
                {season === 'winter'
                  ? (ja ? '雪景色のオリン' : 'Orin in a snowy scene')
                  : (ja ? 'お正月のオリン' : 'Orin for the New Year')}
              </figcaption>
            </figure>
          )}
        </div>
        <div className="origin-orin-panel__tabs" role="tablist" aria-label={ja ? 'オリンのパネル' : "Orin's panel"}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'work'}
            data-testid="origin-orin-panel-tab-work"
            onClick={() => setTab('work')}
            className={`origin-orin-panel__tab ${tab === 'work' ? 'is-selected' : ''}`}
          >
            {ja ? '作業状況' : 'Work status'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'features'}
            data-testid="origin-orin-panel-tab-features"
            onClick={() => setTab('features')}
            className={`origin-orin-panel__tab ${tab === 'features' ? 'is-selected' : ''}`}
          >
            {ja ? 'できること' : 'What I can do'}
          </button>
        </div>
        {tab === 'work' ? (
          <div data-testid="origin-orin-panel-work">
            {totalRows === 0 ? (
              <>
                <p data-testid="origin-orin-panel-empty" className="m-0 pt-6 pb-2 text-center text-sm origin-muted">
                  {ja ? 'いまは作業していません' : 'Nothing is in progress right now.'}
                </p>
                <button
                  type="button"
                  data-testid="origin-orin-panel-empty-guide"
                  className="origin-orin-panel__empty-guide"
                  onClick={() => setTab('features')}
                >
                  {ja ? 'できることを見る' : 'See what Orin can do'}
                </button>
              </>
            ) : (
              sections.map((section) => (section.rows.length > 0 ? (
                <section key={section.key} className="mt-4">
                  <h3 className="m-0 text-sm font-black">
                    {section.label}
                    <span className="origin-muted ml-2 text-[13px] font-semibold">{ja ? `${section.rows.length}件` : `${section.rows.length}`}</span>
                  </h3>
                  <ul className="m-0 mt-1 grid list-none gap-1 p-0">
                    {section.rows.map(renderRow)}
                  </ul>
                </section>
              ) : null))
            )}
          </div>
        ) : (
          <div data-testid="origin-orin-panel-features">
            {catalog.map((group) => (
              <section key={group.id} className="mt-4">
                <h3 className="m-0 px-3 text-sm font-black">{ja ? group.title.ja : group.title.en}</h3>
                <ul className="m-0 mt-1 grid list-none gap-1 p-0">
                  {group.items.map((item) => {
                    const actionable = item.status !== 'preparing' && item.action && featureActionAvailable(item.action);
                    const body = (
                      <>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-semibold">{ja ? item.name.ja : item.name.en}</span>
                          <span className={`origin-orin-panel__chip ${item.status === 'preparing' ? 'is-preparing' : item.status === 'partial' ? 'is-partial' : ''}`}>
                            {orinFeatureStatusText(item.status, ja)}
                          </span>
                        </span>
                        <span className="origin-muted mt-0.5 block text-[13px] leading-5">
                          {ja ? item.description.ja : item.description.en}
                        </span>
                      </>
                    );
                    return (
                      <li key={item.id}>
                        {actionable ? (
                          <button
                            type="button"
                            data-testid={`origin-orin-panel-feature-${item.id}`}
                            onClick={() => openFeature(item.action!)}
                            className="origin-secondary-button block w-full px-3 py-2 text-left text-sm"
                          >
                            {body}
                          </button>
                        ) : (
                          <div data-testid={`origin-orin-panel-feature-${item.id}`} className="px-3 py-2 text-sm">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
