import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Blocks,
  Bot,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  Image as ImageIcon,
  ListChecks,
  MessageCircle,
  Mic,
  Newspaper,
  Search,
  Sparkles,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import OriginCatState, { ORIGIN_CAT_SEASON_FULL_SRC, resolveOriginCatSeason } from './OriginCatState';
import type { OriginLanguage } from '../i18n';
import {
  getVoiceOutputAvailability,
  subscribeVoiceOutputAvailability,
} from '../voice/voiceOutputAvailability';
import {
  orinPanelProgressText,
  orinPanelStepStatusText,
  orinPanelStepTitle,
  type OrinPanelAgentItem,
} from './orinPanelModel';
import {
  buildOrinFeatureCatalog,
  orinFeatureStatusText,
  type OrinFeatureAction,
  type OrinFeatureIcon,
} from './orinFeatureCatalog';
import { useOrinPanelRuns } from './useOrinPanelRuns';

/**
 * オリンパネル（第1段：設計 ORIN_PANEL_DESIGN_2026-11-24、
 * 拡張：ORIN_PANEL_EXPANSION_DESIGN_2026-11-25、構成変更：
 * オーナー指示 2026-11-25 17:14）。
 *
 * 常駐オリンのタップで開く表示。上部はプロフィールヘッダー
 * （大きなオリン＋名前「Orin」＋ひとこと）、その下に2タブ
 * （作業状況／できること）を持つ。タブの切り替えはテキスト
 * ではなくアイコン（Muse アプリの流儀）で、意味は aria-label
 * とツールチップで伝える。下線インジケーターはアイコンの下を
 * スライドする（240ms、拡張設計 §3 の曲線を継承）。
 *
 * 「残っている依頼」と「AIニュース」は当初このパネルのタブ
 * だったが、オーナー指示で左サイドバーの項目＋専用ページへ
 * 移した（OrinRemainingPage / OrinAiNewsPage）。材料の runs
 * 取得は useOrinPanelRuns でページと共用する。
 *
 * 形態は幅で分ける（CSS の .origin-orin-panel が担う）：
 * 1024px 未満は全画面に切り替わり（上部に「戻る」）、1024px 以上は
 * 右端のレールが本文を押し出す（本文側に padding を付けて確保し、
 * 浮かせて本文を隠す形は採らない＝P4 の教訓）。レールの背景は
 * 中身の量によらず画面の下端まで届く（オーナー指示 2026-11-25）。
 * 閉じる操作はオリンの再タップ（トグル）・Esc・「戻る」／×で、
 * 閉じたら起点のオリンのタップ対象へフォーカスを戻す。
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

/**
 * パネルが表示する作業状態の材料一式。「残っている依頼」ページ
 * （PersonalEditionApp 配下）も同じ材料を使うため、App は変化した
 * 時だけこの形で親へ知らせる（onOrinWorkStateChange）。
 */
export interface OrinPanelWorkState {
  foregroundItems: OrinPanelProps['foregroundItems'];
  agentFallbackItem: OrinPanelProps['agentFallbackItem'];
  queuedRequests: OrinPanelProps['queuedRequests'];
}

type OrinPanelTab = 'work' | 'features';
const ORIN_PANEL_TABS: readonly OrinPanelTab[] = ['work', 'features'];

/** タブのアイコン（線幅・寸法は「できること」の行アイコンと揃える）。 */
const TAB_ICONS: Record<OrinPanelTab, LucideIcon> = {
  work: ListChecks,
  features: Sparkles,
};

