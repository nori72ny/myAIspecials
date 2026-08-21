// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { applyDirectTouchEdits, App, ArtifactWorkspace, createOfflineArtifactBundle, type ArtifactBlock, type ConversationSession } from './App';

const artifact: ArtifactBlock = {
  id: 'artifact-1', type: 'html', language: 'html', title: 'Safe preview',
  content: '<main><button>Ready</button></main>', isComplete: true,
};

describe('ArtifactWorkspace action bar and sandbox runtime boundary', () => {
  afterEach(cleanup);

  it('renders the four explicit artifact actions with 44px minimum targets', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    for (const id of ['artifact-action-copy', 'artifact-action-save', 'artifact-action-share', 'artifact-action-edit']) {
      expect(screen.getByTestId(id).className).toContain('min-h-11');
    }
    expect(screen.getByRole('button', { name: '成果物を共有' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Canvas Direct Touchで編集' })).toBeTruthy();
  });

  it('isolates a sandbox runtime error and restores the last known good revision', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを表示' }));
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'ready', timestamp: Date.now() } })));
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'runtime-error', message: 'broken widget' } })));
    expect(screen.getByTestId('sandbox-runtime-boundary').textContent).toContain('Sandbox内で実行時エラーを検知しました。');
    fireEvent.click(screen.getByTestId('restore-last-known-good'));
    expect(screen.queryByTestId('sandbox-runtime-boundary')).toBeNull();
    expect((screen.getByTitle('プレビュー') as HTMLIFrameElement).srcdoc).toContain('Ready');
  });

  it('rejects forged cross-window messages and never confirms last-known-good from iframe load alone', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを表示' }));
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    fireEvent.load(frame);
    act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'runtime-error', message: 'forged error', timestamp: Date.now() } })));
    expect(screen.queryByTestId('sandbox-runtime-boundary')).toBeNull();
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'runtime-error', message: 'real error', timestamp: Date.now() } })));
    expect(screen.getByTestId('restore-last-known-good')).toHaveProperty('disabled', true);
  });

  it('switches responsive preview widths and routes presentation arrow keys into the active sandbox', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを表示' }));
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    fireEvent.click(screen.getByTestId('preview-viewport-375'));
    expect(frame.style.width).toBe('375px');
    expect(screen.getByTestId('preview-viewport-375').textContent).toContain('375px');
    fireEvent.click(screen.getByTestId('preview-viewport-768'));
    expect(frame.style.width).toBe('768px');
    fireEvent.click(screen.getByTestId('preview-viewport-fluid'));
    expect(frame.style.width).toBe('100%');
    fireEvent.click(screen.getByTestId('presentation-mode-toggle'));
    expect(screen.getByTestId('presentation-mode-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(frame.srcdoc).toContain('var presenting=true');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(frame.srcdoc).toContain('var current=1');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('presentation-mode-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('stores an approved Direct Touch text delta as an immutable new revision', () => {
    const revisions: ArtifactBlock[] = [];
    render(<ArtifactWorkspace artifact={{ ...artifact, content: '<main><p>Ready</p></main>' }} isOpen language="ja" onClose={() => undefined} onArtifactRevision={(next) => revisions.push(next)} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを表示' }));
    fireEvent.click(screen.getByTestId('artifact-action-edit'));
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    expect(frame.srcdoc).toContain('data-origin-direct-touch-root');
    expect(frame.srcdoc).toContain("source:'ORIGIN_DIRECT_TOUCH'");
    act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { source: 'ORIGIN_DIRECT_TOUCH', type: 'commit', edits: [{ index: 0, text: 'Forged' }] } })));
    expect(revisions).toHaveLength(0);
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { source: 'ORIGIN_DIRECT_TOUCH', type: 'commit', edits: [{ index: 0, text: 'Edited safely' }] } })));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].content).toContain('Edited safely');
    expect(revisions[0].content).not.toContain('Forged');
    expect(revisions[0].revision).toBe(2);
    expect(revisions[0].revisions).toHaveLength(2);
    expect(artifact.content).toContain('Ready');
  });

  it('applies Direct Touch deltas to text nodes without treating edits as markup', () => {
    const revised = applyDirectTouchEdits('<main><p>Original</p></main>', [{ index: 0, text: '<strong>Literal text</strong>' }]);
    expect(revised).toContain('&lt;strong&gt;Literal text&lt;/strong&gt;');
    expect(revised).not.toContain('<strong>Literal text</strong>');
  });

  it('creates an offline ZIP with artifact files, a manifest, and a standalone index', async () => {
    const blob = await createOfflineArtifactBundle([
      { ...artifact, title: 'dashboard', content: '<main>Dashboard</main>' },
      { ...artifact, id: 'artifact-2', title: 'styles', language: 'css', type: 'code', content: 'body { color: cyan; }' },
    ]);
    const archiveText = new TextDecoder().decode(await blob.arrayBuffer());
    expect(archiveText).toContain('manifest.json');
    expect(archiveText).toContain('index.html');
    expect(archiveText).toContain('README.txt');
    expect(archiveText).toContain('artifacts/01-dashboard.html');
    expect(archiveText).toContain('artifacts/02-styles.css');
    expect(archiveText).toContain('"artifactCount": 2');
    expect(archiveText).toContain('ORIGIN Artifact Package');
  });

  it('coalesces knowledge-map restoration through requestAnimationFrame', () => {
    const restore = vi.fn();
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    const session: ConversationSession = { id: 'session-1', title: 'Previous planning session', createdAt: 1, messages: [{ id: 'm-1', role: 'user', content: 'Plan the project' }] };
    render(<App sessions={[session]} onRestoreSession={restore} language="ja" />);
    fireEvent.click(screen.getByTestId('knowledge-map-toggle'));
    expect(screen.getByTestId('knowledge-map-node-count').textContent).toBe('1');
    fireEvent.click(screen.getByTestId('knowledge-map-session-0'));
    expect(frame).toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith(session);
    frame.mockRestore();
  });
});
