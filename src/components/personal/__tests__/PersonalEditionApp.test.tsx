import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

const appProps = vi.fn();

vi.mock('../../../App', () => ({
  default: (props: Record<string, unknown>) => {
    appProps(props);
    return <div data-testid="mock-origin-app">ORIGIN</div>;
  },
}));

afterEach(() => vi.clearAllMocks());

describe('PersonalEditionApp production wrapper', () => {
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
    expect(props.artifacts).toEqual([]);
    expect(props.resetSignal).toBe(0);
  });

  it('passes hydrated conversation and session state through without dropping it', () => {
    const messages = [{ id: 'u-1', role: 'user' as const, content: '既存の相談' }];
    const sessions = [{ id: 's-1', title: '既存', createdAt: 1, messages }];
    const artifacts = [{ id: 'a-1', type: 'markdown' as const, title: '企画', language: 'markdown', content: '# 企画', isComplete: true }];
    const onArchiveSession = vi.fn();
    const onRestoreSession = vi.fn();
    const onMessagesChange = vi.fn();
    const onArtifactsChange = vi.fn();

    render(
      <PersonalEditionApp
        settings={DEFAULT_PERSONAL_SETTINGS}
        messages={messages}
        sessions={sessions}
        artifacts={artifacts}
        onArchiveSession={onArchiveSession}
        onRestoreSession={onRestoreSession}
        onMessagesChange={onMessagesChange}
        onArtifactsChange={onArtifactsChange}
        resetSignal={7}
      />,
    );

    const props = appProps.mock.calls[0][0];
    expect(props.messages).toBe(messages);
    expect(props.sessions).toBe(sessions);
    expect(props.artifacts).toBe(artifacts);
    expect(props.onArchiveSession).toBe(onArchiveSession);
    expect(props.onRestoreSession).toBe(onRestoreSession);
    expect(props.onMessagesChange).toBe(onMessagesChange);
    expect(props.onArtifactsChange).toBe(onArtifactsChange);
    expect(props.resetSignal).toBe(7);
  });

  it('renders the shared ORIGIN application surface', () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);
    expect(document.querySelector('[data-testid="mock-origin-app"]')?.textContent).toBe('ORIGIN');
  });
});
