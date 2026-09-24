import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

type MockAppProps = Record<string, unknown> & {
  onOpenResearch?: () => void;
  onOpenCoding?: () => void;
  onOpenCreative?: () => void;
  onOpenDetails?: () => void;
};

const appProps = vi.fn();
vi.mock('../ResearchWorkspaceV31', () => ({ default: () => <section aria-label="Research Workspace">Research test workspace</section> }));
vi.mock('../CodingWorkspaceV31', () => ({ default: () => <section aria-label="Coding Job Workspace">Coding test workspace</section> }));
vi.mock('../../CreativeWorkspaceV15', () => ({ default: () => <section aria-label="Creative Workspace">Creative test workspace</section> }));

vi.mock('../../../App', () => ({
  default: (props: MockAppProps) => {
    appProps(props);
    return <div data-testid="mock-origin-app">ORIGIN</div>;
  },
  ArtifactWorkspace: ({ artifact, isOpen, onClose }: { artifact: { title: string }; isOpen: boolean; onClose: () => void }) => isOpen ? <aside aria-label="成果物ワークスペース"><p>{artifact.title}</p><button type="button" onClick={onClose}>会話に戻る</button></aside> : null,
}));

function latestAppProps(): MockAppProps {
  return appProps.mock.calls.at(-1)?.[0] as MockAppProps;
}

function runAppAction(name: 'onOpenResearch' | 'onOpenCoding' | 'onOpenCreative' | 'onOpenDetails') {
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
    expect(typeof props.onOpenResearch).toBe('function');
    expect(typeof props.onOpenCoding).toBe('function');
    expect(typeof props.onOpenCreative).toBe('function');
    expect(typeof props.onOpenDetails).toBe('function');
  });

  it('opens Research from the chat action and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');

    runAppAction('onOpenResearch');
    expect(await screen.findByRole('region', { name: 'Research Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=research');
    expect(originalChat.closest('[hidden]')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Workspace tool header' }).textContent).toContain('調べる');

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(originalChat.closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Research Workspace' })).toBeNull();
  });

  it('opens Code from the chat action and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');

    runAppAction('onOpenCoding');
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=coding');
    expect(originalChat.closest('[hidden]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).toBeNull();
  });

  it('opens Create from the chat action and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');

    runAppAction('onOpenCreative');
    expect(await screen.findByRole('region', { name: 'Creative Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=creative');
    expect(originalChat.closest('[hidden]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(screen.queryByRole('region', { name: 'Creative Workspace' })).toBeNull();
  });

  it('supports direct workspace links and browser history without restoring a permanent mode bar', async () => {
    window.history.replaceState(null, '', '/?workspace=research');
    render(<PersonalEditionApp />);
    expect(await screen.findByRole('region', { name: 'Research Workspace' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Workspace tool header' }).textContent).toContain('調べる');

    window.history.replaceState(null, '', '/?workspace=coding');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Workspace tool header' }).textContent).toContain('コード');

    window.history.replaceState(null, '', '/?workspace=creative');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('region', { name: 'Creative Workspace' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Workspace tool header' }).textContent).toContain('作る');

    window.history.replaceState(null, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.queryByRole('region', { name: 'Workspace tool header' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Creative Workspace' })).toBeNull();
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
    expect(typeof props.onOpenResearch).toBe('function');
    expect(typeof props.onOpenCoding).toBe('function');
    expect(typeof props.onOpenCreative).toBe('function');
    expect(typeof props.onOpenDetails).toBe('function');
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
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();

    const restoredMessages = [{ id: 'u-restored', role: 'user' as const, content: '再読込後の相談' }];
    const restoredArtifacts = [{ id: 'a-restored', type: 'markdown' as const, title: '復元資料', language: 'markdown', content: '# 復元', isComplete: true }];
    rerender(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={restoredMessages} artifacts={restoredArtifacts} />);

    const props = latestAppProps();
    expect(props.messages).toEqual(restoredMessages);
    expect(props.artifacts).toEqual(restoredArtifacts);
    const artifactLayer = screen.getByRole('region', { name: 'Artifact layer' });
    expect(artifactLayer.textContent).toContain('成果物');
    expect(artifactLayer.textContent).toContain('復元資料');
    expect(artifactLayer.textContent).toContain('完成');
  });

  it('reopens the latest artifact through the mobile Conversation / Artifact tabs', () => {
    const artifacts = [{ id: 'a-mobile', type: 'markdown' as const, title: 'モバイル成果物', language: 'markdown', content: '# Mobile', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);

    const tabs = screen.getByRole('tablist', { name: 'モバイルChat表示' });
    const conversation = screen.getByRole('tab', { name: '会話' });
    const artifact = screen.getByRole('tab', { name: '成果物' });
    expect(tabs).toBeTruthy();
    expect(conversation.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(artifact);
    expect(artifact.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary', { name: '成果物ワークスペース' }).textContent).toContain('モバイル成果物');

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(conversation.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the Chat Artifact layer out of Research, Code, and Create workspaces', async () => {
    const artifacts = [{ id: 'a-1', type: 'markdown' as const, title: '成果物', language: 'markdown', content: '# A', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);
    expect(screen.getByRole('region', { name: 'Artifact layer' })).toBeTruthy();

    runAppAction('onOpenResearch');
    expect(await screen.findByRole('region', { name: 'Research Workspace' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));

    runAppAction('onOpenCoding');
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));

    runAppAction('onOpenCreative');
    expect(await screen.findByRole('region', { name: 'Creative Workspace' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();
  });

  it('keeps Project details hidden until explicitly requested and shows only grounded views', async () => {
    const artifacts = [{ id: 'a-project', type: 'markdown' as const, title: 'Project artifact', language: 'markdown', content: '# Project', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);

    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
    runAppAction('onOpenDetails');
    expect(screen.getByRole('region', { name: 'Project Workspace' })).toBeTruthy();

    runAppAction('onOpenResearch');
    expect(await screen.findByRole('region', { name: 'Research Workspace' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '詳細を開く' }));
    fireEvent.click(screen.getByRole('button', { name: 'Project Artifacts' }));
    expect(window.location.search).toBe('?workspace=research');
    expect(screen.getByRole('complementary', { name: '成果物ワークスペース' }).textContent).toContain('Project artifact');
  });

  it('does not show empty Project Files, Tasks, or Sources until evidence exists', () => {
    render(<PersonalEditionApp />);
    runAppAction('onOpenDetails');

    expect(screen.queryByRole('button', { name: 'Project Files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project Tasks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project Sources' })).toBeNull();
    expect(screen.getByText(/必要な証拠や成果物ができた時だけ/)).toBeTruthy();
  });
});
