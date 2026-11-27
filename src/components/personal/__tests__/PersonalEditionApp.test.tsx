import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

type MockAppProps = Record<string, unknown> & {
  onOpenAgent?: () => void;
  onOpenCoding?: (goal?: string) => void;
  onOpenCreative?: (request?: string) => void;
};

const appProps = vi.fn();
const codingProps = vi.fn();
vi.mock('../CodingWorkspaceV31', () => ({
  default: (props: { initialGoal?: string; onGoalChange?: (goal: string) => void }) => {
    codingProps(props);
    return <section aria-label="Coding Job Workspace">Coding test workspace{props.initialGoal ? `: ${props.initialGoal}` : ''}<button type="button" onClick={() => props.onGoalChange?.('編集した依頼文')}>下書きを書き戻す</button></section>;
  },
}));
vi.mock('../../CreativePanelV15', () => ({ default: ({ initialRequest, onClose }: { initialRequest?: string; onClose: () => void }) => <aside aria-label="Creative Panel">Creative test panel{initialRequest ? `: ${initialRequest}` : ''}<button type="button" onClick={onClose}>会話に戻る</button></aside> }));
vi.mock('../../AgentWorkspaceView', () => ({ default: () => <section aria-label="Agent Workspace">Agent test workspace</section> }));

vi.mock('../../../App', () => ({
  default: (props: MockAppProps) => {
    appProps(props);
    return <div data-testid="mock-origin-app">ORIGIN</div>;
  },
  // 履歴ドロワーはバッチ6（仕様A）でシェルのヘッダーへ移設された。
  // ここではトグルだけのスタブで置き、ドロワー本体の形状・復元の
  // 検証は実物を使う PersonalEditionApp.shell-header.test.tsx が担う。
  HistoryDrawer: () => <button type="button" data-testid="history-drawer-toggle">履歴</button>,
  ArtifactWorkspace: ({ artifact, isOpen, onClose }: { artifact: { title: string }; isOpen: boolean; onClose: () => void }) => isOpen ? <aside aria-label="作成物ワークスペース"><p>{artifact.title}</p><button type="button" onClick={onClose}>会話に戻る</button></aside> : null,
}));

function latestAppProps(): MockAppProps {
  return appProps.mock.calls.at(-1)?.[0] as MockAppProps;
}

function runAppAction(name: 'onOpenAgent' | 'onOpenCoding' | 'onOpenCreative') {
  act(() => latestAppProps()[name]?.());
}

afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });

