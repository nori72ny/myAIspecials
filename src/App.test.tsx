// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { applyDirectTouchEdits, App, ArtifactWorkspace, createArtifactExportPayload, createArtifactVisualDiff, createOfflineArtifactBundle, searchOriginLocalSnapshot, type ArtifactBlock, type ConversationSession } from './App';

const artifact: ArtifactBlock = {
  id: 'artifact-1', type: 'html', language: 'html', title: 'Safe preview',
  content: '<main><button>Ready</button></main>', isComplete: true,
};

describe('ArtifactWorkspace action bar and sandbox runtime boundary', () => {
  afterEach(cleanup);

  it('keeps only edit, share, and save as primary actions, and groups advanced actions under details', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    for (const id of ['artifact-action-save', 'artifact-action-share', 'artifact-action-edit', 'artifact-action-details']) {
      expect(screen.getByTestId(id).className).toContain('min-h-11');
    }
    expect(screen.getByRole('button', { name: '成果物を共有' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Canvas Direct Touchで編集' })).toBeTruthy();
    expect(screen.getByTestId('artifact-action-edit').textContent).toBe('✏️ 編集');
    expect(screen.getByTestId('artifact-action-share').textContent).toBe('📲 共有');
    expect(screen.getByTestId('artifact-action-save').textContent).toBe('📥 保存');
    expect(screen.queryByTestId('artifact-action-copy')).toBeNull();
    fireEvent.click(screen.getByTestId('artifact-action-details'));
    expect(screen.getByTestId('artifact-details-menu')).toBeTruthy();
    expect(screen.getByTestId('artifact-action-copy')).toBeTruthy();
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
    expect((screen.getByTitle('プレビュー') as HTMLIFrameElement).getAttribute('data-origin-srcdoc')!).toContain('Ready');
  });

  it('provides complete, isolated Storage semantics before untrusted opaque-origin artifact scripts', () => {
    const isolatedArtifact = { ...artifact, content: '<script>localStorage.setItem("artifact", "ready")</script><main>Storage ready</main>' };
    render(<ArtifactWorkspace artifact={isolatedArtifact} isOpen language="ja" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを表示' }));
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    const match = frame.getAttribute('data-origin-srcdoc')!.match(/<script data-origin-storage-polyfill="true">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    expect(frame.getAttribute('data-origin-srcdoc')!.indexOf('data-origin-storage-polyfill')).toBeLessThan(frame.getAttribute('data-origin-srcdoc')!.indexOf('localStorage.setItem("artifact", "ready")'));
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe('/origin-artifact-sandbox.html');
    expect(frame.getAttribute('data-origin-srcdoc')!).toContain("connect-src 'none'");

    const isolatedWindow = {} as { localStorage: Storage; sessionStorage: Storage };
    new Function('window', match![1])(isolatedWindow);
    isolatedWindow.localStorage.setItem('habit', 42 as unknown as string);
    isolatedWindow.localStorage.setItem('__proto__', 'safe');
    isolatedWindow.localStorage['named-value'] = 'named';
    isolatedWindow.sessionStorage.setItem('session', 'separate');
    expect(isolatedWindow.localStorage.length).toBe(3);
    expect(isolatedWindow.localStorage.key(0)).toBe('habit');
    expect(isolatedWindow.localStorage.getItem('habit')).toBe('42');
    expect(isolatedWindow.localStorage.getItem('__proto__')).toBe('safe');
    expect(Object.keys(isolatedWindow.localStorage)).toEqual(['habit', '__proto__', 'named-value']);
    expect(isolatedWindow.localStorage.getItem('session')).toBeNull();
    isolatedWindow.localStorage.removeItem('habit');
    delete isolatedWindow.localStorage['named-value'];
    expect(isolatedWindow.localStorage.length).toBe(1);
    isolatedWindow.localStorage.clear();
    expect(isolatedWindow.localStorage.length).toBe(0);
    expect(isolatedWindow.sessionStorage.getItem('session')).toBe('separate');
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
    fireEvent.click(screen.getByTestId('artifact-action-details'));
    fireEvent.click(screen.getByTestId('presentation-mode-toggle'));
    expect(screen.getByTestId('presentation-mode-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTitle('プレビュー').getAttribute('data-origin-srcdoc')!).toContain('var presenting=true');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTitle('プレビュー').getAttribute('data-origin-srcdoc')!).toContain('var current=1');
    const focusedFrame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { source: 'ORIGIN_PRESENTATION_KEYBOARD', key: 'ArrowLeft' } })));
    expect(screen.getByTitle('プレビュー').getAttribute('data-origin-srcdoc')!).toContain('var current=1');
    act(() => window.dispatchEvent(new MessageEvent('message', { source: focusedFrame.contentWindow, data: { source: 'ORIGIN_PRESENTATION_KEYBOARD', key: 'ArrowLeft' } })));
    expect(screen.getByTitle('プレビュー').getAttribute('data-origin-srcdoc')!).toContain('var current=0');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('presentation-mode-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('stores an approved Direct Touch text delta as an immutable new revision', () => {
    const revisions: ArtifactBlock[] = [];
    render(<ArtifactWorkspace artifact={{ ...artifact, content: '<main><p>Ready</p></main>' }} isOpen language="ja" onClose={() => undefined} onArtifactRevision={(next) => revisions.push(next)} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを表示' }));
    fireEvent.click(screen.getByTestId('artifact-action-edit'));
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    expect(frame.getAttribute('data-origin-srcdoc')!).toContain('data-origin-direct-touch-root');
    expect(frame.getAttribute('data-origin-srcdoc')!).toContain("source:'ORIGIN_DIRECT_TOUCH'");
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

  it('shows changes and restores one prior version through natural-language controls', () => {
    const revisedArtifact: ArtifactBlock = { ...artifact, content: '<main class="next"><h1>New</h1></main><style>main { color: cyan; }</style>', revision: 2, revisions: [{ id: 'artifact-1:v1', content: '<main><h1>Old</h1></main><style>main { color: slate; }</style>', createdAt: 1, source: 'generated' }, { id: 'artifact-1:v2', content: '<main class="next"><h1>New</h1></main><style>main { color: cyan; }</style>', createdAt: 2, source: 'direct-touch' }] };
    const revisions: ArtifactBlock[] = [];
    const diff = createArtifactVisualDiff(revisedArtifact.revisions![0].content, revisedArtifact.content);
    expect(diff.added).toBeGreaterThan(0);
    expect(diff.removed).toBeGreaterThan(0);
    expect(diff.htmlChanges).toBeGreaterThan(0);
    expect(diff.cssChanges).toBeGreaterThan(0);
    render(<ArtifactWorkspace artifact={revisedArtifact} isOpen language="ja" onClose={() => undefined} onArtifactRevision={(next) => revisions.push(next)} />);
    expect(screen.getByTestId('artifact-revision-indicator').textContent).toBe('最新');
    expect(screen.getByText('1つ前の版あり')).toBeTruthy();
    fireEvent.click(screen.getByTestId('artifact-action-details'));
    fireEvent.click(screen.getByTestId('artifact-visual-diff-toggle'));
    expect(screen.getByTestId('artifact-visual-diff-summary').textContent).toContain('HTML要素');
    expect(screen.getByTestId('artifact-visual-diff').textContent).toContain('New');
    fireEvent.click(screen.getByTestId('artifact-action-details'));
    fireEvent.click(screen.getByTestId('artifact-restore-previous'));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].content).toContain('Old');
    expect(revisions[0].revisions?.at(-1)?.source).toBe('restore');
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

  it('creates HTML, SVG, Markdown, and JSON exports locally and exposes every format in the save menu', () => {
    const html = createArtifactExportPayload(artifact, 'html');
    const svg = createArtifactExportPayload(artifact, 'svg');
    const markdown = createArtifactExportPayload(artifact, 'markdown');
    const json = createArtifactExportPayload(artifact, 'json');
    expect(html.fileName).toMatch(/\.html$/);
    expect(svg.content).toContain('<svg');
    expect(markdown.content).toContain('# Safe preview');
    expect(json.content).toContain('"artifact-1"');
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId('artifact-action-details'));
    fireEvent.click(screen.getByTestId('artifact-action-export-menu'));
    for (const format of ['html', 'svg', 'png', 'markdown', 'json']) expect(screen.getByTestId(`artifact-export-${format}`)).toBeTruthy();
  });

  it('collapses completed response verification into a one-line badge until requested', () => {
    render(<App language="ja" messages={[{ id: 'a-1', role: 'assistant', content: '結論です。' }]} />);
    const verification = screen.getByTestId('response-verification-details');
    expect(verification.textContent).toContain('✓');
    expect(verification.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByText('検証済み'));
    expect(verification.hasAttribute('open')).toBe(true);
    const verificationLog = screen.getByTestId('response-verification-log');
    for (const label of ['意図分析', '制作仕様', '構文検証']) expect(verificationLog.textContent).toContain(label);
    expect(verificationLog.textContent).toContain('固定の無料モデル');
  });

  it('uses an initial 76px composition surface and reduces it after a response', () => {
    const { rerender } = render(<App language="ja" />);
    expect(screen.getByTestId('origin-home-request').getAttribute('rows')).toBe('1');
    expect(document.querySelector('.origin-composer')?.className).not.toContain('origin-composer--compact');
    rerender(<App language="ja" messages={[{ id: 'a-1', role: 'assistant', content: '返信' }]} />);
    expect(document.querySelector('.origin-composer')?.className).toContain('origin-composer--compact');
    expect(document.querySelector('.safe-area-bottom .origin-composer')).not.toBeNull();
  });

  it('never submits a Japanese IME composition but keeps Control+Enter available afterward', async () => {
    const fetchMock = vi.fn(async () => new Response('確定後の回答', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    const input = screen.getByTestId('origin-home-request');
    fireEvent.change(input, { target: { value: '変換中の文章' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, keyCode: 13 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    vi.unstubAllGlobals();
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

  it('searches local sessions, artifact code, and immutable revisions without a network request', () => {
    const session: ConversationSession = { id: 'session-1', title: 'Database migration', createdAt: 1, messages: [{ id: 'm-1', role: 'user', content: 'IndexedDBの耐障害性を確認する' }] };
    const indexedArtifact: ArtifactBlock = { ...artifact, id: 'artifact-search', title: 'Storage repository', content: 'const storage = indexedDB;', revisions: [{ id: 'artifact-search:v1', content: 'legacy localStorage migration', createdAt: 1, source: 'generated' }, { id: 'artifact-search:v2', content: 'quota safe revision', createdAt: 2, source: 'direct-touch' }] };
    expect(searchOriginLocalSnapshot('IndexedDB', [session], [indexedArtifact]).map((result) => result.kind)).toContain('session');
    expect(searchOriginLocalSnapshot('quota safe', [session], [indexedArtifact])).toEqual([expect.objectContaining({ kind: 'artifact', id: 'artifact-search' })]);
    expect(searchOriginLocalSnapshot('network request', [session], [indexedArtifact])).toEqual([]);
  });

  it('discards a paid or unverifiable API result and shows the safe-waiting UI instead of a response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 'PROVIDER_POLICY_VIOLATION' }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '安全な回答を依頼' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('無料モデルの$0.00応答を確認できないため、回答は表示せず安全待機中です。時間をおいて再試行してください。')).toBeTruthy());
    expect(screen.queryByText('表示してはいけない応答')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('stops new AI requests while offline and preserves local-only operations', async () => {
    const online = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'オフライン要求' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('オフライン中は新規AI応答を停止しています。端末内の履歴・成果物は閲覧、直接編集、保存、パッケージ化を継続できます。')).toBeTruthy());
    if (online) Object.defineProperty(window.navigator, 'onLine', online);
    else delete (window.navigator as { onLine?: boolean }).onLine;
  });
});