const FEATURE_ICONS: Record<OrinFeatureIcon, LucideIcon> = {
  'message-circle': MessageCircle,
  search: Search,
  newspaper: Newspaper,
  bot: Bot,
  code: Code2,
  image: ImageIcon,
  'file-text': FileText,
  volume: Volume2,
  mic: Mic,
  blocks: Blocks,
};

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
  const [tab, setTab] = useState<OrinPanelTab>('work');
  const runsState = useOrinPanelRuns(open);
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [indicator, setIndicator] = useState<{ x: number; w: number; ready: boolean }>({ x: 0, w: 0, ready: false });
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // ページ切り替えの方向は、タブを選んだ瞬間にインデックス比較で
  // 確定させて state に持つ（描画のたびに ref を書き換える方式だと、
  // 切り替え直後の再描画で方向が反転してしまうため）。
  const [pageDirection, setPageDirection] = useState<'from-right' | 'from-left'>('from-right');
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
    if (open) {
      setTab('work');
      setPageDirection('from-right');
    }
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

  // タブバーの下線インジケーターの位置：選択中タブのボタンを
  // 実測し、内側 8px ずつ寄せた幅で transform で滑らせる
  // （240ms の曲線は CSS 側、拡張設計 §3.1 を継承）。
  const tabIndex = ORIN_PANEL_TABS.indexOf(tab);
  const measureIndicator = () => {
    const button = tabButtonRefs.current[tabIndex];
    if (!button) return;
    setIndicator({ x: button.offsetLeft + 8, w: Math.max(0, button.offsetWidth - 16), ready: true });
  };
  useLayoutEffect(() => {
    if (!open) return;
    measureIndicator();
    // セルフホストフォントの読み込み後に文字幅が変わるため、確定後にも測り直す。
    let live = true;
    document.fonts?.ready.then(() => { if (live) measureIndicator(); }).catch(() => { /* 測定は初期値で継続 */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, language]);
  useEffect(() => {
    if (!open) return;
    const onResize = () => measureIndicator();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, language]);

  if (!open) return null;
  const season = resolveOriginCatSeason(new Date());
  // 完成イラストがある季節（冬・お正月）だけカード内に図版を出す。
  // クリスマスは完成イラストを用意しないため、この値が無い間は
  // 図版を出さず、待機姿の差し替え（上のプロフィール絵）だけが効く。
  const seasonFullSrc = season !== null ? ORIGIN_CAT_SEASON_FULL_SRC[season] : undefined;
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

  const agentItemSteps = (item: OrinPanelAgentItem) => item.steps.map((step) => ({
    title: orinPanelStepTitle(step.toolName, ja),
    status: step.status,
  }));
  const startedMeta = (item: OrinPanelAgentItem) => (item.startedHint ? (ja ? item.startedHint.ja : item.startedHint.en) : undefined);
  const fallbackProgressText = (): string | undefined => {
    if (!agentFallbackItem) return undefined;
    const doneCount = agentFallbackItem.steps?.filter((step) => step.status === 'completed').length ?? 0;
    const total = agentFallbackItem.totalSteps;
    if (total <= 0) return undefined;
    return ja
      ? `${Math.floor((doneCount / total) * 100)}%（${total}ステップ中 ${doneCount}つ完了）`
      : `${Math.floor((doneCount / total) * 100)}% (${doneCount} of ${total} steps done)`;
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
        meta: startedMeta(item),
        progressText: item.progress ? orinPanelProgressText(item.progress, ja) : undefined,
        steps: agentItemSteps(item),
        agentLink: true,
        pulsing: true,
      });
    }
  } else if (agentFallbackItem) {
    activeRows.push({
      id: 'agent-fallback',
      title: agentFallbackItem.title,
      statusText: ja ? '作業中' : 'Working',
      progressText: fallbackProgressText(),
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
        meta: startedMeta(item),
        steps: agentItemSteps(item),
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
      meta: startedMeta(item),
      progressText: item.progress ? orinPanelProgressText(item.progress, ja) : undefined,
      steps: agentItemSteps(item),
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
        meta: startedMeta(item),
        progressText: item.progress ? orinPanelProgressText(item.progress, ja) : undefined,
        steps: agentItemSteps(item),
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

  const renderSectionTitle = (label: string, count: number) => (
    <h3 className="origin-orin-panel__section-title">
      {label}
      <span className="origin-orin-panel__section-count">{ja ? `（${count}件）` : ` (${count})`}</span>
    </h3>
  );

  const renderRow = (row: PanelRow) => {
    const isExpanded = expanded.has(row.id);
    const hasSteps = Boolean(row.steps && row.steps.length > 0);
    return (
      <li key={row.id} className="origin-orin-panel__row">
        <div className="origin-orin-panel__row-head">
          <span
            aria-hidden="true"
            className={`origin-orin-panel__row-dot ${row.pulsing ? 'is-pulsing' : ''}`}
          />
          <span className="origin-orin-panel__row-title">{row.title}</span>
          {row.meta && <span className="origin-orin-panel__row-meta">{row.meta}</span>}
        </div>
        <p className="origin-orin-panel__row-sub">{row.statusText}</p>
        {row.progressText && (
          <p data-testid="origin-orin-panel-progress" className="origin-orin-panel__row-progress">{row.progressText}</p>
        )}
        {row.note && <p className="origin-orin-panel__row-note">{row.note}</p>}
        {(hasSteps || (row.agentLink && onOpenAgent)) && (
          <div className="origin-orin-panel__row-actions">
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
          <ol data-testid="origin-orin-panel-steps" className="origin-orin-panel__steps">
            {row.steps!.map((step, stepIndex) => (
              <li key={`${stepIndex}-${step.title}`} className="origin-orin-panel__step">
                <span aria-hidden="true" className="origin-orin-panel__step-index">{stepIndex + 1}.</span>
                <span
                  aria-hidden="true"
                  className={`origin-orin-panel__step-dot ${step.status === 'running' ? 'is-running' : step.status === 'completed' ? 'is-done' : ''}`}
                />
                <span className="origin-orin-panel__step-title">{step.title}</span>
                <span className="origin-orin-panel__step-status">{orinPanelStepStatusText(step.status, ja)}</span>
              </li>
            ))}
          </ol>
        )}
      </li>
    );
  };

  const tabLabels: Record<OrinPanelTab, string> = {
    work: ja ? '作業状況' : 'Work status',
    features: ja ? 'できること' : 'What I can do',
  };
  // ページ切り替えの方向はタブのインデックス比較で決める（拡張設計 §3.3）。
  const selectTab = (next: OrinPanelTab) => {
    setPageDirection(ORIN_PANEL_TABS.indexOf(next) >= tabIndex ? 'from-right' : 'from-left');
    setTab(next);
  };

  return (
    <div className={`origin-orin-panel${tab === 'work' && totalRows === 0 ? ' origin-orin-panel--work-empty' : ''}`} data-testid="origin-orin-panel">
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
          <p data-testid="origin-orin-profile-intro" className="m-0 mt-2 max-w-xs text-sm leading-[1.6]">
            {ja
              ? 'こんにちは、オリンです。調べものや資料づくりなど、やりたいことを伝えてください。'
              : "Hi, I'm Orin. Tell me what you'd like to do — looking things up, making documents, and more."}
          </p>
          {seasonFullSrc !== undefined && (
            <figure data-testid="origin-orin-profile-season" className="m-0 mt-4">
              <img
                src={seasonFullSrc}
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
        <div className="origin-orin-panel__tabs">
          <div className="origin-orin-panel__tabs-inner" role="tablist" aria-label={ja ? 'オリンのパネル' : "Orin's panel"}>
            {ORIN_PANEL_TABS.map((tabId, index) => {
              const TabIcon = TAB_ICONS[tabId];
              return (
                <button
                  key={tabId}
                  type="button"
                  role="tab"
                  ref={(el) => { tabButtonRefs.current[index] = el; }}
                  aria-selected={tab === tabId}
                  aria-label={tabLabels[tabId]}
                  title={tabLabels[tabId]}
                  data-testid={`origin-orin-panel-tab-${tabId}`}
                  onClick={() => selectTab(tabId)}
                  className={`origin-orin-panel__tab ${tab === tabId ? 'is-selected' : ''}`}
                >
                  <TabIcon aria-hidden="true" size={20} strokeWidth={1.8} />
                </button>
              );
            })}
            <span
              aria-hidden="true"
              data-testid="origin-orin-panel-tab-indicator"
              className={`origin-orin-panel__tab-indicator ${indicator.ready ? 'is-ready' : ''}`}
              style={{ transform: `translateX(${indicator.x}px)`, width: `${indicator.w}px` }}
            />
          </div>
        </div>
        {/* Tab page wrapper (tab-switch motion, 2026-11-25): keyed
            by the active tab so a switch remounts the page and the
            CSS slide/fade replays, entering from the side of the
            tab being opened (direction from the tab index order).
            The profile block above stays outside this element, so
            Orin never moves on a switch. */}
        <div
          key={tab}
          className={`origin-orin-panel__page origin-orin-panel__page--${pageDirection}`}
        >
        {tab === 'work' && (
          <div data-testid="origin-orin-panel-work">
            {totalRows === 0 ? (
              <>
                <p data-testid="origin-orin-panel-empty" className="origin-orin-panel__empty-line">
                  {ja ? 'いまは作業していません' : 'Nothing is in progress right now.'}
                </p>
                <button
                  type="button"
                  data-testid="origin-orin-panel-empty-guide"
                  className="origin-orin-panel__empty-guide"
                  onClick={() => selectTab('features')}
                >
                  {ja ? 'できることを見る' : 'See what Orin can do'}
                </button>
              </>
            ) : (
              sections.map((section) => (section.rows.length > 0 ? (
                <section key={section.key} className="origin-orin-panel__section">
                  {renderSectionTitle(section.label, section.rows.length)}
                  <ul className="origin-orin-panel__rows">
                    {section.rows.map(renderRow)}
                  </ul>
                </section>
              ) : null))
            )}
          </div>
        )}
        {tab === 'features' && (
          <div data-testid="origin-orin-panel-features">
            {catalog.map((group) => (
              <section key={group.id} className="origin-orin-panel__group">
                <h3 className="origin-orin-panel__section-title">{ja ? group.title.ja : group.title.en}</h3>
                <ul className="origin-orin-panel__rows">
                  {group.items.map((item) => {
                    const actionable = item.status !== 'preparing' && item.action && featureActionAvailable(item.action);
                    const Icon = FEATURE_ICONS[item.icon];
                    const body = (
                      <>
                        <span className={`origin-orin-panel__feature-icon ${item.status === 'preparing' ? 'is-preparing' : ''}`}>
                          <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                        </span>
                        <span className="origin-orin-panel__feature-body">
                          <span className="origin-orin-panel__feature-name">
                            {ja ? item.name.ja : item.name.en}
                            {item.status !== 'ready' && (
                              <span
                                data-testid={`origin-orin-panel-feature-status-${item.id}`}
                                className={`origin-orin-panel__feature-label ${item.status === 'partial' ? 'is-partial' : 'is-preparing'}`}
                              >
                                {orinFeatureStatusText(item.status, ja)}
                              </span>
                            )}
                          </span>
                          <span className="origin-orin-panel__feature-desc">
                            {ja ? item.description.ja : item.description.en}
                          </span>
                        </span>
                        {actionable && (
                          <ChevronRight aria-hidden="true" size={16} className="origin-orin-panel__feature-chevron" />
                        )}
                      </>
                    );
                    return (
                      <li key={item.id}>
                        {actionable ? (
                          <button
                            type="button"
                            data-testid={`origin-orin-panel-feature-${item.id}`}
                            onClick={() => openFeature(item.action!)}
                            className="origin-orin-panel__feature-row"
                          >
                            {body}
                          </button>
                        ) : (
                          <div
                            data-testid={`origin-orin-panel-feature-${item.id}`}
                            className={`origin-orin-panel__feature-row is-static ${item.status === 'preparing' ? 'is-preparing' : ''}`}
                          >
                            {body}
                          </div>
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
    </div>
  );
}