describe('PersonalEditionApp single-surface wrapper', () => {
  it('starts as one chat surface without a permanent mode dashboard', () => {
    render(<PersonalEditionApp />);

    expect(screen.queryByRole('region', { name: 'ORIGIN workspace shell' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Mode' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();
    expect(screen.getByTestId('mock-origin-app')).toBeTruthy();
    const props = latestAppProps();
    // リサーチはチャット内モードになったため、画面遷移コールバックは
    // 存在しない（画面構成の見直し 2026-11-09）。
    expect(props.onOpenResearch).toBeUndefined();
    expect(typeof props.onOpenAgent).toBe('function');
    expect(typeof props.onOpenCoding).toBe('function');
    expect(typeof props.onOpenCreative).toBe('function');
    // 「詳細・作業状況」パネルは廃止したため、開くためのコールバックは渡らない。
    expect('onOpenDetails' in props).toBe(false);
  });

  it('opens Agent v3 from the chat action and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');

    runAppAction('onOpenAgent');
    expect(await screen.findByRole('region', { name: 'Agent Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=agent');
    expect(originalChat.closest('[hidden]')).toBeTruthy();
    expect(screen.getByTestId('origin-shell-header').textContent).toContain('エージェント');

    fireEvent.click(screen.getByTestId('sidebar-nav-chat'));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(screen.queryByRole('region', { name: 'Agent Workspace' })).toBeNull();
  });

  it('opens Code from the chat action and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');

    runAppAction('onOpenCoding');
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=coding');
    expect(originalChat.closest('[hidden]')).toBeTruthy();

    fireEvent.click(screen.getByTestId('sidebar-nav-chat'));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).toBeNull();
  });

  it('carries an explicit chat coding goal into the Coding workspace without starting execution', async () => {
    render(<PersonalEditionApp />);
    const goal = 'ログイン画面の入力チェックを修正して';

    act(() => latestAppProps().onOpenCoding?.(goal));

    const coding = await screen.findByRole('region', { name: 'Coding Job Workspace' });
    expect(coding.textContent).toContain(goal);
    expect(window.location.search).toBe('?workspace=coding');
  });

  // コード画面の未送信の依頼文は、チャットの未送信下書きと同じく
  // 画面を離れて戻っても消えない（UIUX 状態保持 2026-11-27）。画面側が
  // 離脱時に onGoalChange で書き戻した内容が、シェルの保持として
  // 次に開いたときの initialGoal になることを固定する。
  it('keeps the coding draft across leaving and returning to the Code workspace (UIUX state retention, 2026-11-27)', async () => {
    render(<PersonalEditionApp />);
    const goal = 'ログイン画面の入力チェックを修正して';

    act(() => latestAppProps().onOpenCoding?.(goal));
    expect((await screen.findByRole('region', { name: 'Coding Job Workspace' })).textContent).toContain(goal);

    // コード画面で依頼文を編集し、離脱時にシェルへ書き戻された状態を再現する。
    fireEvent.click(screen.getByRole('button', { name: '下書きを書き戻す' }));

    fireEvent.click(screen.getByTestId('sidebar-nav-chat'));
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).toBeNull();

    fireEvent.click(screen.getByTestId('sidebar-nav-coding'));
    const coding = await screen.findByRole('region', { name: 'Coding Job Workspace' });
    expect(coding.textContent).toContain('編集した依頼文');
    expect(coding.textContent).not.toContain(goal);
    expect(window.location.search).toBe('?workspace=coding');
  });

  // 引数なしでコード画面を開く（+メニューやパネル経由の画面遷移）では、
  // 保持中の下書きを消さない。新しい引き継ぎ文が来たときだけ置き換わる。
  it('does not wipe the retained coding draft when Code is opened without a new goal', async () => {
    render(<PersonalEditionApp />);

    act(() => latestAppProps().onOpenCoding?.('最初の依頼文'));
    expect((await screen.findByRole('region', { name: 'Coding Job Workspace' })).textContent).toContain('最初の依頼文');

    fireEvent.click(screen.getByTestId('sidebar-nav-chat'));
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).toBeNull();

    runAppAction('onOpenCoding');
    const coding = await screen.findByRole('region', { name: 'Coding Job Workspace' });
    expect(coding.textContent).toContain('最初の依頼文');
    expect(window.location.search).toBe('?workspace=coding');
  });

  // 「作る」は画面構成の移行（第3段）で専用画面から会話のそばのパネルに
  // なった。画面遷移（URL変更・チャットの非表示）は発生せず、パネルが
  // 会話の上に開くこと、閉じると会話だけに戻ることを固定する。
  it('opens Create as a panel beside the chat without navigation', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');

    runAppAction('onOpenCreative');
    expect(await screen.findByRole('complementary', { name: 'Creative Panel' })).toBeTruthy();
    expect(window.location.search).toBe('');
    expect(originalChat.closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(screen.queryByRole('complementary', { name: 'Creative Panel' })).toBeNull();
  });

  it('carries an explicit chat creative request into the Create panel without starting generation', async () => {
    render(<PersonalEditionApp />);
    const request = 'Creativeワークスペースで新商品のSNSカードを作って';

    act(() => latestAppProps().onOpenCreative?.(request));

    const creative = await screen.findByRole('complementary', { name: 'Creative Panel' });
    expect(creative.textContent).toContain(request);
    expect(window.location.search).toBe('');
  });

  it('does not reopen a retired workspace value on a fresh load', () => {
    window.history.replaceState(null, '', '/?workspace=creative');
    render(<PersonalEditionApp />);
    expect(screen.getByTestId('mock-origin-app')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Creative Panel' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();
  });

  it('restores only the sidebar pages from the URL on a fresh load (a reload keeps the open page)', async () => {
    // 再読み込みで URL の ?workspace= と表示が食い違う欠陥の固定
    // （2026-11-25 本番チェック）。復元するのはサイドバーの専用
    // ページ（ai-news / remaining）だけ。作業画面（agent / coding）は
    // オーナー指示 2026-11-09 のとおりチャットから始める。
    window.history.replaceState(null, '', '/?workspace=ai-news');
    render(<PersonalEditionApp />);
    expect(await screen.findByTestId('origin-ai-news-page')).toBeTruthy();
    expect(screen.getByTestId('sidebar-nav-ai-news').getAttribute('aria-current')).toBe('page');
    cleanup();

    window.history.replaceState(null, '', '/?workspace=remaining');
    render(<PersonalEditionApp />);
    expect(await screen.findByTestId('origin-remaining-page')).toBeTruthy();
    expect(screen.getByTestId('sidebar-nav-remaining').getAttribute('aria-current')).toBe('page');
    cleanup();

    window.history.replaceState(null, '', '/?workspace=agent');
    render(<PersonalEditionApp />);
    expect(screen.getByTestId('mock-origin-app')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();
  });

  it('starts on chat at load for a retired value and follows browser history without restoring a permanent mode bar', async () => {
    window.history.replaceState(null, '', '/?workspace=research');
    render(<PersonalEditionApp />);
    // ?workspace=research は廃止済みの値のため、チャットに着地する。
    expect(screen.getByTestId('mock-origin-app')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();

    fireEvent(window, new PopStateEvent('popstate'));
    // リサーチ専用画面は廃止されたため（2026-11-09）、旧 URL を踏んでも
    // ワークスペースは開かずチャットのままになる。
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();
    expect(screen.getByTestId('mock-origin-app')).toBeTruthy();

    window.history.replaceState(null, '', '/?workspace=agent');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('region', { name: 'Agent Workspace' })).toBeTruthy();
    expect(screen.getByTestId('origin-shell-header').textContent).toContain('エージェント');

    window.history.replaceState(null, '', '/?workspace=coding');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(screen.getByTestId('origin-shell-header').textContent).toContain('コード');

    // ?workspace=creative は移行で廃止された値のため、チャットに着地し、
    // ツールヘッダーも作るパネルも開かない。
    window.history.replaceState(null, '', '/?workspace=creative');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.getByTestId('mock-origin-app')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Creative Panel' })).toBeNull();

    window.history.replaceState(null, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Creative Panel' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Mode' })).toBeNull();
  });

  it('mounts the shared App with settings and progressive capability callbacks', () => {
    const onOpenSettings = vi.fn();
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} onOpenSettings={onOpenSettings} />);

    expect(appProps).toHaveBeenCalledOnce();
    const props = latestAppProps();
    expect(props.onOpenSettings).toBe(onOpenSettings);
    expect(props.language).toBe(DEFAULT_PERSONAL_SETTINGS.language);
    expect(props.designTheme).toBe(DEFAULT_PERSONAL_SETTINGS.designTheme);
    expect(props.messages).toEqual([]);
    expect(props.sessions).toEqual([]);
    expect(props.resetSignal).toBe(0);
    expect(props.embedded).toBe(true);
    expect(props.onOpenResearch).toBeUndefined();
    expect(typeof props.onOpenAgent).toBe('function');
    expect(typeof props.onOpenCoding).toBe('function');
    expect(typeof props.onOpenCreative).toBe('function');
    expect('onOpenDetails' in props).toBe(false);
  });

  it('restores parent-controlled messages and sessions into the shared production shell', () => {
    const messages = [{ id: 'u-1', role: 'user' as const, content: '既存の相談' }];
    const sessions = [{ id: 's-1', title: '既存', createdAt: 1, messages: [] }];
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={messages} sessions={sessions} />);

    const props = latestAppProps();
    expect(props.messages).toEqual(messages);
    expect(props.sessions).toEqual(sessions);
  });

  it('hydrates messages and shows the Artifact layer only after artifacts arrive', () => {
    const { rerender } = render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={[]} artifacts={[]} />);
    expect(screen.queryByRole('tab', { name: '成果物' })).toBeNull();

    const restoredMessages = [{ id: 'u-restored', role: 'user' as const, content: '再読込後の相談' }];
    const restoredArtifacts = [{ id: 'a-restored', type: 'markdown' as const, title: '復元資料', language: 'markdown', content: '# 復元', isComplete: true }];
    rerender(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={restoredMessages} artifacts={restoredArtifacts} />);

    const props = latestAppProps();
    expect(props.messages).toEqual(restoredMessages);
    expect(props.artifacts).toEqual(restoredArtifacts);
    // 作成物への導線はモバイルタブに出る（表示だけの帯は置かない）。
    expect(screen.getByRole('tab', { name: '成果物' })).toBeTruthy();
  });

  it('reopens the latest artifact through the mobile Conversation / Artifact tabs', () => {
    const artifacts = [{ id: 'a-mobile', type: 'markdown' as const, title: 'モバイル作成物', language: 'markdown', content: '# Mobile', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);

    const tabs = screen.getByRole('tablist', { name: 'モバイルChat表示' });
    const conversation = screen.getByRole('tab', { name: '会話' });
    const artifact = screen.getByRole('tab', { name: '成果物' });
    expect(tabs).toBeTruthy();
    expect(conversation.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(artifact);
    expect(artifact.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary', { name: '作成物ワークスペース' }).textContent).toContain('モバイル作成物');

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(conversation.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the Chat Artifact layer out of the Code workspace; the Create panel stays on the chat surface', async () => {
    const artifacts = [{ id: 'a-1', type: 'markdown' as const, title: '作成物', language: 'markdown', content: '# A', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);
    expect(screen.getByRole('tab', { name: '成果物' })).toBeTruthy();

    runAppAction('onOpenCoding');
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '成果物' })).toBeNull();
    fireEvent.click(screen.getByTestId('sidebar-nav-chat'));

    // 作るパネルはチャット画面の上に開くため、チャットの成果物レイヤーは
    // 残ったままになる（専用画面時代とは異なる、統合後の仕様）。
    runAppAction('onOpenCreative');
    expect(await screen.findByRole('complementary', { name: 'Creative Panel' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '成果物' })).toBeTruthy();
  });

  it('never renders the abolished Project details panel and keeps artifacts reachable from the chat surface', async () => {
    // 「詳細・作業状況」パネルは 2026-11-09 の画面構成再編で廃止した
    // （SCREEN_NECESSITY_REVIEW_2026-11-09.md：中身は全て他画面の複写で、
    // 出典はリサーチ結果、変更ファイルと作業状況はコード画面、
    // 作成物はチャットの成果物表示が発生元）。パネル経由で作成物を開く
    // 導線も廃止され、作成物はチャット側の表示（モバイルタブ等）から開く。
    const artifacts = [{ id: 'a-project', type: 'markdown' as const, title: 'Project artifact', language: 'markdown', content: '# Project', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);

    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
    expect('onOpenDetails' in latestAppProps()).toBe(false);

    // 「詳しく調べる」は専用画面を持たず、画面遷移用の開始関数も App へ
    // 渡らない（チャット内モードとして App 内部で処理される）。
    expect('onOpenResearch' in latestAppProps()).toBe(false);
    expect(screen.queryByRole('region', { name: 'Research Workspace' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
    // ワークスペース側のヘッダーにも詳細トグルは存在しない。
    expect(screen.queryByRole('button', { name: '詳細を開く' })).toBeNull();
    expect(screen.queryByRole('button', { name: '詳細を閉じる' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '成果物' }));
    expect(screen.getByRole('complementary', { name: '作成物ワークスペース' }).textContent).toContain('Project artifact');
  });

  it('never passes a Details opener to the chat, even after conversation evidence exists', () => {
    // 旧仕様では会話や作成物などの証拠ができると onOpenDetails が有効化
    // された。パネル廃止に伴い、証拠の有無にかかわらず渡らないことと、
    // パネルのビュー（Files／Tasks／Sources 等）が一切現れないことを固定する。
    const { rerender } = render(<PersonalEditionApp />);
    expect('onOpenDetails' in latestAppProps()).toBe(false);

    rerender(<PersonalEditionApp messages={[{ id: 'u-1', role: 'user', content: '確認済みの会話' }]} />);
    expect('onOpenDetails' in latestAppProps()).toBe(false);
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project Files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project Tasks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project Sources' })).toBeNull();
    expect(screen.queryByText(/必要な証拠や作成物ができた時だけ/)).toBeNull();
  });
});

describe('PersonalEditionApp sidebar shell (layout stage 1)', () => {
  // サイドバー段階1（レイアウト設計 2026-11-16 §4）：シェルに行き先だけを
  // 持つサイドバーを足す。履歴はまだ入れず、開閉状態も端末に保存しない。
  // jsdom の既定幅（1024px）ではサイドバーは閉じた状態から始まる。
  type SidebarAppProps = MockAppProps & { onToggleSidebar?: () => void; sidebarOpen?: boolean };

  function toggleSidebarFromChat() {
    const props = latestAppProps() as SidebarAppProps;
    act(() => props.onToggleSidebar?.());
  }

  it('passes the sidebar wiring to the chat and starts closed at narrow widths', () => {
    render(<PersonalEditionApp />);

    const props = latestAppProps() as SidebarAppProps;
    expect(typeof props.onToggleSidebar).toBe('function');
    expect(props.sidebarOpen).toBe(false);
    const sidebar = screen.getByTestId('origin-sidebar');
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    // 段階1では履歴をサイドバーへ入れない（現行の履歴ドロワーが担当）。
    expect(screen.queryByTestId('sidebar-history')).toBeNull();
    expect(screen.getByTestId('sidebar-nav-chat').getAttribute('aria-current')).toBe('page');
  });

  it('opens from the chat toggle and navigates to the Agent workspace', async () => {
    render(<PersonalEditionApp />);

    toggleSidebarFromChat();
    const props = latestAppProps() as SidebarAppProps;
    expect(props.sidebarOpen).toBe(true);
    expect(screen.getByTestId('origin-sidebar').getAttribute('aria-hidden')).toBe('false');

    fireEvent.click(screen.getByTestId('sidebar-nav-agent'));
    expect(await screen.findByRole('region', { name: 'Agent Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=agent');
    expect(screen.getByTestId('sidebar-nav-agent').getAttribute('aria-current')).toBe('page');
  });

  it('navigates to the AI news and remaining-requests pages from the sidebar', async () => {
    render(<PersonalEditionApp />);

    fireEvent.click(screen.getByTestId('sidebar-nav-ai-news'));
    expect(await screen.findByTestId('origin-ai-news-page')).toBeTruthy();
    expect(window.location.search).toBe('?workspace=ai-news');
    expect(screen.getByTestId('sidebar-nav-ai-news').getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByTestId('sidebar-nav-remaining'));
    expect(await screen.findByTestId('origin-remaining-page')).toBeTruthy();
    expect(window.location.search).toBe('?workspace=remaining');
    expect(screen.getByTestId('sidebar-nav-remaining').getAttribute('aria-current')).toBe('page');
  });

  it('starts a new conversation through the existing reset signal path', () => {
    render(<PersonalEditionApp />);
    expect(latestAppProps().resetSignal).toBe(0);

    fireEvent.click(screen.getByTestId('sidebar-new-conversation'));

    expect(latestAppProps().resetSignal).toBe(1);
    expect(window.location.search).toBe('');
  });

  it('opens settings from the sidebar footer', () => {
    const onOpenSettings = vi.fn();
    render(<PersonalEditionApp onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByTestId('sidebar-settings'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('closes with the in-sidebar close button', () => {
    render(<PersonalEditionApp />);
    toggleSidebarFromChat();
    expect((latestAppProps() as SidebarAppProps).sidebarOpen).toBe(true);

    fireEvent.click(screen.getByTestId('sidebar-close'));
    expect((latestAppProps() as SidebarAppProps).sidebarOpen).toBe(false);
    expect(screen.getByTestId('origin-sidebar').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('PersonalEditionApp unified shell header (design batch 6, spec A)', () => {
  it('renders one shell header on the chat surface with the history toggle and no screen title', () => {
    render(<PersonalEditionApp />);

    const headers = screen.getAllByTestId('origin-shell-header');
    expect(headers).toHaveLength(1);
    const header = headers[0]!;
    expect(header.querySelector('[data-testid="sidebar-toggle"]')).toBeTruthy();
    expect(header.querySelector('[data-testid="history-drawer-toggle"]')).toBeTruthy();
    // チャットでは画面タイトルを出さない（仕様A §2.2）。
    expect(header.textContent).not.toContain('エージェント');
    expect(header.textContent).not.toContain('残っている依頼');
    // 旧ツールヘッダーの region は廃止された。
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();
  });

  it('shows the workspace title as plain text (not a button) in the same single header', async () => {
    render(<PersonalEditionApp />);

    fireEvent.click(screen.getByTestId('sidebar-nav-ai-news'));
    expect(await screen.findByTestId('origin-ai-news-page')).toBeTruthy();

    const headers = screen.getAllByTestId('origin-shell-header');
    expect(headers).toHaveLength(1);
    expect(headers[0]!.textContent).toContain('AIニュース');
    // タイトルは地のテキストで、ボタンにはしない（仕様A §2.2）。
    expect(within(headers[0]!).queryByRole('button', { name: 'AIニュース' })).toBeNull();
    expect(headers[0]!.querySelector('[data-testid="history-drawer-toggle"]')).toBeTruthy();
  });

  it('toggles the sidebar from the shell header button', () => {
    render(<PersonalEditionApp />);

    const toggle = screen.getByTestId('origin-shell-header').querySelector('[data-testid="sidebar-toggle"]') as HTMLElement;
    fireEvent.click(toggle);

    expect((latestAppProps() as { sidebarOpen?: boolean }).sidebarOpen).toBe(true);
    expect(screen.getByTestId('origin-sidebar').getAttribute('aria-hidden')).toBe('false');
  });
});

describe('PersonalEditionApp sidebar image entry (design batch 6, spec B)', () => {
  type ImageAppProps = MockAppProps & {
    imagePanelSignal?: number;
    onImagePanelAvailabilityChange?: (state: { disabled: boolean; reason: 'generating' | 'editing' | 'offline' | null }) => void;
  };

  it('places the image entry fourth in the nav, as an action row without a selected state', () => {
    render(<PersonalEditionApp />);

    const nav = screen.getByTestId('origin-sidebar').querySelector('nav')!;
    const items = Array.from(nav.querySelectorAll('[data-testid^="sidebar-"]'));
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual([
      'sidebar-nav-chat',
      'sidebar-nav-agent',
      'sidebar-nav-coding',
      'sidebar-image',
      'sidebar-nav-ai-news',
      'sidebar-nav-remaining',
    ]);
    const image = screen.getByTestId('sidebar-image');
    expect(image.textContent).toContain('画像');
    // 画面ではないため、選択状態は付けない（仕様B §3.1）。
    expect(image.getAttribute('aria-current')).toBeNull();
    expect(image.className).toContain('origin-sidebar-item');
    expect(image.className).not.toContain('origin-nav-active');
  });

  it('switches to chat and signals the App to open the image panel', async () => {
    render(<PersonalEditionApp />);

    runAppAction('onOpenAgent');
    expect(await screen.findByRole('region', { name: 'Agent Workspace' })).toBeTruthy();
    expect((latestAppProps() as ImageAppProps).imagePanelSignal).toBe(0);

    fireEvent.click(screen.getByTestId('sidebar-image'));

    expect(window.location.search).toBe('');
    expect(screen.getByTestId('mock-origin-app').closest('[hidden]')).toBeNull();
    expect((latestAppProps() as ImageAppProps).imagePanelSignal).toBe(1);
  });

  it('disables the image entry with a reason while the App reports it unavailable', () => {
    render(<PersonalEditionApp />);
    const image = screen.getByTestId('sidebar-image') as HTMLButtonElement;
    expect(image.disabled).toBe(false);

    act(() => (latestAppProps() as ImageAppProps).onImagePanelAvailabilityChange?.({ disabled: true, reason: 'generating' }));
    expect(image.disabled).toBe(true);
    expect(image.getAttribute('title')).toBe('応答の生成中は使えません');

    act(() => (latestAppProps() as ImageAppProps).onImagePanelAvailabilityChange?.({ disabled: true, reason: 'offline' }));
    expect(image.disabled).toBe(true);
    expect(image.getAttribute('title')).toBe('オフラインのため使えません');

    act(() => (latestAppProps() as ImageAppProps).onImagePanelAvailabilityChange?.({ disabled: false, reason: null }));
    expect(image.disabled).toBe(false);
  });
});
