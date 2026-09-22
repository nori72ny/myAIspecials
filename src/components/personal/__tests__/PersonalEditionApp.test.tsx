import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

const appProps = vi.fn();
vi.mock('../ResearchWorkspaceV31', () => ({
  default: ({ onSourcesChange }: { onSourcesChange?: (sources: unknown[]) => void }) => {
    React.useEffect(() => { onSourcesChange?.([{ id: 'S1', title: 'Verified source', url: 'https://example.com', domain: 'example.com', evidenceLevel: 'page-verified', freshness: 'recent', score: 90, scoreScope: 'retrieval-evidence-only', citation: '[S1]' }]); }, [onSourcesChange]);
    return <section aria-label="Research Workspace">Research test workspace</section>;
  },
}));
vi.mock('../CodingWorkspaceV31', () => ({
  default: ({ onProjectEvidenceChange }: { onProjectEvidenceChange?: (evidence: unknown) => void }) => {
    React.useEffect(() => { onProjectEvidenceChange?.({ jobId: 'coding-abcdefghijklmnopqrstuv', status: 'verified', changedPaths: ['src/a.ts'], verificationChecks: [{ kind: 'test', ok: true, exitCode: 0, timedOut: false, attempt: 1 }] }); }, [onProjectEvidenceChange]);
    return <section aria-label="Coding Job Workspace">Coding test workspace</section>;
  },
}));
vi.mock('../../CreativeWorkspaceV15', () => ({ default: () => <section aria-label="Creative Workspace">Creative test workspace</section> }));

vi.mock('../../../App', () => ({
  default: (props: Record<string, unknown>) => {
    appProps(props);
    return <div data-testid="mock-origin-app" className="origin-app"><div className="origin-composer"><textarea aria-label="Mock composer" /></div></div>;
  },
  ArtifactWorkspace: ({ artifact, isOpen, onClose }: { artifact: { title: string }; isOpen: boolean; onClose: () => void }) => isOpen ? <aside aria-label="成果物ワークスペース"><p>{artifact.title}</p><button type="button" onClick={onClose}>会話に戻る</button></aside> : null,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); document.body.style.overflow = ''; });

