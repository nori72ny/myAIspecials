import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { PanelLeft } from 'lucide-react';
import App, { HistoryDrawer } from '../../App';
import OriginBrandLockup from '../OriginBrandLockup';
import OriginSidebar from './OriginSidebar';
import OrinAiNewsPage from '../OrinAiNewsPage';
import OrinRemainingPage from '../OrinRemainingPage';
import type { OrinPanelWorkState } from '../OrinPanel';
import { ArtifactWorkspace } from '../../App';
import type { ArtifactBlock, ConversationMessage, ConversationSession, OriginImagePanelAvailability } from '../../App';
import type { Settings } from '../../types';
import type { OriginWorkspaceModeV31 } from './OriginWorkspaceModeV31';

const CodingJobWorkspace = lazy(() => import('./CodingWorkspaceV31'));
const CreativePanel = lazy(() => import('../CreativePanelV15'));
const AgentWorkspace = lazy(() => import('../AgentWorkspaceView'));

type MobileChatSurface = 'conversation' | 'artifact';

function workspaceLocation(): OriginWorkspaceModeV31 {
  const workspace = new URLSearchParams(window.location.search).get('workspace');
  if (workspace === 'agent' || workspace === 'coding' || workspace === 'ai-news' || workspace === 'remaining') return workspace;
  return 'chat';
}

const WORKSPACE_TITLES: Record<Exclude<OriginWorkspaceModeV31, 'chat'>, { ja: string; en: string }> = {
  agent: { ja: 'エージェント', en: 'Agent' },
  coding: { ja: 'コード', en: 'Code' },
  'ai-news': { ja: 'AIニュース', en: 'AI news' },
  remaining: { ja: '残っている依頼', en: 'Remaining requests' },
};

type PersonalEditionAppProps = {
  settings?: Settings;
  onOpenSettings?: (section?: 'coding') => void;
  messages?: ConversationMessage[];
  sessions?: readonly ConversationSession[];
  artifacts?: readonly ArtifactBlock[];
  onArchiveSession?: (messages: readonly ConversationMessage[]) => void;
  onRestoreSession?: (session: ConversationSession) => void;
  onMessagesChange?: (messages: ConversationMessage[]) => void;
  onArtifactsChange?: (artifacts: ArtifactBlock[]) => void;
  resetSignal?: number;
};

