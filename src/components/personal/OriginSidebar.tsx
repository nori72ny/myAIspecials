import { Bot, CodeXml, ImagePlus, ListTodo, MessageSquare, Newspaper, PanelLeftClose, Plus, Settings } from 'lucide-react';
import OriginBrandLockup from '../OriginBrandLockup';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceModeV31';

/**
 * サイドバー（レイアウト設計 2026-11-16 の段階1：シェルの導入）。
 *
 * 置き場所は PersonalEditionApp のシェル階層で、中身は行き先だけに絞る：
 * ブランド／新しい会話／チャット・エージェント・コード／AIニュース・
 * 残っている依頼／設定。「AIニュース」と「残っている依頼」は
 * 2026-11-25 のオーナー指示でオリンパネルのタブから移設された。
 * 履歴はまだ入れない（シェルの統一ヘッダーの履歴ドロワーが担う）。
 * 「画像」は行き先（画面）としては置かず、「新しい会話」「設定」と
 * 同じ操作行として置く（デザイン是正バッチ6、仕様B。オーナー決定
 * 2026-11-12 の「画像生成は行き先ではない」は、画面として置かない
 * という意味で維持する）。押すとチャットへ遷移して画像生成パネルを
 * 開く。専用画面は作らない。
 *
 * 方式は幅で切り替える：1,024px 以上はプッシュ式（メイン領域が狭まる）、
 * 未満は左から重なるドロワー＋スクリム。開閉状態の端末内保存と、PC で
 * 開いたときのオリンの中央位置の調整は段階3で扱う。
 */
type OriginSidebarProps = {
  open: boolean;
  workspace: OriginWorkspaceModeV31;
  isEn: boolean;
  onClose: () => void;
  onNavigate: (mode: OriginWorkspaceModeV31) => void;
  onNewConversation: () => void;
  onOpenSettings?: () => void;
  onOpenImagePanel: () => void;
  /** ＋メニューの「画像生成」と同一の無効条件（App から通知される）。 */
  imageUnavailableReason?: 'generating' | 'editing' | 'offline' | null;
};

const NAV_ITEMS: ReadonlyArray<{
  mode: OriginWorkspaceModeV31;
  ja: string;
  en: string;
  Icon: typeof MessageSquare;
}> = [
  { mode: 'chat', ja: 'チャット', en: 'Chat', Icon: MessageSquare },
  { mode: 'agent', ja: 'エージェント', en: 'Agent', Icon: Bot },
  { mode: 'coding', ja: 'コード', en: 'Code', Icon: CodeXml },
  { mode: 'ai-news', ja: 'AIニュース', en: 'AI news', Icon: Newspaper },
  { mode: 'remaining', ja: '残っている依頼', en: 'Remaining requests', Icon: ListTodo },
];

export default function OriginSidebar({
  open,
  workspace,
  isEn,
  onClose,
  onNavigate,
  onNewConversation,
  onOpenSettings,
  onOpenImagePanel,
  imageUnavailableReason,
}: OriginSidebarProps) {
  const imageDisabled = imageUnavailableReason === 'generating' || imageUnavailableReason === 'editing' || imageUnavailableReason === 'offline';
  const imageDisabledTitle = imageUnavailableReason === 'generating'
    ? (isEn ? 'Unavailable while a response is being generated' : '応答の生成中は使えません')
    : imageUnavailableReason === 'editing'
      ? (isEn ? 'Unavailable while an image is being edited' : '画像の編集中は使えません')
      : imageUnavailableReason === 'offline'
        ? (isEn ? 'Unavailable while offline' : 'オフラインのため使えません')
        : undefined;
  const renderNavItem = ({ mode, ja, en, Icon }: (typeof NAV_ITEMS)[number]) => {
    const active = workspace === mode;
    return (
      <button
        key={mode}
        type="button"
        data-testid={`sidebar-nav-${mode}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => onNavigate(mode)}
        className={`${
          active ? 'origin-nav-active' : 'origin-sidebar-item'
        } flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm`}
      >
        <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
        {isEn ? en : ja}
      </button>
    );
  };
  return (
    <>
      {open && (
        <button
          type="button"
          data-testid="sidebar-scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onClose}
          className="origin-sidebar-scrim fixed inset-0 z-40 lg:hidden"
        />
      )}
      <aside
        data-testid="origin-sidebar"
        aria-label={isEn ? 'Sidebar' : 'サイドバー'}
        aria-hidden={!open}
        inert={!open}
        data-open={open}
        className={`origin-sidebar-safe-area origin-sidebar fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-origin-border lg:static lg:z-auto lg:shrink-0 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full lg:-ml-[280px]'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <OriginBrandLockup />
          <button
            type="button"
            data-testid="sidebar-close"
            aria-label={isEn ? 'Close sidebar' : 'サイドバーを閉じる'}
            onClick={onClose}
            // Desktop keeps ONE sidebar toggle (external evaluation
            // fix, 2026-11-25): at lg the sidebar is a static column
            // and the main header's own toggle stays visible next to
            // it, so this close button only serves the drawer forms
            // below lg, where the header toggle sits under the
            // drawer and its scrim.
            className="origin-sidebar-item inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center lg:hidden"
          >
            <PanelLeftClose aria-hidden="true" size={18} strokeWidth={1.9} />
          </button>
        </div>

        <div className="px-3 py-2">
          <button
            type="button"
            data-testid="sidebar-new-conversation"
            onClick={onNewConversation}
            className="origin-sidebar-item flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm"
          >
            <Plus aria-hidden="true" size={18} strokeWidth={1.9} />
            {isEn ? 'New conversation' : '新しい会話'}
          </button>
        </div>

        <nav aria-label={isEn ? 'Switch screen' : '画面切り替え'} className="flex flex-col gap-1 px-3 py-1">
          {NAV_ITEMS.slice(0, 3).map(renderNavItem)}
          {/* 画像（仕様B）：作業の入口としてコードの次に置く操作行。
              画面ではないため選択状態（aria-current／origin-nav-active）
              は付けない。無効条件は＋メニューの「画像生成」と同一で、
              理由は title で示す（透明度で落とす一律処理はしない）。 */}
          <button
            type="button"
            data-testid="sidebar-image"
            disabled={imageDisabled}
            title={imageDisabledTitle}
            onClick={onOpenImagePanel}
            className="origin-sidebar-item flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm disabled:cursor-not-allowed"
          >
            <ImagePlus aria-hidden="true" size={18} strokeWidth={1.9} />
            {isEn ? 'Image' : '画像'}
          </button>
          {NAV_ITEMS.slice(3).map(renderNavItem)}
        </nav>

        <div className="mt-auto px-3 pb-1 pt-2">
          <button
            type="button"
            data-testid="sidebar-settings"
            onClick={onOpenSettings}
            className="origin-sidebar-item flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm"
          >
            <Settings aria-hidden="true" size={18} strokeWidth={1.9} />
            {isEn ? 'Settings' : '設定'}
          </button>
        </div>
      </aside>
    </>
  );
}