describe('PersonalEditionApp production wrapper', () => {
  it('keeps Chat conversation-first with one header, Composer Mode, and no permanent Project row', () => {
    render(<PersonalEditionApp />);

    expect(screen.getByRole('region', { name: 'ORIGIN workspace shell' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Mode' })).toBeNull();
    expect(screen.queryByLabelText('Workspace mode')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
    expect(screen.queryByText('Current workspace')).toBeNull();
    const composerMode = screen.getByLabelText('Composer mode') as HTMLSelectElement;
    expect(composerMode.value).toBe('chat');
    expect(Array.from(composerMode.options).map((option) => option.textContent)).toEqual(['Chat', 'Research', 'Code', 'Create']);
    expect(screen.getByLabelText('ORIGIN Auto settings')).toBeTruthy();
  });

  it('opens Research from the Composer and preserves the chat mount', async () => {
    render(<PersonalEditionApp />);
    const originalChat = screen.getByTestId('mock-origin-app');
    fireEvent.change(screen.getByLabelText('Composer mode'), { target: { value: 'research' } });
    expect(await screen.findByRole('region', { name: 'Research Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=research');
    expect(originalChat.closest('[hidden]')).toBeTruthy();
    expect((screen.getByLabelText('Workspace mode') as HTMLSelectElement).value).toBe('research');
    fireEvent.change(screen.getByLabelText('Workspace mode'), { target: { value: 'chat' } });
    expect(screen.getByTestId('mock-origin-app')).toBe(originalChat);
    expect(originalChat.closest('[hidden]')).toBeNull();
    expect((screen.getByLabelText('Composer mode') as HTMLSelectElement).value).toBe('chat');
  });

  it('opens Code and Create without reintroducing a top Mode row', async () => {
    render(<PersonalEditionApp />);
    fireEvent.change(screen.getByLabelText('Composer mode'), { target: { value: 'coding' } });
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Mode' })).toBeNull();
    expect(screen.getByLabelText('Agent 実行可能')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Workspace mode'), { target: { value: 'creative' } });
    expect(await screen.findByRole('region', { name: 'Creative Workspace' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Mode' })).toBeNull();
  });

  it('supports direct workspace links and browser history', async () => {
    window.history.replaceState(null, '', '/?workspace=research');
    render(<PersonalEditionApp />);
    expect(await screen.findByRole('region', { name: 'Research Workspace' })).toBeTruthy();
    expect((screen.getByLabelText('Workspace mode') as HTMLSelectElement).value).toBe('research');

    window.history.replaceState(null, '', '/?workspace=coding');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect((screen.getByLabelText('Workspace mode') as HTMLSelectElement).value).toBe('coding');

    window.history.replaceState(null, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.queryByLabelText('Workspace mode')).toBeNull();
    expect((screen.getByLabelText('Composer mode') as HTMLSelectElement).value).toBe('chat');
  });

  it('mounts the shared App with the Personal settings boundary', () => {
    const onOpenSettings = vi.fn();
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} onOpenSettings={onOpenSettings} />);

    expect(appProps).toHaveBeenCalled();
    const props = appProps.mock.calls[0][0];
    expect(props.onOpenSettings).toBe(onOpenSettings);
    expect(props.language).toBe(DEFAULT_PERSONAL_SETTINGS.language);
    expect(props.designTheme).toBe(DEFAULT_PERSONAL_SETTINGS.designTheme);
    expect(props.messages).toEqual([]);
    expect(props.sessions).toEqual([]);
  });

  it('hydrates artifacts without restoring the removed top Artifact status row', () => {
    const { rerender } = render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={[]} artifacts={[]} />);
    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'モバイルChat表示' })).toBeNull();

    const restoredMessages = [{ id: 'u-restored', role: 'user' as const, content: '再読込後の相談' }];
    const restoredArtifacts = [{ id: 'a-restored', type: 'markdown' as const, title: '復元資料', language: 'markdown', content: '# 復元', isComplete: true }];
    rerender(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={restoredMessages} artifacts={restoredArtifacts} />);

    expect(screen.queryByRole('region', { name: 'Artifact layer' })).toBeNull();
    expect(screen.getByRole('tablist', { name: 'モバイルChat表示' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('region', { name: 'Artifact history' }).textContent).toContain('復元資料');
  });

  it('opens and closes an artifact through the mobile Conversation / Artifact tabs', () => {
    const artifacts = [{ id: 'a-mobile', type: 'markdown' as const, title: 'モバイル成果物', language: 'markdown', content: '# Mobile', isComplete: true }];
    render(<PersonalEditionApp artifacts={artifacts} />);

    const conversation = screen.getByRole('tab', { name: '会話' });
    const artifact = screen.getByRole('tab', { name: '成果物' });
    expect(conversation.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(artifact);
    expect(screen.getByRole('complementary', { name: '成果物ワークスペース' }).textContent).toContain('モバイル成果物');
    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(conversation.getAttribute('aria-selected')).toBe('true');
  });

  it('opens an exact artifact from the global drawer while keeping Chat mounted for desktop split view', () => {
    const artifacts = [
      { id: 'a-1', type: 'markdown' as const, title: 'First artifact', language: 'markdown', content: '# First', isComplete: true },
      { id: 'a-2', type: 'markdown' as const, title: 'Second artifact', language: 'markdown', content: '# Second', isComplete: true },
    ];
    render(<PersonalEditionApp artifacts={artifacts} />);
    const originalChat = screen.getByTestId('mock-origin-app');

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const artifactHistory = screen.getByRole('region', { name: 'Artifact history' });
    fireEvent.click(within(artifactHistory).getByRole('button', { name: /First artifact/ }));

    expect(originalChat.closest('[hidden]')).toBeNull();
    expect(screen.getByRole('complementary', { name: '成果物ワークスペース' }).textContent).toContain('First artifact');
    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(screen.queryByRole('complementary', { name: '成果物ワークスペース' })).toBeNull();
    expect(originalChat.closest('[hidden]')).toBeNull();
  });

  it('keeps Project navigation absent from the primary viewport when no evidence exists', () => {
    render(<PersonalEditionApp />);
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Project navigation' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.queryByRole('region', { name: 'Project navigation' })).toBeNull();
  });

  it('surfaces validated Research Sources only inside the drawer and selected contextual panel', async () => {
    render(<PersonalEditionApp />);
    fireEvent.change(screen.getByLabelText('Composer mode'), { target: { value: 'research' } });
    expect(await screen.findByRole('region', { name: 'Research Workspace' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const project = await screen.findByRole('region', { name: 'Project navigation' });
    expect(project.textContent).toContain('Sources');
    expect(project.textContent).not.toContain('Overview');
    fireEvent.click(within(project).getByRole('button', { name: /Sources/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.getByRole('region', { name: 'Project Sources' }).textContent).toContain('Verified source');
  });

  it('surfaces grounded Coding Files and Tasks only inside the drawer', async () => {
    render(<PersonalEditionApp />);
    fireEvent.change(screen.getByLabelText('Composer mode'), { target: { value: 'coding' } });
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const project = await screen.findByRole('region', { name: 'Project navigation' });
    expect(project.textContent).toContain('Files');
    expect(project.textContent).toContain('Tasks');
    expect(project.textContent).not.toContain('Chat');
    expect(project.textContent).not.toContain('Artifacts');

    fireEvent.click(within(project).getByRole('button', { name: /Files/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.getByRole('region', { name: 'Project Files' }).textContent).toContain('src/a.ts');
  });
});
