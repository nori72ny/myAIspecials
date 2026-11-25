import { ChevronRight } from 'lucide-react';
import type { OriginLanguage } from '../i18n';
import {
  orinPanelProgressText,
  projectOrinPanelRemaining,
  type OrinPanelAgentItem,
} from './orinPanelModel';
import { useOrinPanelRuns } from './useOrinPanelRuns';
import type { OrinPanelProps } from './OrinPanel';

/**
 * 「残っている依頼」ページ（オーナー指示 2026-11-25 17:14：
 * オリンパネルのタブから左サイドバーの項目＋専用ページへ移設。
 * 設計は ORIN_PANEL_EXPANSION_DESIGN_2026-11-25 §7 をそのまま適用）。
 *
 * 中身は runs 一覧の射影（projectOrinPanelRemaining）：未完了
 * （確認待ち・保留・失敗・実行中・送信待ち）だけを、対応の要る順
 * （あなたの番 → 止まっています → 作業中 → 送信待ち）に並べる。
 * 完了・キャンセル・期限切れは出さない。% は実測できる進み具合
 * （エージェントのステップ）がある時だけ付け、承認待ちには付けない。
 * 材料（前景の作業・送信キュー）はチャット画面と同じものを
 * PersonalEditionApp 経由で受け取る。runs の取得はパネルと共用の
 * useOrinPanelRuns（共有ストア。このページを開いている間だけ取り直す）。
 *
 * runs が引けない時（unavailable）は「残っている依頼はありません」
 * とは言わない（0件なのか分からないのかを混同しない）。取得中は
 * 読み込み中を出し、引けなければその旨を出す。前景・送信待ちの
 * 行は材料がある限り出し、runs 由来の行が欠けている可能性を注記する。
 */
export interface OrinRemainingPageProps {
  language: OriginLanguage;
  foregroundItems: OrinPanelProps['foregroundItems'];
  agentFallbackItem: OrinPanelProps['agentFallbackItem'];
  queuedRequests: OrinPanelProps['queuedRequests'];
  onOpenAgent?: () => void;
  onOpenChat?: () => void;
}

interface RemainingRow {
  id: string;
  title: string;
  statusText: string;
  progressText?: string;
  note?: string;
  nextStepText?: string;
  agentLink?: boolean;
  /** 送信待ちのチャット依頼：行のタップで会話へ戻る。 */
  chatLink?: boolean;
  pulsing: boolean;
}