const PersonalEditionApp = React.memo(function PersonalEditionApp({
  settings,
  onOpenSettings,
  messages: parentMessages,
  sessions: parentSessions,
  artifacts: parentArtifacts,
  onArchiveSession: parentOnArchiveSession,
  onRestoreSession: parentOnRestoreSession,
  onMessagesChange: parentOnMessagesChange,
  onArtifactsChange: parentOnArtifactsChange,
  resetSignal = 0,
}: PersonalEditionAppProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>(() => parentMessages ?? []);
  // 新規ロードの初期表示：作業画面（agent / coding 等）は従来どおり
  // チャットから始める（オーナー指示 2026-11-09、E2E が固定）。
  // ただしサイドバーの専用ページ（AIニュース／残っている依頼）だけは
  // URL から復元する — その方式のままだと、専用ページを再読み込み
  // したときに URL は ?workspace=ai-news のまま表示だけトップに
  // 戻る不整合が出たため（2026-11-25 本番チェックで実測）。
  // popstate の同期では従来どおり workspaceLocation が正本。
  const [workspace, setWorkspace] = useState<OriginWorkspaceModeV31>(() => {
    const initial = workspaceLocation();
    return initial === 'ai-news' || initial === 'remaining' ? initial : 'chat';
  });
  // コード画面の依頼文（引き継ぎ文＋未送信の編集）はシェルが保持する
  // （UIUX 状態保持 2026-11-27）。チャットの未送信下書きがシェルに
  // マウントされた App の状態として残るのと同じ流儀で、コード画面を
  // 離れて戻っても内容が消えないようにする。画面側は離脱時に最新の
  // 依頼文を onGoalChange で書き戻し、送信が受理されたら空になる。
  const [codingInitialGoal, setCodingInitialGoal] = useState('');
  // 「作る」は専用画面ではなく、会話のそばに開くパネルになった
  // （画面構成の移行・第3段）。null = 閉じている、文字列 = その依頼で開く。
  const [creativePanelRequest, setCreativePanelRequest] = useState<string | null>(null);
  const [mobileSurface, setMobileSurface] = useState<MobileChatSurface>('conversation');
  // サイドバー（レイアウト設計 2026-11-16 の段階1）。既定は幅 1,280px
  // 以上で開く（設計メモ §5 判断点1の推奨）。開閉状態の端末内保存は段階3。
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
  // サイドバーの「新しい会話」は、App 内部のリセット処理を既存の
  // resetSignal 経路で起動するための加算カウンタ（親からの resetSignal
  // の意味は変えず、変化したときだけ App がリセットする性質を使う）。
  const [newConversationSignal, setNewConversationSignal] = useState(0);
  // 「残っている依頼」ページの材料（前景の作業・送信キュー）は
  // チャット側（App）が持つため、変化した時だけ受け取って保持する。
  // App はチャット以外の画面でも hidden でマウントされたままなので、
  // ページを開いた時も最新の材料が揃っている。
  const [orinWorkState, setOrinWorkState] = useState<OrinPanelWorkState>({
    foregroundItems: [],
    agentFallbackItem: null,
    queuedRequests: [],
  });
  const isEn = settings?.language === 'en';

  useEffect(() => {
    const sync = () => {
      setWorkspace(workspaceLocation());
      setCreativePanelRequest(null);
      setMobileSurface('conversation');
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const switchWorkspace = (next: OriginWorkspaceModeV31) => {
    const url = new URL(window.location.href);
    if (next === 'chat') url.searchParams.delete('workspace');
    else url.searchParams.set('workspace', next);
    window.history.pushState(null, '', url);
    setCreativePanelRequest(null);
    setMobileSurface('conversation');
    setWorkspace(next);
  };

  const openCodingWorkspace = (goal?: string) => {
    // 引き継ぎ文が渡されたときだけ下書きを置き換える。引数なしの
    // 画面遷移（+メニューやオリンパネル経由）では、保持中の下書きを
    // 消さない（UIUX 状態保持 2026-11-27）。
    if (goal !== undefined) setCodingInitialGoal(goal.trim().slice(0, 4000));
    switchWorkspace('coding');
  };

  // 「作る」は画面遷移ではなく、会話のそばにパネルを開く（項目名は維持）。
  const openCreativePanel = (request?: string) => {
    setCreativePanelRequest(request?.trim().slice(0, 4000) ?? '');
  };

  const toggleSidebar = useCallback(() => setSidebarOpen((value) => !value), []);
  // ドロワー方式（1,024px 未満）では行き先を選んだらドロワーを閉じる。
  // プッシュ式（PC）では開いたままにする。
  const closeSidebarIfOverlay = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) setSidebarOpen(false);
  }, []);
  const handleSidebarNavigate = (mode: OriginWorkspaceModeV31) => {
    switchWorkspace(mode);
    closeSidebarIfOverlay();
  };
  const handleSidebarNewConversation = () => {
    switchWorkspace('chat');
    setNewConversationSignal((value) => value + 1);
    closeSidebarIfOverlay();
  };
  const handleSidebarOpenSettings = () => {
    onOpenSettings?.();
    closeSidebarIfOverlay();
  };
  // サイドバーの画像項目（デザイン是正バッチ6、仕様B）：チャットへ
  // 遷移し、画像生成パネルを開く要求を信号で App へ渡す。パネルの
  // 開閉状態と可否の材料は App 側にあるため、開く要求は信号、
  // 可否は App からの通知（onImagePanelAvailabilityChange）で受ける。
  const [imagePanelSignal, setImagePanelSignal] = useState(0);
  const [imagePanelAvailability, setImagePanelAvailability] = useState<OriginImagePanelAvailability>({ disabled: false, reason: null });
  const handleSidebarOpenImage = () => {
    switchWorkspace('chat');
    setImagePanelSignal((value) => value + 1);
    closeSidebarIfOverlay();
  };

  const [artifacts, setArtifacts] = useState<ArtifactBlock[]>(() => [...(parentArtifacts ?? [])]);
  useEffect(() => { if (parentMessages) setMessages(parentMessages); }, [parentMessages]);
  useEffect(() => { if (parentArtifacts) setArtifacts([...parentArtifacts]); }, [parentArtifacts]);

  const effectiveSessions = parentSessions ?? [];
  const latestArtifact = artifacts.at(-1) ?? null;
  const handleMessagesChange = useCallback((nextMessages: ConversationMessage[]) => { setMessages(nextMessages); parentOnMessagesChange?.(nextMessages); }, [parentOnMessagesChange]);
  const handleArtifactsChange = useCallback((nextArtifacts: ArtifactBlock[]) => { setArtifacts(nextArtifacts); parentOnArtifactsChange?.(nextArtifacts); }, [parentOnArtifactsChange]);
  const handleArtifactRevision = useCallback((next: ArtifactBlock) => {
    setArtifacts((current) => {
      const updated = current.map((artifact) => artifact.id === next.id ? next : artifact);
      parentOnArtifactsChange?.(updated);
      return updated;
    });
  }, [parentOnArtifactsChange]);
  // 「作る」パネルで生成された成果物を会話の成果物として取り込む。
  // 同じ検証済みバイト（同じID）の再生成は重複させず置き換える。
  const handleCreativeArtifactCreated = useCallback((next: ArtifactBlock) => {
    setArtifacts((current) => {
      const updated = current.some((artifact) => artifact.id === next.id)
        ? current.map((artifact) => artifact.id === next.id ? next : artifact)
        : [...current, next];
      parentOnArtifactsChange?.(updated);
      return updated;
    });
  }, [parentOnArtifactsChange]);
  const handleArchiveSession = useCallback((nextMessages: readonly ConversationMessage[]) => { parentOnArchiveSession?.(nextMessages); }, [parentOnArchiveSession]);
  const handleRestoreSession = useCallback((session: ConversationSession) => {
    const restored = session.messages.map((message) => ({ ...message }));
    setMessages(restored);
    parentOnRestoreSession?.(session);
    parentOnMessagesChange?.(restored);
  }, [parentOnMessagesChange, parentOnRestoreSession]);
  // シェルのヘッダーの履歴ドロワーからの復元（仕様A §2.2）：チャット
  // 以外の画面から復元した場合は、復元した会話が見えるようチャット
  // 画面へ遷移する。
  const handleHeaderRestoreSession = (session: ConversationSession) => {
    handleRestoreSession(session);
    if (workspace !== 'chat') switchWorkspace('chat');
  };

  return <div className="origin-personal-shell flex h-[100dvh] min-h-0 w-full overflow-hidden">
    <OriginSidebar open={sidebarOpen} workspace={workspace} isEn={isEn} onClose={() => setSidebarOpen(false)} onNavigate={handleSidebarNavigate} onNewConversation={handleSidebarNewConversation} onOpenSettings={onOpenSettings ? handleSidebarOpenSettings : undefined} onOpenImagePanel={handleSidebarOpenImage} imageUnavailableReason={imagePanelAvailability.reason} />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {workspace === 'chat' && <a href="#origin-main" className="origin-skip-link">{isEn ? 'Skip to main content' : 'メインコンテンツへスキップ'}</a>}
    {/* 統一ヘッダー（デザイン是正バッチ6、仕様A）：全画面でシェルが
        1部品を描画する。構成は「開閉ボタン＋ロゴ＋（画面タイトル）」
        と「履歴ボタン」で、画面ごとに変わるのはタイトルの有無と
        文言だけ。ロゴはサイドバーが 1024px 以上で開いている間は
        サイドバー最上部が担うため隠す（チャット側の現行規則を全画面
        へ拡張）。履歴ドロワーはこのヘッダーを基準に開く。 */}
    <header data-testid="origin-shell-header" className="origin-header relative flex min-h-14 shrink-0 items-center border-b px-3 backdrop-blur-md sm:px-4">
      <div className="flex w-full items-center gap-2">
        <button type="button" data-testid="sidebar-toggle" aria-label={sidebarOpen ? (isEn ? 'Close sidebar' : 'サイドバーを閉じる') : (isEn ? 'Open sidebar' : 'サイドバーを開く')} aria-expanded={sidebarOpen} onClick={toggleSidebar} className="origin-secondary-button inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap px-0 text-sm font-semibold"><PanelLeft aria-hidden="true" size={18} strokeWidth={1.9} /></button>
        <span className={sidebarOpen ? 'lg:hidden' : undefined}><OriginBrandLockup /></span>
        {workspace !== 'chat' && <span className="min-w-0 truncate text-sm font-bold">{isEn ? WORKSPACE_TITLES[workspace].en : WORKSPACE_TITLES[workspace].ja}</span>}
        <div className="ml-auto flex items-center gap-1 whitespace-nowrap sm:gap-2">
          <HistoryDrawer sessions={effectiveSessions} currentMessages={messages} onRestoreSession={handleHeaderRestoreSession} />
        </div>
      </div>
    </header>

    {workspace === 'chat' && latestArtifact && <div role="tablist" aria-label="モバイルChat表示" className="origin-surface-muted flex shrink-0 gap-2 border-b px-3 py-2 md:hidden">
      <button type="button" role="tab" aria-selected={mobileSurface === 'conversation'} onClick={() => setMobileSurface('conversation')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${mobileSurface === 'conversation' ? 'origin-primary-button' : 'origin-secondary-button'}`}>会話</button>
      <button type="button" role="tab" aria-selected={mobileSurface === 'artifact'} onClick={() => setMobileSurface('artifact')} className={`min-h-11 flex-1 rounded-lg border px-4 text-sm font-semibold ${mobileSurface === 'artifact' ? 'origin-primary-button' : 'origin-secondary-button'}`}>成果物</button>
    </div>}

    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="h-full min-h-0" hidden={workspace !== 'chat'}>
        <App
          embedded
          onOpenSettings={onOpenSettings}
          onOpenAgent={() => switchWorkspace('agent')}
          onOpenCoding={openCodingWorkspace}
          onOpenCreative={openCreativePanel}
          messages={messages}
          sessions={effectiveSessions}
          artifacts={artifacts}
          onArchiveSession={handleArchiveSession}
          onRestoreSession={handleRestoreSession}
          onMessagesChange={handleMessagesChange}
          onArtifactsChange={handleArtifactsChange}
          resetSignal={resetSignal + newConversationSignal}
          imagePanelSignal={imagePanelSignal}
          onImagePanelAvailabilityChange={setImagePanelAvailability}
          onOrinWorkStateChange={setOrinWorkState}
          onToggleSidebar={toggleSidebar}
          sidebarOpen={sidebarOpen}
          language={settings?.language ?? 'ja'}
          designTheme={settings?.designTheme ?? 'minimal'}
        />
      </div>

      {latestArtifact && <ArtifactWorkspace
        artifact={latestArtifact}
        artifacts={artifacts}
        isOpen={mobileSurface === 'artifact'}
        language={settings?.language ?? 'ja'}
        designTheme={settings?.designTheme ?? 'minimal'}
        isStreaming={false}
        onSteer={() => undefined}
        onClose={() => setMobileSurface('conversation')}
        onArtifactRevision={handleArtifactRevision}
      />}

      {workspace === 'agent' && <div className="h-full overflow-y-auto"><Suspense fallback={<p role="status">エージェントを読み込んでいます…</p>}><AgentWorkspace /></Suspense></div>}
      {workspace === 'coding' && <div className="h-full overflow-y-auto"><Suspense fallback={<p role="status">コード画面を読み込んでいます…</p>}><CodingJobWorkspace initialGoal={codingInitialGoal} onGoalChange={setCodingInitialGoal} onOpenSettings={onOpenSettings} /></Suspense></div>}
      {workspace === 'ai-news' && <div className="h-full overflow-y-auto"><OrinAiNewsPage language={settings?.language ?? 'ja'} /></div>}
      {workspace === 'remaining' && <div className="h-full overflow-y-auto"><OrinRemainingPage language={settings?.language ?? 'ja'} foregroundItems={orinWorkState.foregroundItems} agentFallbackItem={orinWorkState.agentFallbackItem} queuedRequests={orinWorkState.queuedRequests} onOpenAgent={() => switchWorkspace('agent')} onOpenChat={() => switchWorkspace('chat')} /></div>}
    </div>

    {workspace === 'chat' && creativePanelRequest !== null && <Suspense fallback={null}><CreativePanel initialRequest={creativePanelRequest} onClose={() => setCreativePanelRequest(null)} onArtifactCreated={handleCreativeArtifactCreated} /></Suspense>}
    </div>
  </div>;
});

export default PersonalEditionApp;
