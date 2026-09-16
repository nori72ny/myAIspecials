import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

const appProps = vi.fn();
vi.mock('../../CodingJobWorkspaceV14', () => ({ default: () => <section aria-label="Coding Job Workspace">Coding test workspace</section> }));
vi.mock('../../CreativeWorkspaceV15', () => ({ default: () => <section aria-label="Creative Workspace">Creative test workspace</section> }));

vi.mock('../../../App', () => ({
  default: (props: Record<string, unknown>) => {
    appProps(props);
    return <div data-testid="mock-origin-app">ORIGIN</div>;
  },
  ArtifactWorkspace: ({ artifact, isOpen, onClose }: { artifact: { title: string }; isOpen: boolean; onClose: () => void }) => isOpen ? <aside aria-label="成果物ワークスペース"><p>{artifact.title}</p><button type="button" onClick={onClose}>会話に戻る</button></aside> : null,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });

describe('PersonalEditionApp production wrapper', () => {
  it('separates workspace, mode, model, tools, and agent concepts without exposing unavailable modes', () => {
    render(<PersonalEditionApp />);

    expect(screen.getByRole('region', { name: 'ORIGIN workspace shell' })).toBeTruthy();
    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('Personal')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Mode' })).toBeTruthy();
    expect(screen.getByLabelText('Model ORIGIN Auto')).toBeTruthy();
    expect(screen.getByLabelText('Tools 自動管理')).toBeTruthy();
    expect(screen.getByLabelText('Agent 通常応答')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();

    const research = screen.getByRole('button', { name: 'Research 準備中' }) as HTMLButtonElement;
    const work = screen.getByRole('button', { name: 'Work 準備中' }) as HTMLButtonElement;
    expect(research.disabled).toBe(true);
    expect(work.disabled).toBe(true);
  });

  it('opens Code from the Mode layer and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=coding');
    expect(originalChat.closest('[hidden]')).toBeTruthy();
    expect(screen.getByLabelText('Agent 実行可能')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(originalChat.closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).toBeNull();
  });

  it('opens Create from the Mode layer and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('region', { name: 'Creative Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=creative');
    expect(originalChat.closest('[hidden]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(originalChat.closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Creative Workspace' })).toBeNull();
  });

  it('supports existing direct workspace links and browser history navigation', async () => {
    window.history.replaceState(null, '', '/?workspace=coding');
    render(<PersonalEditionApp />);
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Code' }).getAttribute('aria-pressed')).toBe('true');

    window.history.replaceState(null, '', '/?workspace=creative');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('region', { name: 'Creative Workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' }).getAttribute('aria-pressed')).toBe('true');

    window.history.replaceState(null, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Creative Workspace' })).toBeNull();
  });

  it('mounts the shared App with the Personal settings boundary', () => {
    const onOpenSettings = vi.fn();
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} onOpenSettings={onOpenSettings} />);

    expect(appProps).toHaveBeenCalledOnce();
    const props = appProps.mock.calls[0][0];
    expect(props.onOpenSettings).toBe(onOpenSettings);
    expect(props.language).toBe(DEFAULT_PERSONAL_SETTINGS.language);
    expect(props.designTheme).toBe(DEFAULT_PERSONAL_SETTINGS.designTheme);
    expect(props.messages).toEqual([]);
    expect(props.sessions).toEqual([]);
    expect(props.resetSignal).toBe(0);
  });

  it('restores parent-controlled messages and sessions into the shared production shell', () => {
    const messages = [{ id: 'u-1', role: 'user' as const, content: '既存の相談' }];
    const sessions = [{ id: 's-1', title: '既存', createdAt: 1, messages: [] }];
    render(
      <PersonalEditionApp
        settings={DEFAULT_PERSONAL_SETTINGS}
        messages={messages}
        sessions={sessions}
      />,
    );

    const props = appProps.mock.calls[0][0];
    expect(props.messages).toEqual(messages);
    expect(props.sessions).toEqual(sessions);
  });

  it('hydrates messages and shows the Artifact layer only after artifacts arrive', () => {
    const { rerender } = render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={[]} artifacts={[]} />);
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();

    const restoredMessages = [{ id: 'u-restored', role: 'user' as const, content: '再読込後の相談' }];
    const restoredArtifacts = [{ id: 'a-restored', type: 'markdown' as const, title: '復元資料', language: 'markdown', content: '# 復元', isComplete: true }];

    rerender(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={restoredMessages} artifacts={restoredArtifacts} />);

    const latestProps = appProps.mock.calls.at(-1)?.[0];
    expect(latestProps.messages).toEqual(restoredMessages);
    expect(latestProps.artifacts).toEqual(restoredArtifacts);
    const artifactLayer = screen.getByRole('region', { name: 'Artifact layer' });
    expect(artifactLayer.textContent).toContain('Artifact');
    expect(artifactLayer.textContent).toContain('1件');
    expect(artifactLayer.textContent).toContain('復元資料');
    expect(artifactLayer.textContent).toContain('Ready');
  });

  it('reopens the latest artifact through the mobile Conversation / Artifact tabs', () => {
    const artifacts = [{ id: 'a-mobile', type: 'markdown' as const, title: 'モバイル成果物', language: 'markdown', content: '# Mobile', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);

    const tabs = screen.getByRole('tablist', { name: 'モバイルChat表示' });
    const conversation = screen.getByRole('tab', { name: '会話' });
    const artifact = screen.getByRole('tab', { name: '成果物' });
    expect(tabs).toBeTruthy();
    expect(conversation.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('complementary', { name: '成果物ワークスペース' })).toBeNull();

    fireEvent.click(artifact);
    expect(artifact.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary', { name: '成果物ワークスペース' }).textContent).toContain('モバイル成果物');

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(conversation.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('complementary', { name: '成果物ワークスペース' })).toBeNull();
  });

  it('keeps the Chat Artifact layer out of Code and Create modes', async () => {
    const artifacts = [{ id: 'a-1', type: 'markdown' as const, title: '成果物', language: 'markdown', content: '# A', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);
    expect(screen.getByRole('region', { name: 'Artifact layer' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'モバイルChat表示' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('region', { name: 'Creative Workspace' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'モバイルChat表示' })).toBeNull();
  });

  it('renders the shared ORIGIN application surface', () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);
    expect(document.querySelector('[data-testid="mock-origin-app"]')?.textContent).toBe('ORIGIN');
  });
});