export default function OrinRemainingPage({
  language,
  foregroundItems,
  agentFallbackItem,
  queuedRequests,
  onOpenAgent,
  onOpenChat,
}: OrinRemainingPageProps) {
  const ja = language !== 'en';
  const runsState = useOrinPanelRuns(true);
  const groups = runsState.kind === 'ready' ? runsState.groups : null;
  const remaining = groups ? projectOrinPanelRemaining(groups) : null;

  const agentRow = (item: OrinPanelAgentItem, extra: Partial<RemainingRow>): RemainingRow => ({
    id: item.runId,
    title: item.title,
    statusText: ja ? item.statusText.ja : item.statusText.en,
    progressText: item.progress ? orinPanelProgressText(item.progress, ja) : undefined,
    agentLink: true,
    pulsing: false,
    ...extra,
  });

  const yourTurnRows: RemainingRow[] = remaining
    ? remaining.yourTurn.map((item) => agentRow(item, {
      progressText: undefined,
      nextStepText: ja ? '計画を確認する' : 'Review the plan',
    }))
    : [];
  const stoppedRows: RemainingRow[] = remaining
    ? remaining.stopped.map((item) => agentRow(item, {
      note: item.note ? (ja ? item.note.ja : item.note.en) : undefined,
      nextStepText: item.status === 'held' ? undefined : (ja ? 'エージェント画面で見る' : 'Open the agent screen'),
    }))
    : [];
  const activeRows: RemainingRow[] = [];
  for (const item of foregroundItems) {
    activeRows.push({ id: item.id, title: item.title, statusText: ja ? '作業中' : 'Working', pulsing: true });
  }
  if (remaining) {
    for (const item of remaining.active) {
      activeRows.push(agentRow(item, { pulsing: true }));
    }
  } else if (agentFallbackItem) {
    const doneCount = agentFallbackItem.steps?.filter((step) => step.status === 'completed').length ?? 0;
    const total = agentFallbackItem.totalSteps;
    activeRows.push({
      id: 'agent-fallback',
      title: agentFallbackItem.title,
      statusText: ja ? '作業中' : 'Working',
      progressText: total > 0
        ? (ja
          ? `${Math.floor((doneCount / total) * 100)}%（${total}ステップ中 ${doneCount}つ完了）`
          : `${Math.floor((doneCount / total) * 100)}% (${doneCount} of ${total} steps done)`)
        : undefined,
      agentLink: true,
      pulsing: true,
    });
  }
  const queuedRows: RemainingRow[] = queuedRequests.map((queued) => ({
    id: `queue-${queued.id}`,
    title: queued.summary,
    statusText: ja ? '送信待ち' : 'Waiting to send',
    nextStepText: ja ? '会話で確認する' : 'Check in the conversation',
    chatLink: true,
    pulsing: false,
  }));

  const sections: Array<{ key: string; label: string; rows: RemainingRow[] }> = [
    { key: 'your-turn', label: ja ? 'あなたの番' : 'Your turn', rows: yourTurnRows },
    { key: 'stopped', label: ja ? '止まっています' : 'Stopped', rows: stoppedRows },
    { key: 'active', label: ja ? '作業中' : 'Working on it', rows: activeRows },
    { key: 'queued', label: ja ? '送信待ち' : 'Waiting to send', rows: queuedRows },
  ];
  const totalRows = sections.reduce((sum, section) => sum + section.rows.length, 0);

  const renderRow = (row: RemainingRow) => {
    const body = (
      <>
        <span className="origin-orin-panel__row-main">
          <span className="origin-orin-panel__row-head">
            <span aria-hidden="true" className={`origin-orin-panel__row-dot ${row.pulsing ? 'is-pulsing' : ''}`} />
            <span className="origin-orin-panel__row-title">{row.title}</span>
          </span>
          <span className="origin-orin-panel__row-sub">{row.statusText}</span>
          {row.progressText && <span className="origin-orin-panel__row-progress">{row.progressText}</span>}
          {row.note && <span className="origin-orin-panel__row-note">{row.note}</span>}
          {row.nextStepText && <span className="origin-orin-panel__row-next">{row.nextStepText}</span>}
        </span>
        {(row.agentLink || row.chatLink) && (
          <ChevronRight aria-hidden="true" size={16} className="origin-orin-panel__row-chevron" />
        )}
      </>
    );
    return (
      <li key={row.id}>
        {row.agentLink && onOpenAgent ? (
          <button type="button" data-testid="origin-remaining-row" onClick={onOpenAgent} className="origin-orin-panel__row-button">
            {body}
          </button>
        ) : row.chatLink && onOpenChat ? (
          <button type="button" data-testid="origin-remaining-row" onClick={onOpenChat} className="origin-orin-panel__row-button">
            {body}
          </button>
        ) : (
          <div data-testid="origin-remaining-row" className="origin-orin-panel__row-static">
            {body}
          </div>
        )}
      </li>
    );
  };

  return (
    <div data-testid="origin-remaining-page" className="origin-remaining-page mx-auto w-full max-w-[var(--content-reading)] px-4 py-6 sm:px-6">
      <h1 className="m-0 text-xl font-bold">{ja ? '残っている依頼' : 'Remaining requests'}</h1>
      <p className="origin-muted m-0 mt-2 text-sm leading-[1.7]">
        {ja
          ? 'まだ終わっていない依頼の一覧です。対応が必要なものから順に並んでいます。'
          : 'Requests that are not finished yet, in the order they need your attention.'}
      </p>
      {totalRows === 0 && runsState.kind === 'loading' ? (
        <div className="origin-orin-panel__empty-block">
          <p data-testid="origin-remaining-loading" className="origin-orin-panel__empty-line">
            {ja ? '読み込んでいます' : 'Loading…'}
          </p>
        </div>
      ) : totalRows === 0 && runsState.kind === 'unavailable' ? (
        <div className="origin-orin-panel__empty-block">
          <p data-testid="origin-remaining-unavailable" className="origin-orin-panel__empty-line">
            {ja ? '依頼の状況を読み込めませんでした' : 'Could not load the status of your requests.'}
          </p>
          <p className="origin-orin-panel__empty-sub">
            {ja ? '少し時間をおいて、開き直してください' : 'Please wait a moment and open this page again.'}
          </p>
        </div>
      ) : totalRows === 0 ? (
        <div className="origin-orin-panel__empty-block">
          <p data-testid="origin-remaining-empty" className="origin-orin-panel__empty-line">
            {ja ? '残っている依頼はありません' : 'No requests are left unfinished.'}
          </p>
          <p className="origin-orin-panel__empty-sub">
            {ja ? '終わった依頼は、オリンから開く「作業状況」で確認できます' : 'Finished requests are under "Work status" in the Orin panel.'}
          </p>
        </div>
      ) : (
        <>
          {runsState.kind === 'unavailable' && (
            <p data-testid="origin-remaining-unavailable-note" className="origin-orin-panel__row-sub">
              {ja ? 'エージェントの依頼は読み込めませんでした' : 'Agent requests could not be loaded.'}
            </p>
          )}
          {sections.map((section) => (section.rows.length > 0 ? (
            <section key={section.key} className="origin-orin-panel__section">
              <h2 className="origin-orin-panel__section-title">
                {section.label}
                <span className="origin-orin-panel__section-count">{ja ? `（${section.rows.length}件）` : ` (${section.rows.length})`}</span>
              </h2>
              <ul className="origin-orin-panel__rows">
                {section.rows.map(renderRow)}
              </ul>
            </section>
          ) : null))}
        </>
      )}
    </div>
  );
}
