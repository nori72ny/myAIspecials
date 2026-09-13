import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

const appProps = vi.fn();
vi.mock('../../CodingJobWorkspaceV14', () => ({ default: () => <section aria-label="Coding Job Workspace">Coding test workspace</section> }));

vi.mock('../../../App', () => ({
  default: (props: Record<string, unknown>) => {
    appProps(props);
    return <div data-testid="mock-origin-app">ORIGIN</div>;
  },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });

describe('PersonalEditionApp production wrapper', () => {
  it('opens Coding from the actual production wrapper and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');
    fireEvent.click(screen.getByRole('button', { name: 'Coding' }));
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=coding');
    expect(originalChat.closest('[hidden]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'チャット' }));
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(originalChat.closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).toBeNull();
  });

  it('supports a direct mobile link and browser history navigation', async () => {
    window.history.replaceState(null, '', '/?workspace=coding');
    render(<PersonalEditionApp />);
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    window.history.replaceState(null, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.getByRole('button', { name: 'チャット' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).toBeNull();
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

  it('hydrates messages and artifacts that arrive after IndexedDB finishes loading', () => {
    const { rerender } = render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={[]} artifacts={[]} />);
    const restoredMessages = [{ id: 'u-restored', role: 'user' as const, content: '再読込後の相談' }];
    const restoredArtifacts = [{ id: 'a-restored', type: 'markdown' as const, title: '復元資料', language: 'markdown', content: '# 復元', isComplete: true }];

    rerender(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={restoredMessages} artifacts={restoredArtifacts} />);

    const latestProps = appProps.mock.calls.at(-1)?.[0];
    expect(latestProps.messages).toEqual(restoredMessages);
    expect(latestProps.artifacts).toEqual(restoredArtifacts);
  });

  it('renders the shared ORIGIN application surface', () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);
    expect(document.querySelector('[data-testid="mock-origin-app"]')?.textContent).toBe('ORIGIN');
  });
});
