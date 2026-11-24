// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentConversationSession, withCurrentConversationSession } from './App';
import { reportAgentActivity } from './agent/agentActivityStore';

vi.mock('./creative/localRasterHistoryV15', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creative/localRasterHistoryV15')>();
  return {
    ...actual,
    saveRasterAssetV15: vi.fn(async () => 'saved' as const),
  };
});

vi.mock('./creative/rasterTechnicalCriticV15', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creative/rasterTechnicalCriticV15')>();
  return {
    ...actual,
    inspectRasterBlobV15: vi.fn(async () => ({
      version: 'raster-technical-critic-v1' as const,
      passed: true,
      score: 88,
      checks: ['non-empty-alpha', 'non-uniform-content', 'not-fully-black', 'not-fully-white', 'minimum-information-density'],
      issues: [],
      metrics: {
        width: 96,
        height: 96,
        sampledPixels: 9216,
        opaqueCoverage: 1,
        meanLuminance: 0.5,
        luminanceStdDev: 0.2,
        darkClipRatio: 0,
        brightClipRatio: 0,
        edgeEnergy: 0.1,
        histogramEntropy: 0.8,
      },
    })),
  };
});

vi.mock('./creative/rasterReferenceEditClientV15', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creative/rasterReferenceEditClientV15')>();
  return {
    ...actual,
    prepareRasterReferenceDataUrlV15: vi.fn(async () => ({
      dataUrl: 'data:image/webp;base64,QUJDRA==',
      mimeType: 'image/webp' as const,
      width: 511,
      height: 511,
      bytes: 4,
    })),
  };
});
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_EN, ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_JA } from './legacy/originChatResponsePolicy';
import { StreamArtifactParser, analyzeArtifactSyntax, applyDirectTouchEdits, App, ArtifactWorkspace, buildImagePhaseText, buildRasterGuidedEditPrompt, buildRasterVariationPrompt, chatSendFailureKind, chatSendFailureMessage, completeArtifactClosingTag, conversationMessageDisplayText, createArtifactExportPayload, createArtifactHtmlExportPayload, createArtifactIntegrityManifest, createArtifactVisualDiff, createOfflineArtifactBundle, createOriginAnswerReplay, createOriginStreamRenderBatcher, countOriginGraphemes, excerptAtBoundary, getOriginSystemPrompt, dedupeHistorySessions, historyExcerptText, historySessionExcerpt, historySessionExcerptSource, historySessionTitle, isHistoryExcerptFailureMessage, isDirectCodingWorkspaceRequest, isDirectCreativeWorkspaceRequest, isDirectImageGenerationRequest, isVerifiedRasterProviderId, isExplicitLocalProceduralImageRequest, isFreeOnlyPolicyCompliantChatPayload, originAnswerReplayDurationSeconds, originGraphemePrefix, rasterGenerationFailureMessage, rasterSizeForRequest, sanitizeArtifactPreviewMarkup, searchOriginLocalSnapshot, shouldStartOriginAnswerReplay, splitOriginGraphemes, stripMarkdownForDisplay, TRUNCATED_ANSWER_NOTICE, TRUNCATED_ANSWER_NOTICE_EN, type ArtifactBlock, type ConversationMessage, type ConversationSession } from './App';

const artifact: ArtifactBlock = {
  id: 'artifact-1', type: 'html', language: 'html', title: 'Safe preview',
  content: '<main><button>Ready</button></main>', isComplete: true,
};

function requestPath(input: RequestInfo | URL): string {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(rawUrl, 'http://localhost').pathname;
}

describe('ArtifactWorkspace action bar and sandbox runtime boundary', () => {
  it('accepts only the two explicitly supported free raster provider identities', () => {
    expect(isVerifiedRasterProviderId('cloudflare-workers-ai-free')).toBe(true);
    expect(isVerifiedRasterProviderId('pollinations-zero-cost')).toBe(true);
    expect(isVerifiedRasterProviderId('paid-provider')).toBe(false);
    expect(isVerifiedRasterProviderId(null)).toBe(false);
  });

  afterEach(cleanup);

  it('batches all stream chunks received within one animation frame', () => {
    const renderChunk = vi.fn();
    let scheduledFrame: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 17;
    });
    const cancelFrame = vi.fn();
    const batcher = createOriginStreamRenderBatcher(renderChunk, { requestFrame, cancelFrame });

    batcher.enqueue('結論');
    batcher.enqueue('を');
    batcher.enqueue('まとめます。');

    expect(requestFrame).toHaveBeenCalledOnce();
    expect(renderChunk).not.toHaveBeenCalled();
    scheduledFrame?.(16);
    expect(renderChunk).toHaveBeenCalledOnce();
    expect(renderChunk).toHaveBeenCalledWith('結論をまとめます。');
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it('flushes the last streaming frame immediately without losing its content', () => {
    const renderChunk = vi.fn();
    const requestFrame = vi.fn(() => 21);
    const cancelFrame = vi.fn();
    const batcher = createOriginStreamRenderBatcher(renderChunk, { requestFrame, cancelFrame });

    batcher.enqueue('途中');
    batcher.enqueue('と最終チャンク');
    batcher.flush();

    expect(cancelFrame).toHaveBeenCalledWith(21);
    expect(renderChunk).toHaveBeenCalledOnce();
    expect(renderChunk).toHaveBeenCalledWith('途中と最終チャンク');
  });

  it('drops a cancelled streaming frame without revealing unverified content', () => {
    const renderChunk = vi.fn();
    let scheduledFrame: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrame = callback;
      return 31;
    });
    const cancelFrame = vi.fn();
    const batcher = createOriginStreamRenderBatcher(renderChunk, { requestFrame, cancelFrame });

    batcher.enqueue('表示してはいけない途中応答');
    batcher.cancel();
    scheduledFrame?.(16);
    batcher.enqueue('中止後の応答');
    batcher.flush();

    expect(cancelFrame).toHaveBeenCalledWith(31);
    expect(renderChunk).not.toHaveBeenCalled();
  });

  it('keeps edit and save as primary actions, and groups advanced actions under details', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    for (const id of ['artifact-action-save', 'artifact-action-edit', 'artifact-action-details']) {
      expect(screen.getByTestId(id).className).toContain('min-h-11');
      expect(screen.getByTestId(id).className).toContain('min-w-11');
    }
    expect(screen.getByRole('button', { name: '成果物を編集' })).toBeTruthy();
    expect(screen.getByTestId('artifact-action-edit').textContent).toBe('✏️ 編集');
    expect(screen.getByTestId('artifact-action-save').textContent).toBe('📥 保存');
    expect(screen.queryByTestId('artifact-action-copy')).toBeNull();
    fireEvent.click(screen.getByTestId('artifact-action-details'));
    expect(screen.getByTestId('artifact-details-menu')).toBeTruthy();
    expect(screen.getByTestId('artifact-action-copy')).toBeTruthy();
  });

  it('keeps header, composer, and attachment controls at least 44px in both dimensions', () => {
    render(<App language="ja" />);

    const controls = [
      screen.getByTestId('history-drawer-toggle'),
      screen.getByTestId('origin-add-menu-toggle'),
    ];
    const sendControl = screen.getByTestId('start-request-button');

    const historyControl = screen.getByTestId('history-drawer-toggle');
    expect(historyControl.querySelector('svg.lucide-menu')).toBeTruthy();
    expect(historyControl.textContent).not.toContain('☰');
    // 設定ボタンはヘッダーに無い（サイドバーへ集約、PR-D）。
    expect(screen.queryByRole('button', { name: '設定を開く' })).toBeNull();

    for (const control of controls) {
      expect(control.className).toMatch(/\b(?:min-h-11|h-11)\b/);
      expect(control.className).toMatch(/\b(?:min-w-11|w-11)\b/);
    }
    // D-PR-3: the primary send action is a 44px circle (h-11/w-11),
    // exactly the 44px touch-target floor of spec §0.
    expect(sendControl.className).toMatch(/\bh-11\b/);
    expect(sendControl.className).toMatch(/\bw-11\b/);
    fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
    expect(screen.getByRole('menuitem', { name: 'ファイルを添付' })).toBeTruthy();

    const header = document.querySelector('.origin-header') as HTMLElement;
    // ヘッダーのボタンは履歴トグルだけ（設定・新しい会話はサイドバー
    // へ集約、PR-D）。オリンはヘッダーに置かず、上部中央の浮遊
    // プレゼンスに一本化した（2026-11-14 08:59）。
    expect(within(header).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '新しい会話を始める' })).toBeNull();
    for (const control of within(header).getAllByRole('button')) {
      expect(control.className).toContain('whitespace-nowrap');
      expect(control.className).toContain('shrink-0');
    }

    fireEvent.click(screen.getByTestId('history-drawer-toggle'));
    expect(screen.getByTestId('history-drawer')).toBeTruthy();
  });

  it('keeps the composer wide, icon-only, and minimally self-explanatory while preserving touch targets (send action at 44px)', () => {
    render(<App language="ja" />);

    const composer = document.querySelector('.origin-composer') as HTMLElement;
    const input = screen.getByTestId('origin-home-request') as HTMLTextAreaElement;
    const add = screen.getByTestId('origin-add-menu-toggle');
    const send = screen.getByTestId('start-request-button');

    expect(input.getAttribute('placeholder')).toBe('やりたいことを、そのまま入力してください');
    expect(input.className).toContain('min-w-0');
    expect(input.className).toContain('px-2');
    expect(composer.className).toContain('gap-1');
    expect(add.textContent).toBe('＋');
    // D-PR-3: the send glyph is a Lucide ArrowUp, not the '↑' text glyph.
    expect(send.textContent).toBe('');
    expect(send.querySelector('svg.lucide-arrow-up')).toBeTruthy();
    expect(add.className).toContain('h-11');
    expect(add.className).toContain('w-11');
    expect(send.className).toContain('h-11');
    expect(send.className).toContain('w-11');
    expect(send.textContent).not.toContain('開始');
    expect(send.textContent).not.toContain('送信');
  });

  it('grows the composer input with content from a compact floor to the six-line cap', () => {
    render(<App language="ja" />);

    const input = screen.getByTestId('origin-home-request') as HTMLTextAreaElement;
    let measuredScrollHeight = 30;
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => measuredScrollHeight });

    fireEvent.change(input, { target: { value: '短い依頼' } });
    expect(input.style.height).toBe('44px');

    measuredScrollHeight = 120;
    fireEvent.change(input, { target: { value: '複数行の\n依頼です' } });
    expect(input.style.height).toBe('120px');

    measuredScrollHeight = 400;
    fireEvent.change(input, { target: { value: 'とても長い\n依頼です' } });
    expect(input.style.height).toBe('176px');
  });

  it('does not show sample request suggestions on the empty state', () => {
    render(<App language="ja" />);

    expect(screen.queryByTestId('home-suggestion-1')).toBeNull();
    expect(screen.queryByTestId('home-suggestion-2')).toBeNull();
    expect(screen.queryByTestId('home-suggestion-3')).toBeNull();
    expect(screen.queryByTestId('home-suggestion-4')).toBeNull();
  });

  it('does not show sample request suggestions when language is English', () => {
    render(<App language="en" />);

    expect(screen.queryByTestId('home-suggestion-1')).toBeNull();
    expect(screen.queryByTestId('home-suggestion-2')).toBeNull();
    expect(screen.queryByTestId('home-suggestion-3')).toBeNull();
    expect(screen.queryByTestId('home-suggestion-4')).toBeNull();
  });

  it('shows the four fixed starter chips on the empty state (PR-C)', () => {
    render(<App language="ja" />);

    const chipRow = screen.getByTestId('origin-starter-chips');
    const chips = within(chipRow).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['ニュースを調べる', '企画書を作る', '画像を描く', 'メールの下書き']);
    for (const chip of chips) {
      expect(chip.className).toContain('h-11');
      expect(chip.className).toContain('rounded-full');
    }
  });

  it('shows the English starter chips when language is English (PR-C)', () => {
    render(<App language="en" />);

    const chipRow = screen.getByTestId('origin-starter-chips');
    const chips = within(chipRow).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['Check the news', 'Draft a proposal', 'Draw an image', 'Draft an email']);
  });

  it('sends the starter chip prompt immediately on tap and leaves the empty state (PR-C)', async () => {
    const chatReply = (content: string) => new Response(JSON.stringify({
      content,
      routing: { modelId: 'google/gemma-4-31b-it:free', freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: 'google/gemma-4-31b-it:free', servedModel: 'google/gemma-4-31b-it:free', fallbackUsed: false } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (requestPath(input) === '/api/chat') return chatReply('下書きを作りました');
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App language="ja" />);

      fireEvent.click(screen.getByRole('button', { name: 'メールの下書き' }));

      // Tapping sends the fixed prompt at once (no draft is placed in the
      // composer): the prompt becomes the first user turn and the home-only
      // chip row disappears with the empty state.
      expect(await screen.findByText('お礼のメールの下書きを作ってください')).toBeTruthy();
      const chatCalls = fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/chat');
      expect(chatCalls).toHaveLength(1);
      expect(String((chatCalls[0]?.[1] as RequestInit)?.body)).toContain('お礼のメールの下書きを作ってください');
      expect(screen.queryByTestId('origin-starter-chips')).toBeNull();
      expect(screen.queryByTestId('origin-home-request')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens renderable artifacts in preview first and exposes source only on demand', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);

    const preview = screen.getByTitle('プレビュー');
    expect(preview).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'コードを表示' })).toBeNull();
    fireEvent.click(screen.getByTestId('artifact-action-details'));
    const codeButton = screen.getByTestId('artifact-show-code');
    expect(codeButton.textContent).toContain('コードを見る');

    fireEvent.click(codeButton);
    expect(screen.queryByTitle('プレビュー')).toBeNull();
    expect(screen.getByText('<main><button>Ready</button></main>')).toBeTruthy();

    fireEvent.click(screen.getByTestId('artifact-action-details'));
    const previewButton = screen.getByTestId('artifact-show-preview');
    expect(previewButton.textContent).toContain('プレビューに戻る');
    fireEvent.click(previewButton);
    expect(screen.getByTitle('プレビュー')).toBeTruthy();
  });

  it('renders Markdown artifacts as finished content before source text', () => {
    const markdownArtifact: ArtifactBlock = {
      id: 'artifact-md',
      type: 'markdown',
      language: 'markdown',
      title: 'Markdown preview',
      content: '# レポート\n\n- 結論A\n- 結論B',
      isComplete: true,
    };

    render(<ArtifactWorkspace artifact={markdownArtifact} isOpen language="ja" onClose={() => undefined} />);

    expect(screen.getByTestId('artifact-markdown-preview')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'レポート', level: 1 })).toBeTruthy();
    expect(screen.getByRole('list').textContent).toContain('結論A');
    expect(screen.queryByRole('button', { name: 'コードを表示' })).toBeNull();
    expect(screen.queryByTestId('responsive-viewport-bar')).toBeNull();
    expect(screen.queryByText('# レポート')).toBeNull();

    fireEvent.click(screen.getByTestId('artifact-action-details'));
    fireEvent.click(screen.getByTestId('artifact-show-code'));
    expect(screen.getByText(/# レポート/)).toBeTruthy();
  });

  it('keeps advanced capabilities behind the existing composer plus button', () => {
    const onOpenAgent = vi.fn();
    const onOpenCoding = vi.fn();
    const onOpenCreative = vi.fn();

    render(<App
      language="ja"
      onOpenAgent={onOpenAgent}
      onOpenCoding={onOpenCoding}
      onOpenCreative={onOpenCreative}
    />);

    const menu = screen.getByTestId('origin-add-menu');
    expect(menu.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
    expect(menu.hasAttribute('open')).toBe(true);
    expect(screen.getByRole('menu', { name: '追加機能' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: '画像生成' }));
    const imagePanel = screen.getByTestId('origin-image-generation-panel');
    expect(imagePanel).toBeTruthy();
    fireEvent.change(screen.getByTestId('origin-image-prompt'), { target: { value: '夕焼けの海辺、映画的な光' } });
    fireEvent.change(screen.getByTestId('origin-image-ratio'), { target: { value: '9:16' } });
    fireEvent.change(screen.getByTestId('origin-image-resolution'), { target: { value: '1536' } });
    expect(screen.getByTestId('origin-image-dimensions').textContent).toContain('864 × 1536px');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('origin-image-generation-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
    fireEvent.click(screen.getByRole('menuitem', { name: '詳しく調べる' }));
    // 詳しく調べるは専用画面へは遷移せず、チャット内のリサーチモードが
    // 有効になる（画面構成の見直し 2026-11-09、オーナー承認）。
    expect(screen.getByTestId('research-mode')).toBeTruthy();
    expect(menu.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'モードをやめる' }));
    expect(screen.queryByTestId('research-mode')).toBeNull();

    fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'エージェントに任せる' }));
    expect(onOpenAgent).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'コード' }));
    expect(onOpenCoding).toHaveBeenCalledOnce();

    // 「詳細・作業状況」は 2026-11-09 の画面構成再編で廃止したため、
    // メニューには現れない（SCREEN_NECESSITY_REVIEW_2026-11-09.md）。
    // 「作る」もオーナー決定（2026-11-12）で「+」メニューから隠したため
    // 現れない。機能自体は残し、会話で明示した依頼から開く経路は
    // 後方の Chat brief のテスト（onOpenCreative）が担保する。
    fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
    expect(screen.queryByRole('menuitem', { name: '詳細・作業状況' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Details & status' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '作る' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Create a deliverable' })).toBeNull();
  });

  describe('Research mode inside chat', () => {
    const researchPayload = {
      ok: true,
      version: '1.1',
      status: 'grounded',
      provider: 'DuckDuckGo',
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      sourceCount: 2,
      distinctDomainCount: 2,
      confidence: 'moderate',
      confidenceScope: 'retrieval-evidence-only',
      semanticConflictDetection: 'conservative-structured-only',
      sources: [
        { id: 'S1', title: 'Primary source', url: 'https://example.com/a', domain: 'example.com', evidenceLevel: 'page-verified', freshness: 'recent', score: 85, scoreScope: 'retrieval-evidence-only', citation: '[S1](https://example.com/a)' },
        { id: 'S2', title: 'Second source', url: 'https://example.org/b', domain: 'example.org', evidenceLevel: 'snippet', freshness: 'unknown', score: 45, scoreScope: 'retrieval-evidence-only', citation: '[S2](https://example.org/b)' },
      ],
      conflicts: [],
      report: '## 確認できた内容\n- 営業時間を編集できます [S1](https://example.com/a)',
    };
    const researchResponse = () => new Response(JSON.stringify(researchPayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const jsonChatReply = (content: string) => new Response(JSON.stringify({
      content,
      routing: { modelId: 'google/gemma-4-31b-it:free', freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: 'google/gemma-4-31b-it:free', servedModel: 'google/gemma-4-31b-it:free', fallbackUsed: false } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const armResearchMode = () => {
      fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
      fireEvent.click(screen.getByRole('menuitem', { name: '詳しく調べる' }));
      expect(screen.getByTestId('research-mode')).toBeTruthy();
    };

    it('runs research from the composer and keeps the sourced report in the conversation', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (requestPath(input) === '/api/research/v1.1/query') return researchResponse();
        if (requestPath(input) === '/api/chat') return jsonChatReply('通常の回答です');
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App language="ja" />);
      armResearchMode();

      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '現在の公開情報を調査' } });
      fireEvent.click(screen.getByTestId('start-request-button'));

      expect(await screen.findByRole('heading', { name: '確認できた内容' })).toBeTruthy();
      expect(screen.getByText('Primary source')).toBeTruthy();
      expect(screen.getByText('Second source')).toBeTruthy();
      expect(screen.getByText('出典の確かさ: 中')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'S1' })).toBeTruthy();
      expect(screen.getAllByRole('link', { name: '原文を開く' })).toHaveLength(2);
      const researchCalls = fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/research/v1.1/query');
      expect(researchCalls).toHaveLength(1);
      expect(JSON.parse((researchCalls[0]?.[1] as RequestInit)?.body as string)).toEqual({ query: '現在の公開情報を調査' });
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/chat')).toBe(false);
      expect(screen.queryByTestId('origin-research-progress')).toBeNull();

      // モードを解除すれば、同じ会話の続きは通常チャットとして送れる
      // （レポートが会話に残るため、続けて質問できる）。
      fireEvent.click(screen.getByRole('button', { name: 'モードをやめる' }));
      const composer = screen.getByTestId('origin-chat-request');
      fireEvent.change(composer, { target: { value: 'ありがとう、続きを教えて' } });
      fireEvent.click(screen.getByTestId('send-request-button'));
      expect(await screen.findByText('通常の回答です')).toBeTruthy();
      expect(fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/research/v1.1/query')).toHaveLength(1);
    });

    it('shows a unified failure frame with a research retry when no verifiable information is found', async () => {
      const failureResponse = () => new Response(JSON.stringify({ ok: false, code: 'RESEARCH_SOURCE_UNAVAILABLE' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (requestPath(input) === '/api/research/v1.1/query') return failureResponse();
        if (requestPath(input) === '/api/chat') return jsonChatReply('通常の回答です');
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App language="ja" />);
      armResearchMode();

      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '見つからない公開情報' } });
      fireEvent.click(screen.getByTestId('start-request-button'));

      // 失敗表示の型をチャットのフォールバックと統一する：状態見出し＋
      // 一文の説明＋回復アクション（もう一度試す）。失敗文にコピーは付けない。
      expect(await screen.findByRole('heading', { name: '調査を完了できませんでした' })).toBeTruthy();
      expect(screen.getByText('無料で使える公開情報からは、確かめられる情報が見つかりませんでした。')).toBeTruthy();
      const retryButton = await screen.findByTestId('chat-research-retry-button');
      expect(retryButton.textContent).toBe('もう一度試す');
      expect(screen.queryByRole('button', { name: '回答をコピー' })).toBeNull();

      // モードを解除した後でも、再試行は通常チャットではなく調査として
      // 同じ質問を送り直す。
      fireEvent.click(screen.getByRole('button', { name: 'モードをやめる' }));
      fireEvent.click(retryButton);
      await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/research/v1.1/query')).toHaveLength(2));
      const researchCalls = fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/research/v1.1/query');
      expect(JSON.parse((researchCalls[1]?.[1] as RequestInit)?.body as string)).toEqual({ query: '見つからない公開情報' });
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/chat')).toBe(false);
    });

    it('shows the research stage in the Orin working presence while research runs', async () => {
      let resolveResearch!: (value: Response) => void;
      const gate = new Promise<Response>((resolve) => { resolveResearch = resolve; });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (requestPath(input) === '/api/research/v1.1/query') return gate;
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App language="ja" />);
      armResearchMode();

      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '時間のかかる調査' } });
      fireEvent.click(screen.getByTestId('start-request-button'));

      const presence = await screen.findByTestId('origin-orin-presence');
      expect(presence.textContent).toContain('公開情報を探しています');
      expect(screen.queryByTestId('origin-thinking')).toBeNull();
      expect(screen.queryByTestId('origin-research-progress')).toBeNull();
      // 作業中表示（2026-11-14）：調査の段階は上部中央に浮く大きな
      // オリンの状態ピルが一文で表し、会話内に1行表示は置かない。
      // 旧吹き出しは出ない。
      expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
      const presenceCat = within(presence).getByTestId('origin-cat-state');
      expect(presenceCat.getAttribute('data-state')).toBe('searching');
      // ヘッダーにオリンは置かない（浮遊プレゼンスに一本化）。
      expect(screen.queryByTestId('origin-header-orin')).toBeNull();
      expect(document.querySelector('.origin-header [data-testid="origin-cat-state"]')).toBeNull();

      resolveResearch(researchResponse());
      expect(await screen.findByRole('heading', { name: '確認できた内容' })).toBeTruthy();
      expect(screen.queryByTestId('origin-research-progress')).toBeNull();
    });

    it('keeps a research failure in the conversation with its reason and never calls the chat route', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (requestPath(input) === '/api/research/v1.1/query') {
          return new Response(JSON.stringify({ ok: false, code: 'SENSITIVE_INPUT_BLOCKED' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App language="ja" />);
      armResearchMode();

      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'sensitive test' } });
      fireEvent.click(screen.getByTestId('start-request-button'));

      expect(await screen.findByText('機密性の高い情報の可能性があるため、外部情報源への送信を停止しました。')).toBeTruthy();
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/chat')).toBe(false);
      expect(screen.queryByTestId('origin-research-progress')).toBeNull();
    });

    it('fails closed when a nominal research success violates the free-only contract', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (requestPath(input) === '/api/research/v1.1/query') {
          return new Response(JSON.stringify({ ...researchPayload, freeOnly: false, costUsd: 1, paidFallbackUsed: true, report: 'must not render' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App language="ja" />);
      armResearchMode();

      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'query' } });
      fireEvent.click(screen.getByTestId('start-request-button'));

      expect(await screen.findByText('調査の結果を確認できなかったため、表示を止めました。')).toBeTruthy();
      expect(screen.queryByText('must not render')).toBeNull();
      expect(screen.queryByText('Primary source')).toBeNull();
    });

    it('queues a research send behind a running chat reply and drains it as research', async () => {
      let resolveChat!: (value: Response) => void;
      const chatGate = new Promise<Response>((resolve) => { resolveChat = resolve; });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (requestPath(input) === '/api/chat') return chatGate;
        if (requestPath(input) === '/api/research/v1.1/query') return researchResponse();
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App language="ja" />);

      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '最初の質問' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/chat')).toBe(true));

      armResearchMode();
      const composer = screen.getByTestId('origin-chat-request');
      fireEvent.change(composer, { target: { value: '続けて調査して' } });
      fireEvent.keyDown(composer, { key: 'Enter' });
      await waitFor(() => expect(screen.getByTestId('origin-send-queue')).toBeTruthy());
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/research/v1.1/query')).toBe(false);

      resolveChat(jsonChatReply('最初の回答'));
      expect(await screen.findByRole('heading', { name: '確認できた内容' }, { timeout: 5000 })).toBeTruthy();
      const researchCalls = fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/research/v1.1/query');
      expect(researchCalls).toHaveLength(1);
      expect(JSON.parse((researchCalls[0]?.[1] as RequestInit)?.body as string)).toEqual({ query: '続けて調査して' });
    });
  });

  it('sends the dedicated image panel prompt and selected dimensions to the raster endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url === '/api/generate-image') {
        return new Response(JSON.stringify({
          code: 'PROVIDER_UNAVAILABLE',
          message: '画像生成Providerが未構成です。',
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ code: 'UNEXPECTED_REQUEST' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App language="ja" />);
      fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
      fireEvent.click(screen.getByRole('menuitem', { name: '画像生成' }));
      // Plan B: the panel does not pre-check the raster status endpoint
      // (which never reports ready), so the submit button is enabled by
      // the form alone and no status request is ever issued.
      expect(screen.getByTestId('origin-image-generate-submit')).toHaveProperty('disabled', false);
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/creative/v1.5/raster/status')).toBe(false);
      fireEvent.change(screen.getByTestId('origin-image-prompt'), { target: { value: '夕焼けの海辺' } });
      fireEvent.change(screen.getByTestId('origin-image-ratio'), { target: { value: '9:16' } });
      fireEvent.change(screen.getByTestId('origin-image-resolution'), { target: { value: '1536' } });
      fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/generate-image')).toBe(true);
      });
      const generationCall = fetchMock.mock.calls.find(([input]) => requestPath(input) === '/api/generate-image') as [RequestInfo | URL, RequestInit?] | undefined;
      expect(generationCall).toBeTruthy();
      expect(JSON.parse(String(generationCall?.[1]?.body))).toMatchObject({
        prompt: '夕焼けの海辺',
        width: 864,
        height: 1536,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the making cat in the floating presence while an image is being generated', async () => {
    let resolveGeneration: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url === '/api/generate-image') {
        return new Promise<Response>((resolve) => { resolveGeneration = resolve; });
      }
      return new Response(JSON.stringify({ code: 'UNEXPECTED_REQUEST' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App language="ja" />);
      fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
      fireEvent.click(screen.getByRole('menuitem', { name: '画像生成' }));
      fireEvent.change(screen.getByTestId('origin-image-prompt'), { target: { value: '夕焼けの海辺' } });
      fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

      // 画像生成中は浮遊プレゼンスのオリンが専用の「作っている」
      // 静止画になる（M2、2026-11-18。それまでは working の動画）。
      const presence = await screen.findByTestId('origin-orin-presence');
      await waitFor(() => {
        const presenceCat = within(presence).getByTestId('origin-cat-state');
        expect(presenceCat.getAttribute('data-state')).toBe('making');
        expect(presenceCat.tagName).toBe('IMG');
        expect(presenceCat.getAttribute('src')).toBe('/brand/origin-cat-making.webp');
      });

      resolveGeneration?.(new Response(JSON.stringify({
        code: 'PROVIDER_UNAVAILABLE',
        message: '画像生成Providerが未構成です。',
      }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not carry a rejected image-panel request into the next ordinary chat message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url === '/api/generate-image') {
        return new Response(JSON.stringify({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Provider unavailable',
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ code: 'CHAT_UNAVAILABLE' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App language="ja" />);
      fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
      fireEvent.click(screen.getByRole('menuitem', { name: '画像生成' }));
      expect(screen.getByTestId('origin-image-generate-submit')).toHaveProperty('disabled', false);
      fireEvent.change(screen.getByTestId('origin-image-prompt'), {
        target: { value: 'test@sample.co.jp のプロフィール画像を作って' },
      });
      fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

      expect(await screen.findByRole('alert')).toBeTruthy();
      // The rejected panel request is stopped before any generation call,
      // and the panel never consults the raster status endpoint.
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/generate-image')).toBe(false);
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/creative/v1.5/raster/status')).toBe(false);

      fireEvent.change(screen.getByTestId('origin-home-request'), {
        target: { value: '今日は天気について教えてください' },
      });
      fireEvent.click(screen.getByTestId('start-request-button'));

      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/chat')).toBe(true);
      });
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/generate-image')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows a translated reason instead of the raw code when the free-proof pipeline fails closed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url === '/api/generate-image') {
        // The real server echoes the machine code as the message when it
        // has no human message for a proof-stage failure.
        return new Response(JSON.stringify({
          ok: false,
          code: 'CLOUDFLARE_USAGE_RECONCILIATION_FAILED',
          message: 'CLOUDFLARE_USAGE_RECONCILIATION_FAILED',
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ code: 'CHAT_UNAVAILABLE' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App language="ja" />);
      fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
      fireEvent.click(screen.getByRole('menuitem', { name: '画像生成' }));
      fireEvent.change(screen.getByTestId('origin-image-prompt'), { target: { value: '夕焼けの海辺' } });
      fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('無料で使えることを確認できなかったため、生成しませんでした');
      expect(alert.textContent).not.toContain('CLOUDFLARE_USAGE_RECONCILIATION_FAILED');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the server human message for generation failures without a mapped code', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url === '/api/generate-image') {
        return new Response(JSON.stringify({
          ok: false,
          code: 'RASTER_UNMAPPED_FAILURE_EXAMPLE',
          message: 'サーバー側の人間向け理由文です。',
        }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ code: 'CHAT_UNAVAILABLE' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App language="ja" />);
      fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
      fireEvent.click(screen.getByRole('menuitem', { name: '画像生成' }));
      fireEvent.change(screen.getByTestId('origin-image-prompt'), { target: { value: '夕焼けの海辺' } });
      fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('サーバー側の人間向け理由文です');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('maps free-proof failure codes to user-facing reasons and leaves unknown codes unmapped', () => {
    expect(rasterGenerationFailureMessage('CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT', 'ja')).toContain('今日の無料枠が残り少ないため');
    expect(rasterGenerationFailureMessage('CLOUDFLARE_DAILY_USAGE_UNVERIFIED', 'ja')).toContain('無料で使えることを確認できなかったため');
    expect(rasterGenerationFailureMessage('CLOUDFLARE_USAGE_RECONCILIATION_FAILED', 'en')).toContain('free use could not be confirmed');
    expect(rasterGenerationFailureMessage('RASTER_PRICING_EVIDENCE_STALE', 'ja')).toContain('無料で使えることを確認できなかったため');
    expect(rasterGenerationFailureMessage('PROVIDER_UNAVAILABLE', 'ja')).toBeNull();
    expect(rasterGenerationFailureMessage(undefined, 'ja')).toBeNull();
  });

  it('translates the server-fixed Japanese failure reasons instead of passing them through (PKG-2 i18n)', () => {
    // Quality-gate rejections: the English UI gets the English reason plus
    // the next-step guidance, never the server's Japanese fixed wording.
    expect(rasterGenerationFailureMessage('RASTER_SEMANTIC_CRITIC_REJECTED', 'en')).toContain('did not pass the quality check');
    expect(rasterGenerationFailureMessage('RASTER_SEMANTIC_CRITIC_REJECTED', 'en')).toContain('Try again');
    expect(rasterGenerationFailureMessage('RASTER_SEMANTIC_CRITIC_REJECTED', 'en')).not.toContain('品質ゲート');
    expect(rasterGenerationFailureMessage('RASTER_STRUCTURAL_CRITIC_REJECTED', 'en')).toContain('did not pass the quality check');
    expect(rasterGenerationFailureMessage('RASTER_SEMANTIC_CRITIC_REJECTED', 'ja')).toContain('品質チェックを通らなかったため');
    expect(rasterGenerationFailureMessage('RASTER_SEMANTIC_CRITIC_REJECTED', 'ja')).toContain('もう一度お試しください');
    // Sensitive-input block: translated in both languages.
    expect(rasterGenerationFailureMessage('SENSITIVE_INPUT_BLOCKED', 'en')).toContain('was not sent outside');
    expect(rasterGenerationFailureMessage('SENSITIVE_INPUT_BLOCKED', 'en')).not.toContain('機密');
    expect(rasterGenerationFailureMessage('SENSITIVE_INPUT_BLOCKED', 'ja')).toContain('外部へ送りませんでした');
  });

  it('classifies send failures by cause so only real congestion reads as busy (PKG-2)', () => {
    expect(chatSendFailureKind(new TypeError('Failed to fetch'))).toBe('network');
    expect(chatSendFailureKind(new Error('incomplete-stream'))).toBe('incomplete-stream');
    expect(chatSendFailureKind(new Error('invalid-stream-event'))).toBe('invalid-response');
    expect(chatSendFailureKind(new Error('unverified-upstream-stream'))).toBe('invalid-response');
    expect(chatSendFailureKind(new SyntaxError('Unexpected token'))).toBe('invalid-response');
    expect(chatSendFailureKind(new Error('something else'))).toBe('unexpected');
    for (const kind of ['network', 'incomplete-stream', 'invalid-response', 'unexpected'] as const) {
      expect(chatSendFailureMessage(kind, 'ja')).not.toContain('混み合っています');
      expect(chatSendFailureMessage(kind, 'en')).not.toContain('busy');
    }
    expect(chatSendFailureMessage('network', 'ja')).toContain('通信が切れてしまい');
    expect(chatSendFailureMessage('incomplete-stream', 'ja')).toContain('途中で終わってしまった');
    expect(TRUNCATED_ANSWER_NOTICE).toContain('途中で終わっています');
    expect(TRUNCATED_ANSWER_NOTICE_EN).toContain('ends partway through');
  });

  it('grants normal previews only script execution and never modal or same-origin privileges', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);

    const permissions = (screen.getByTitle('プレビュー') as HTMLIFrameElement)
      .getAttribute('sandbox')
      ?.split(/\s+/);

    expect(permissions).toEqual(['allow-scripts']);
    expect(permissions).not.toContain('allow-modals');
    expect(permissions).not.toContain('allow-same-origin');
  });

  it('accepts live steering only while an artifact is still streaming and protects IME composition', () => {
    const onSteer = vi.fn();
    const pendingArtifact = { ...artifact, isComplete: false };
    const { rerender } = render(<ArtifactWorkspace artifact={pendingArtifact} isOpen language="ja" isStreaming onSteer={onSteer} onClose={() => undefined} />);
    const input = screen.getByTestId('artifact-live-steering-input');
    fireEvent.change(input, { target: { value: '落ち着いたネイビーに変更' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(onSteer).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByTestId('artifact-live-steering'));
    expect(onSteer).toHaveBeenCalledWith('落ち着いたネイビーに変更');
    rerender(<ArtifactWorkspace artifact={artifact} isOpen language="ja" isStreaming={false} onSteer={onSteer} onClose={() => undefined} />);
    expect(screen.queryByTestId('artifact-live-steering')).toBeNull();
  });

  it('synchronizes allowlisted semantic theme tokens without replacing the opaque-origin iframe', async () => {
    document.documentElement.style.setProperty('--accent-primary', 'oklch(0.62 0.15 235)');
    const { rerender } = render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" designTheme="minimal" onClose={() => undefined} />);
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ source: 'ORIGIN_ARTIFACT_THEME', designTheme: 'minimal', tokens: expect.objectContaining({ '--accent-primary': 'oklch(0.62 0.15 235)' }) }), '*');
    expect(frame.getAttribute('data-origin-srcdoc')).toContain('data-origin-theme-bridge="true"');
    expect(frame.getAttribute('data-origin-srcdoc')).toContain('event.source!==parent');
    rerender(<ArtifactWorkspace artifact={artifact} isOpen language="ja" designTheme="luxury" onClose={() => undefined} />);
    expect(screen.getByTitle('プレビュー')).toBe(frame);
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ source: 'ORIGIN_ARTIFACT_THEME', designTheme: 'luxury' }), '*'));
    postMessage.mockRestore();
    document.documentElement.style.removeProperty('--accent-primary');
  });

  it('injects the accessibility auto-linter before untrusted artifact markup and keeps it network isolated', () => {
    const inaccessibleArtifact = { ...artifact, content: '<main style="background:#777"><p id="low-contrast" style="color:#777">Low contrast</p><button id="unnamed"><svg aria-hidden="true"></svg></button></main>' };
    render(<ArtifactWorkspace artifact={inaccessibleArtifact} isOpen language="en" onClose={() => undefined} />);
    const source = (screen.getByTitle('Preview') as HTMLIFrameElement).getAttribute('data-origin-srcdoc')!;
    expect(source.indexOf('data-origin-a11y-linter="true"')).toBeLessThan(source.indexOf('id="low-contrast"'));
    expect(source).toContain('data-origin-a11y-contrast-fixes');
    expect(source).toContain('data-origin-a11y-name-fixes');
    expect(source).toContain("source:'ORIGIN_SANDBOX_A11Y'");
    expect(source).toContain('defaultLabel="Action button"');
    expect(source).toContain("connect-src 'none'");
    expect(source).toContain('window.__originRunA11yLint');
  });

  it('isolates a sandbox runtime error and restores the last known good revision', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'ready', timestamp: Date.now() } })));
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'runtime-error', message: 'broken widget' } })));
    expect(screen.getByTestId('sandbox-runtime-boundary').textContent).toContain('プレビューでエラーが起きました。');
    fireEvent.click(screen.getByTestId('restore-last-known-good'));
    expect(screen.queryByTestId('sandbox-runtime-boundary')).toBeNull();
    expect((screen.getByTitle('プレビュー') as HTMLIFrameElement).getAttribute('data-origin-srcdoc')!).toContain('Ready');
  });

  it('provides complete, isolated Storage semantics while removing artifact-authored scripts', () => {
    const isolatedArtifact = { ...artifact, content: '<script>localStorage.setItem("artifact", "ready")</script><main>Storage ready</main>' };
    render(<ArtifactWorkspace artifact={isolatedArtifact} isOpen language="ja" onClose={() => undefined} />);
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    const match = frame.getAttribute('data-origin-srcdoc')!.match(/<script data-origin-storage-polyfill="true">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    expect(frame.getAttribute('data-origin-srcdoc')).not.toContain('localStorage.setItem("artifact", "ready")');
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

  it('keeps visual markup but strips authored execution, navigation, embeds, forms, and remote CSS', () => {
    const result = sanitizeArtifactPreviewMarkup(`<style>@import 'https://outside.invalid/a.css';main{background:url(https://outside.invalid/a.png);color:red}</style><main onclick="location.href='https://outside.invalid/'"><script>window.pwned=true</script><a href="https://outside.invalid/">Visible link</a><form action="https://outside.invalid/post"><button formaction="https://outside.invalid/other">Send</button></form><img src="https://outside.invalid/a.png"><iframe src="https://outside.invalid/frame"></iframe><meta http-equiv="refresh" content="0;url=https://outside.invalid/"></main>`);
    const template = document.createElement('template');
    template.innerHTML = result;
    expect(template.content.querySelector('main')?.textContent).toContain('Visible link');
    expect(template.content.querySelector('script,iframe,frame,object,embed,meta[http-equiv]')).toBeNull();
    expect(template.content.querySelector('[onclick],[href],[src],[action],[formaction]')).toBeNull();
    expect(template.content.querySelector('form')?.getAttribute('method')).toBe('dialog');
    expect(result).not.toMatch(/outside\.invalid|@import|url\s*\(/i);
  });

  it('rejects forged cross-window messages and never confirms last-known-good from iframe load alone', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    fireEvent.load(frame);
    act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'runtime-error', message: 'forged error', timestamp: Date.now() } })));
    expect(screen.queryByTestId('sandbox-runtime-boundary')).toBeNull();
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'runtime-error', message: 'real error', timestamp: Date.now() } })));
    expect(screen.getByTestId('restore-last-known-good')).toHaveProperty('disabled', true);
  });

  it('stores an approved Direct Touch text delta as an immutable new revision', () => {
    const revisions: ArtifactBlock[] = [];
    render(<ArtifactWorkspace artifact={{ ...artifact, content: '<main><p>Ready</p></main>' }} isOpen language="ja" onClose={() => undefined} onArtifactRevision={(next) => revisions.push(next)} />);
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

  it('completes non-void HTML closing tags without duplicating existing or self-closing tags', () => {
    expect(completeArtifactClosingTag('<main><article>', 15)).toEqual({ content: '<main><article></article>', cursor: 15, completed: true });
    expect(completeArtifactClosingTag('<img>', 5).completed).toBe(false);
    expect(completeArtifactClosingTag('<section></section>', 9).completed).toBe(false);
    expect(completeArtifactClosingTag('<path />', 8).completed).toBe(false);
  });

  it('reports malformed HTML and JSON positions while accepting scripts and optional HTML tags', () => {
    expect(analyzeArtifactSyntax('<main>\n  <p>Ready</p>\n</main>', 'html')).toEqual({ valid: true, issue: null });
    expect(analyzeArtifactSyntax('<ul><li>One<li>Two</ul>', 'html')).toEqual({ valid: true, issue: null });
    expect(analyzeArtifactSyntax('<script>if (a < b) console.log(a)</script>', 'html')).toEqual({ valid: true, issue: null });
    expect(analyzeArtifactSyntax('<main>\n  <section>', 'html')).toEqual(expect.objectContaining({ valid: false, issue: expect.objectContaining({ line: 2, column: 3, message: expect.stringContaining('</section>') }) }));
    expect(analyzeArtifactSyntax('<main></article>', 'html')).toEqual(expect.objectContaining({ valid: false, issue: expect.objectContaining({ message: expect.stringContaining('</article>') }) }));
    expect(analyzeArtifactSyntax('{"ok":}', 'json').valid).toBe(false);
  });

  it('blocks malformed source edits and saves only a verified immutable revision', () => {
    const revisions: ArtifactBlock[] = [];
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} onArtifactRevision={(next) => revisions.push(next)} />);
    fireEvent.click(screen.getByTestId('artifact-action-edit'));
    fireEvent.click(screen.getByRole('button', { name: 'コードを表示' }));
    const editor = screen.getByTestId('artifact-code-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '<main><section>Broken</main>', selectionStart: 28 } });
    expect(screen.getByTestId('artifact-code-syntax-status').getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('artifact-code-apply')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('artifact-action-edit'));
    expect(screen.getByTestId('artifact-action-edit').getAttribute('aria-pressed')).toBe('true');
    expect(revisions).toHaveLength(0);
    fireEvent.change(editor, { target: { value: '<main><section>Validated</section></main>', selectionStart: 40 } });
    expect(screen.getByTestId('artifact-code-syntax-status').textContent).toContain('構文は問題ありません');
    fireEvent.click(screen.getByTestId('artifact-code-apply'));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].content).toBe('<main><section>Validated</section></main>');
    expect(revisions[0].revisions).toHaveLength(2);
    expect(revisions[0].revisions?.[0].content).toBe(artifact.content);
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
    expect(screen.getByText('更新あり')).toBeTruthy();
    fireEvent.click(screen.getByTestId('artifact-action-details'));
    fireEvent.click(screen.getByTestId('artifact-visual-diff-toggle'));
    expect(screen.getByTestId('artifact-visual-diff-summary').textContent).toContain('HTML要素');
    expect(screen.getByTestId('artifact-visual-diff').textContent).toContain('New');
    const removedBadge = screen.getByTestId('artifact-diff-removed-count');
    expect(removedBadge.className).toContain('bg-red-500/15');
    expect(removedBadge.className).not.toContain('w-full');
    expect(removedBadge.className).not.toContain('shadow-lg');
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
    expect(archiveText).toContain('"algorithm": "SHA-256"');
    expect(archiveText).toContain('"exportedAt":');
    expect(archiveText).toContain('f01c117d6158055b0257a23fca485d24de5990c7d453116af450a078bf0c7b7c');
    expect(archiveText).toContain('58c7a4f4ed3d279372ec24f52aef5e74ee55ba2e9973e491abdae2945234c648');
    expect(archiveText).toContain('ORIGIN Artifact Package');
  });

  it('creates deterministic SHA-256 integrity metadata and embeds it in standalone HTML exports', async () => {
    const exportedAt = '2026-08-22T12:00:00.000Z';
    const manifest = await createArtifactIntegrityManifest([{ artifact, path: 'safe-preview.html', content: artifact.content }], exportedAt);
    expect(manifest).toEqual(expect.objectContaining({ algorithm: 'SHA-256', exportedAt, artifactCount: 1 }));
    expect(manifest.artifacts[0]).toEqual(expect.objectContaining({ path: 'safe-preview.html', bytes: new TextEncoder().encode(artifact.content).byteLength, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    const html = await createArtifactHtmlExportPayload(artifact, exportedAt);
    expect(html.fileName).toMatch(/\.html$/);
    expect(html.content).toContain('id="origin-export-manifest"');
    expect(html.content).toContain('data-filename="manifest.json"');
    expect(html.content).toContain(manifest.artifacts[0].sha256);
    expect(html.content).not.toContain('src="http');
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

  it('never discloses a verified Process Trace for a failed assistant message', () => {
    render(<App language="ja" messages={[{
      id: 'error-1',
      role: 'assistant',
      content: '今、無料AIが混み合っています。入力した内容は残っています。少し待ってから、もう一度お試しください。',
      deliveryState: 'error',
    }]} />);

    expect(screen.getByText('今、無料AIが混み合っています。入力した内容は残っています。少し待ってから、もう一度お試しください。')).toBeTruthy();
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
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

  it('sends with plain Enter, keeps Shift+Enter as a newline, and never submits during IME composition', async () => {
    const fetchMock = vi.fn(async () => new Response('Enter送信への回答', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    const input = screen.getByTestId('origin-home-request');
    fireEvent.change(input, { target: { value: 'Enterで送る文章' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true, keyCode: 13 });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    vi.unstubAllGlobals();
  });

  it('recognizes explicit repository code-change requests without hijacking code questions', () => {
    expect(isDirectCodingWorkspaceRequest('ログイン画面のバグを修正して、関連テストも追加して')).toBe(true);
    expect(isDirectCodingWorkspaceRequest('このAPI実装を直して')).toBe(true);
    expect(isDirectCodingWorkspaceRequest('このコードの意味を説明して')).toBe(false);
    expect(isDirectCodingWorkspaceRequest('ReactのuseEffectとは何ですか？')).toBe(false);
  });

  it('hands explicit code changes to Coding without calling the chat provider', async () => {
    const fetchMock = vi.fn();
    const onOpenCoding = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" onOpenCoding={onOpenCoding} />);

    const goal = 'ログイン画面のバグを修正して、関連テストも追加して';
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: goal } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(onOpenCoding).toHaveBeenCalledWith(goal));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/コード画面に内容を引き継ぎました/)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('recognizes explicit Create-workspace requests without hijacking ordinary image generation', () => {
    expect(isDirectCreativeWorkspaceRequest('Creativeワークスペースで新商品のSNSカードを作って')).toBe(true);
    expect(isDirectCreativeWorkspaceRequest('Use the Creative workspace to make a launch social card')).toBe(true);
    expect(isDirectCreativeWorkspaceRequest('夕焼けの海の画像を作ってください')).toBe(false);
    expect(isDirectCreativeWorkspaceRequest('Create a cinematic image of Tokyo at night')).toBe(false);
    expect(isDirectCreativeWorkspaceRequest('Creativeワークスペースの仕組みを説明して')).toBe(false);
  });

  it('opens the Create panel beside the conversation for explicit Create requests, with the original brief and no provider call', async () => {
    const fetchMock = vi.fn();
    const onOpenCreative = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" onOpenCreative={onOpenCreative} />);

    const request = 'Creativeワークスペースで新商品のSNSカードを作って';
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: request } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(onOpenCreative).toHaveBeenCalledWith(request));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/「作る」パネルを会話のそばに開きました/)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('uses procedural raster only when the user explicitly asks for procedural artwork', () => {
    expect(isExplicitLocalProceduralImageRequest('手続き型のPNG画像を作ってください')).toBe(true);
    expect(isExplicitLocalProceduralImageRequest('Create procedural artwork')).toBe(true);
    expect(isExplicitLocalProceduralImageRequest('夕焼けの海の画像を作ってください')).toBe(false);
    expect(isExplicitLocalProceduralImageRequest('風景')).toBe(false);
  });

  it('recognizes explicit image creation requests without hijacking image-related questions', () => {
    expect(isDirectImageGenerationRequest('夕焼けの海の画像を作ってください')).toBe(true);
    expect(isDirectImageGenerationRequest('Create a cinematic image of Tokyo at night')).toBe(true);
    expect(isDirectImageGenerationRequest('画像生成AIの仕組みを教えてください')).toBe(false);
  });

  it('maps standard and exact image sizes consistently with the visual template engine', () => {
    expect(rasterSizeForRequest('Instagram 4:5のフィード投稿を作って')).toEqual({ width: 1024, height: 1280 });
    expect(rasterSizeForRequest('Instagram Story 9:16で作って')).toEqual({ width: 864, height: 1536 });
    expect(rasterSizeForRequest('YouTubeサムネイルを作って')).toEqual({ width: 1536, height: 864 });
    expect(rasterSizeForRequest('A4印刷用のポスターを作って')).toEqual({ width: 1086, height: 1536 });
    expect(rasterSizeForRequest('人物ポートレートを2:3で作って')).toEqual({ width: 1024, height: 1536 });
    expect(rasterSizeForRequest('1200×628で広告画像を作って')).toEqual({ width: 1200, height: 628 });
    expect(rasterSizeForRequest('2000×1000で画像を作って')).toEqual({ width: 1024, height: 1024 });
  });

  it('recognizes broader visual creation language without hijacking explanatory questions', () => {
    expect(isDirectImageGenerationRequest('猫の絵を描いて')).toBe(true);
    expect(isDirectImageGenerationRequest('ORIGINのロゴを作って')).toBe(true);
    expect(isDirectImageGenerationRequest('Design a premium app icon')).toBe(true);
    expect(isDirectImageGenerationRequest('画像生成AIの仕組みを教えて')).toBe(false);
  });

  it('keeps a vague image request in a focused clarification loop before generation', async () => {
    const digest = new Uint8Array(32);
    digest.fill(0xcd);
    const sha = Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: false,
        code: 'IMAGE_REQUIREMENTS_INCOMPLETE',
        questions: ['何を主役にした画像にしますか？'],
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'attachment; filename="origin-image.png"',
          'X-Origin-Visual-Verified': 'true',
          'X-Origin-Visual-Sha256': sha,
          'X-Origin-Visual-Provider': 'cloudflare-workers-ai-free',
          'X-Origin-Visual-Model': '@cf/black-forest-labs/flux-2-klein-4b',
          'X-Origin-Visual-Generation-Id': `raster-${sha.slice(0, 24)}`,
          'X-Origin-Visual-Brain': 'visual-brain-v1',
          'X-Origin-Visual-Plan': 'raster-visual-plan-v1',
          'X-Origin-Visual-Purpose': 'photograph',
          'X-Origin-Visual-Critic': 'raster-structural-critic-v1',
          'X-Origin-Visual-Quality-Score': '100',
          'X-Origin-Visual-Actual-Width': '1024',
          'X-Origin-Visual-Actual-Height': '1024',
          'X-Origin-Visual-Typography-Overlay': 'not-required',
          'X-Origin-Visual-Plan-Sha256': 'd'.repeat(64),
          'X-Origin-Visual-Width': '1024',
          'X-Origin-Visual-Height': '1024',
          'X-Origin-Free-Only': 'true',
          'X-Origin-Cost-Usd': '0',
          'X-Origin-Paid-Fallback': 'false',
          'X-Origin-Secret-Delivery': 'server-only',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: vi.fn(async () => digest.buffer) } },
    });
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:origin-clarified-image') });

    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '画像を作ってください' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText(/何を主役にした画像にしますか/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId('origin-chat-request'), { target: { value: '朝焼けの富士山をリアルな写真で' } });
    fireEvent.click(screen.getByTestId('send-request-button'));
    await waitFor(() => expect(screen.getByAltText('ORIGINが生成した画像')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.prompt).toContain('画像を作ってください');
    expect(secondBody.prompt).toContain('追加条件: 朝焼けの富士山をリアルな写真で');

    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    vi.unstubAllGlobals();
  });

  it('keeps a clarification answer in the image path when it is queued offline and drained after reconnecting', async () => {
    const digest = new Uint8Array(32);
    digest.fill(0xef);
    const sha = Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    let imageCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (requestPath(input) === '/api/generate-image') {
        imageCallCount += 1;
        if (imageCallCount === 1) {
          return new Response(JSON.stringify({
            ok: false,
            code: 'IMAGE_REQUIREMENTS_INCOMPLETE',
            questions: ['何を主役にした画像にしますか？'],
          }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Disposition': 'attachment; filename="origin-image.png"',
            'X-Origin-Visual-Verified': 'true',
            'X-Origin-Visual-Sha256': sha,
            'X-Origin-Visual-Provider': 'cloudflare-workers-ai-free',
            'X-Origin-Visual-Model': '@cf/black-forest-labs/flux-2-klein-4b',
            'X-Origin-Visual-Generation-Id': `raster-${sha.slice(0, 24)}`,
            'X-Origin-Visual-Brain': 'visual-brain-v1',
            'X-Origin-Visual-Plan': 'raster-visual-plan-v1',
            'X-Origin-Visual-Purpose': 'photograph',
            'X-Origin-Visual-Critic': 'raster-structural-critic-v1',
            'X-Origin-Visual-Quality-Score': '100',
            'X-Origin-Visual-Actual-Width': '1024',
            'X-Origin-Visual-Actual-Height': '1024',
            'X-Origin-Visual-Typography-Overlay': 'not-required',
            'X-Origin-Visual-Plan-Sha256': 'e'.repeat(64),
            'X-Origin-Visual-Width': '1024',
            'X-Origin-Visual-Height': '1024',
            'X-Origin-Free-Only': 'true',
            'X-Origin-Cost-Usd': '0',
            'X-Origin-Paid-Fallback': 'false',
            'X-Origin-Secret-Delivery': 'server-only',
          },
        });
      }
      const model = 'google/gemma-4-31b-it:free';
      return new Response(JSON.stringify({
        content: '通常の回答です',
        routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: vi.fn(async () => digest.buffer) } },
    });
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:origin-offline-clarified-image') });
    const onlineDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    const setOnline = (value: boolean) => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
      fireEvent(window, new Event(value ? 'online' : 'offline'));
    };

    try {
      render(<App language="ja" />);
      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '画像を作ってください' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      await waitFor(() => expect(screen.getByText(/何を主役にした画像にしますか/)).toBeTruthy());
      expect(imageCallCount).toBe(1);

      // The connection drops before the user answers the clarification
      // question: the answer joins the offline send queue. Queueing must
      // carry the image intent with it instead of silently dropping it.
      setOnline(false);
      await waitFor(() => expect(screen.getByTestId('origin-offline-status')).toBeTruthy());
      fireEvent.change(screen.getByTestId('origin-chat-request'), { target: { value: '朝焼けの富士山をリアルな写真で' } });
      fireEvent.click(screen.getByTestId('send-request-button'));
      await waitFor(() => expect(screen.getByTestId('origin-send-queue')).toBeTruthy());
      expect(within(screen.getByTestId('origin-send-queue')).getByText('朝焼けの富士山をリアルな写真で')).toBeTruthy();
      expect(imageCallCount).toBe(1);
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/chat')).toBe(false);

      // Once the connection returns, the queued answer drains back into the
      // raster path with the original request plus the answer combined —
      // it must not fall through to plain chat.
      setOnline(true);
      await waitFor(() => expect(screen.getByAltText('ORIGINが生成した画像')).toBeTruthy(), { timeout: 5000 });
      expect(imageCallCount).toBe(2);
      const imageCalls = fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/generate-image');
      const secondBody = JSON.parse(String(imageCalls[1]?.[1]?.body));
      expect(secondBody.prompt).toContain('画像を作ってください');
      expect(secondBody.prompt).toContain('追加条件: 朝焼けの富士山をリアルな写真で');
      expect(fetchMock.mock.calls.some(([input]) => requestPath(input) === '/api/chat')).toBe(false);
    } finally {
      if (onlineDescriptor) Object.defineProperty(window.navigator, 'onLine', onlineDescriptor);
      else delete (window.navigator as { onLine?: boolean }).onLine;
      if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
      vi.unstubAllGlobals();
    }
  });

  it('routes an image request to real raster generation and never falls through to text prompt generation', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const digest = new Uint8Array(32);
    digest.fill(0xab);
    const sha = Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      expect(String(input)).toBe('/api/generate-image');
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'attachment; filename="origin-image.png"',
          'X-Origin-Visual-Verified': 'true',
          'X-Origin-Visual-Sha256': sha,
          'X-Origin-Visual-Provider': 'cloudflare-workers-ai-free',
          'X-Origin-Visual-Model': '@cf/black-forest-labs/flux-2-klein-4b',
          'X-Origin-Visual-Generation-Id': `raster-${sha.slice(0, 24)}`,
          'X-Origin-Visual-Brain': 'visual-brain-v1',
          'X-Origin-Visual-Plan': 'raster-visual-plan-v1',
          'X-Origin-Visual-Purpose': 'photograph',
          'X-Origin-Visual-Critic': 'raster-structural-critic-v1',
          'X-Origin-Visual-Quality-Score': '100',
          'X-Origin-Visual-Actual-Width': '1024',
          'X-Origin-Visual-Actual-Height': '1024',
          'X-Origin-Visual-Typography-Overlay': 'not-required',
          'X-Origin-Visual-Plan-Sha256': 'c'.repeat(64),
          'X-Origin-Visual-Width': '1024',
          'X-Origin-Visual-Height': '1024',
          'X-Origin-Free-Only': 'true',
          'X-Origin-Cost-Usd': '0',
          'X-Origin-Paid-Fallback': 'false',
          'X-Origin-Secret-Delivery': 'server-only',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: vi.fn(async () => digest.buffer) } },
    });
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:origin-generated-image') });

    const onMessagesChange = vi.fn();
    render(<App language="ja" onMessagesChange={onMessagesChange} />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '夕焼けの海の画像を作ってください' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByAltText('ORIGINが生成した画像')).toBeTruthy());
    expect(screen.getByText('画像ができました。')).toBeTruthy();
    expect(screen.queryByText(/\$0 verified/i)).toBeNull();
    expect(screen.getByRole('link', { name: '画像を保存' }).getAttribute('download')).toBe('origin-image.png');
    expect(screen.getByText(/1024×1024/)).toBeTruthy();
    await waitFor(() => {
      const emitted = onMessagesChange.mock.calls.flatMap((call) => call[0] as ConversationMessage[]);
      const generated = emitted.find((message) => message.image?.sha256 === sha);
      expect(generated?.image?.providerId).toBe('cloudflare-workers-ai-free');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ prompt: '夕焼けの海の画像を作ってください', width: 1024, height: 1024 });

    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    vi.unstubAllGlobals();
  });

  it('keeps repeated variation prompts bounded to the original visual brief', () => {
    const first = buildRasterVariationPrompt('夕焼けの海の画像を作ってください');
    const second = buildRasterVariationPrompt(first);
    expect(second).toBe(first);
    expect(second.match(/Create a clearly distinct alternative variation\./g)).toHaveLength(1);
    expect(second.length).toBeLessThanOrEqual(2_000);
  });

  it('builds a preserve-by-default guided edit contract from the original visual request', () => {
    const prompt = buildRasterGuidedEditPrompt('青い陶器のマグカップを正方形の商品写真で作ってください');
    expect(prompt).toContain('青い陶器のマグカップ');
    expect(prompt).toContain('Edit the verified source image');
    expect(prompt).toContain('Preserve the original subject identity');
    expect(prompt).toContain('does not explicitly ask to change');
  });

  it('routes a lineage-aware alternative through bounded reference-image editing', async () => {
    const bytes1 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const bytes2 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6, 7, 8]);
    const digest1 = new Uint8Array(32); digest1.fill(0xab);
    const digest2 = new Uint8Array(32); digest2.fill(0xcd);
    const sha1 = Array.from(digest1).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const sha2 = Array.from(digest2).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const responseFor = (bytes: Uint8Array, sha: string, task: 'generate' | 'edit' = 'generate') => new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="origin-image.png"',
        'X-Origin-Visual-Verified': 'true',
        'X-Origin-Visual-Sha256': sha,
        'X-Origin-Visual-Provider': 'cloudflare-workers-ai-free',
        'X-Origin-Visual-Model': '@cf/black-forest-labs/flux-2-klein-4b',
        'X-Origin-Visual-Generation-Id': `raster-${sha.slice(0, 24)}`,
        'X-Origin-Visual-Brain': 'visual-brain-v1',
        'X-Origin-Visual-Plan': 'raster-visual-plan-v1',
        'X-Origin-Visual-Purpose': 'photograph',
        'X-Origin-Visual-Template': 'general-square',
        'X-Origin-Visual-Safe-Margin-Pct': '7',
        'X-Origin-Visual-Typography-Zone': 'bottom',
        'X-Origin-Visual-Critic': 'raster-structural-critic-v1',
        'X-Origin-Visual-Quality-Score': '100',
        'X-Origin-Visual-Actual-Width': '1024',
        'X-Origin-Visual-Actual-Height': '1024',
        'X-Origin-Visual-Typography-Overlay': 'not-required',
        'X-Origin-Visual-Plan-Sha256': 'e'.repeat(64),
        'X-Origin-Visual-Width': '1024',
        'X-Origin-Visual-Height': '1024',
        'X-Origin-Free-Only': 'true',
        'X-Origin-Cost-Usd': '0',
        'X-Origin-Paid-Fallback': 'false',
        'X-Origin-Secret-Delivery': 'server-only',
        'X-Origin-Visual-Task': task,
        'X-Origin-Visual-Reference-Count': task === 'edit' ? '1' : '0',
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFor(bytes1, sha1, 'generate'))
      .mockResolvedValueOnce(responseFor(bytes2, sha2, 'edit'));
    vi.stubGlobal('fetch', fetchMock);
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: vi.fn()
        .mockResolvedValueOnce(digest1.buffer)
        .mockResolvedValueOnce(digest2.buffer) } },
    });
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn()
        .mockReturnValueOnce('blob:origin-generated-image')
        .mockReturnValueOnce('blob:origin-variation-image'),
    });
    const onMessagesChange = vi.fn();

    render(<App language="ja" onMessagesChange={onMessagesChange} />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '夕焼けの海の画像を作ってください' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByRole('button', { name: '別案を作る' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '別案を作る' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/generate-image');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/creative/v1.5/raster/edit');
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.prompt).toContain('夕焼けの海の画像を作ってください');
    expect(secondBody.prompt).toContain('Create a clearly distinct alternative variation');
    expect(secondBody).toMatchObject({ width: 1024, height: 1024 });
    expect(secondBody.referenceImages).toEqual(['data:image/webp;base64,QUJDRA==']);
    const latestMessages = onMessagesChange.mock.calls.at(-1)?.[0] as Array<{ image?: { relation?: string; parentId?: string; prompt?: string } }>;
    const latestImage = [...latestMessages].reverse().find((message) => message.image)?.image;
    expect(latestImage).toMatchObject({ relation: 'variation', parentId: sha1 });
    expect(latestImage?.prompt).toContain('Create a clearly distinct alternative variation');

    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    vi.unstubAllGlobals();
  });

  it('withholds raster output when the local technical critic rejects the decoded image', async () => {
    const criticModule = await import('./creative/rasterTechnicalCriticV15');
    vi.mocked(criticModule.inspectRasterBlobV15).mockResolvedValueOnce({
      version: 'raster-technical-critic-v1',
      passed: false,
      score: 12,
      checks: ['non-empty-alpha'],
      issues: ['near-uniform-image', 'insufficient-visual-information'],
      metrics: {
        width: 96,
        height: 96,
        sampledPixels: 9216,
        opaqueCoverage: 1,
        meanLuminance: 0.5,
        luminanceStdDev: 0,
        darkClipRatio: 0,
        brightClipRatio: 0,
        edgeEnergy: 0,
        histogramEntropy: 0,
      },
    });

    const digest = new Uint8Array(32);
    digest.fill(0xef);
    const sha = Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const fetchMock = vi.fn(async () => new Response(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
      {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'attachment; filename="origin-image.png"',
          'X-Origin-Visual-Verified': 'true',
          'X-Origin-Visual-Sha256': sha,
          'X-Origin-Visual-Provider': 'cloudflare-workers-ai-free',
          'X-Origin-Visual-Model': '@cf/black-forest-labs/flux-2-klein-4b',
          'X-Origin-Visual-Generation-Id': `raster-${sha.slice(0, 24)}`,
          'X-Origin-Visual-Brain': 'visual-brain-v1',
          'X-Origin-Visual-Plan': 'raster-visual-plan-v1',
          'X-Origin-Visual-Purpose': 'photograph',
          'X-Origin-Visual-Critic': 'raster-structural-critic-v1',
          'X-Origin-Visual-Quality-Score': '100',
          'X-Origin-Visual-Actual-Width': '1024',
          'X-Origin-Visual-Actual-Height': '1024',
          'X-Origin-Visual-Typography-Overlay': 'not-required',
          'X-Origin-Visual-Plan-Sha256': 'f'.repeat(64),
          'X-Origin-Visual-Width': '1024',
          'X-Origin-Visual-Height': '1024',
          'X-Origin-Free-Only': 'true',
          'X-Origin-Cost-Usd': '0',
          'X-Origin-Paid-Fallback': 'false',
          'X-Origin-Secret-Delivery': 'server-only',
        },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: vi.fn(async () => digest.buffer) } },
    });

    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '夕焼けの海の画像を作ってください' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByText(/品質チェックを通らなかったため/)).toBeTruthy());
    expect(screen.queryByAltText('ORIGINが生成した画像')).toBeNull();

    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    vi.unstubAllGlobals();
  });

  it('withholds raster output when source critic evidence is below the exact display gate', async () => {
    const sha = 'a'.repeat(64);
    const fetchMock = vi.fn(async () => new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="origin-image.png"',
        'X-Origin-Visual-Verified': 'true',
        'X-Origin-Visual-Sha256': sha,
        'X-Origin-Visual-Provider': 'cloudflare-workers-ai-free',
        'X-Origin-Visual-Model': '@cf/black-forest-labs/flux-2-klein-4b',
        'X-Origin-Visual-Generation-Id': `raster-${sha.slice(0, 24)}`,
        'X-Origin-Visual-Brain': 'visual-brain-v1',
        'X-Origin-Visual-Plan': 'raster-visual-plan-v1',
        'X-Origin-Visual-Purpose': 'photograph',
        'X-Origin-Visual-Critic': 'raster-structural-critic-v1',
        'X-Origin-Visual-Quality-Score': '75',
        'X-Origin-Visual-Actual-Width': '1024',
        'X-Origin-Visual-Actual-Height': '1024',
        'X-Origin-Visual-Typography-Overlay': 'not-required',
        'X-Origin-Visual-Plan-Sha256': 'c'.repeat(64),
        'X-Origin-Visual-Width': '1024',
        'X-Origin-Visual-Height': '1024',
        'X-Origin-Free-Only': 'true',
        'X-Origin-Cost-Usd': '0',
        'X-Origin-Paid-Fallback': 'false',
        'X-Origin-Secret-Delivery': 'server-only',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '夕焼けの海の画像を作ってください' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByTestId('origin-safe-waiting-state')).toBeTruthy());
    expect(screen.queryByAltText('ORIGINが生成した画像')).toBeNull();
    expect(screen.queryByRole('link', { name: '画像を保存' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('uses executive-native English instructions while retaining the single fixed free model', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('Executive response', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="en" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'Assess the options' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string; systemPrompt: string };
    expect(request.model).toBe('google/gemma-4-31b-it:free');
    expect(request.systemPrompt).toBe(getOriginSystemPrompt('en'));
    for (const phrase of ['executive-grade', 'trade-offs', 'risks', 'next action', 'verified facts', 'never invent sources', 'material unknowns', 'do not stop at a terse overview', 'production-ready', 'never substitute an image-generation prompt', 'never spend the first turn asking only questions', 'usable first draft', 'production-process disclaimer', 'version numbers or production-process labels', 'at most one or two high-impact refinement questions']) expect(request.systemPrompt).toContain(phrase);
    const japanesePrompt = getOriginSystemPrompt('ja');
    for (const phrase of ['結論を1文で先に', '確認済みの事実と推論・仮定を区別', '出典や完了実績を創作せず', '重要な未確認点は明示', '短い概要だけで打ち切らず', '汎用デモを勝手に題材へ選ばず', '指定された形式は守り', '画像生成プロンプト・SVG・HTML・文章説明を代用品として返さない', 'Artifact-1のような機械的な名前', '端末内保存', '質問だけで最初の1ターンを使い切らない', 'すぐに使える叩き台', '制作過程の内部ラベル', '最大1〜2個だけ']) expect(japanesePrompt).toContain(phrase);
    // K-03 (2026-11-24): the internal production label itself is gone
    // from the Japanese instruction, so the model no longer echoes it
    // into answer headings.
    expect(japanesePrompt).not.toContain('Version 1');
    vi.unstubAllGlobals();
  });

  it('searches local sessions, artifact code, and immutable revisions without a network request', () => {
    const session: ConversationSession = { id: 'session-1', title: 'Database migration', createdAt: 1, messages: [{ id: 'm-1', role: 'user', content: 'IndexedDBの耐障害性を確認する' }] };
    const indexedArtifact: ArtifactBlock = { ...artifact, id: 'artifact-search', title: 'Storage repository', content: 'const storage = indexedDB;', revisions: [{ id: 'artifact-search:v1', content: 'legacy localStorage migration', createdAt: 1, source: 'generated' }, { id: 'artifact-search:v2', content: 'quota safe revision', createdAt: 2, source: 'direct-touch' }] };
    expect(searchOriginLocalSnapshot('IndexedDB', [session], [indexedArtifact]).map((result) => result.kind)).toContain('session');
    expect(searchOriginLocalSnapshot('quota safe', [session], [indexedArtifact])).toEqual([expect.objectContaining({ kind: 'artifact', id: 'artifact-search' })]);
    expect(searchOriginLocalSnapshot('network request', [session], [indexedArtifact])).toEqual([]);
  });

  it('cuts history excerpts at a sentence or phrase boundary instead of mid-word', () => {
    // Short enough: returned as-is, without an ellipsis.
    expect(excerptAtBoundary('短い文です。', 160)).toBe('短い文です。');
    // A sentence end inside the limit wins over a raw character cut.
    const sentence = `${'あ'.repeat(50)}。${'い'.repeat(120)}`;
    expect(excerptAtBoundary(sentence, 100)).toBe(`${'あ'.repeat(50)}。…`);
    // Without a sentence end, a 読点 boundary is used.
    const phrase = `${'う'.repeat(60)}、${'え'.repeat(80)}`;
    expect(excerptAtBoundary(phrase, 100)).toBe(`${'う'.repeat(60)}…`);
    // No boundary at all: hard cut plus ellipsis, never longer than max + 1.
    const hard = excerptAtBoundary('お'.repeat(200), 100);
    expect(hard).toBe(`${'お'.repeat(100)}…`);
    expect(hard.length).toBe(101);
  });

  it('falls back to a particle boundary so history excerpts do not split a word', () => {
    // No punctuation inside the limit: the cut backs off to just after
    // the particle は instead of splitting 運営計画 mid-word.
    const bunsetsu = `${'あ'.repeat(45)}運営計画は${'い'.repeat(100)}`;
    expect(excerptAtBoundary(bunsetsu, 60)).toBe(`${'あ'.repeat(45)}運営計画は…`);
    // Two-character particles （から） are boundaries too.
    const suffix = `${'か'.repeat(50)}から${'き'.repeat(80)}`;
    expect(excerptAtBoundary(suffix, 60)).toBe(`${'か'.repeat(50)}から…`);
    // A closing bracket is a boundary and stays attached to its phrase.
    const bracket = `${'さ'.repeat(55)}「補足」${'し'.repeat(80)}`;
    expect(excerptAtBoundary(bracket, 60)).toBe(`${'さ'.repeat(55)}「補足」…`);
  });

  it('strips Markdown notation from history display text without touching plain text', () => {
    // The round-5 design evaluation found a raw ** at the excerpt head.
    expect(stripMarkdownForDisplay('**2026年の日本の祝日一覧（振替休日含む）** - 1月1日は元日です')).toBe('2026年の日本の祝日一覧（振替休日含む） - 1月1日は元日です');
    expect(stripMarkdownForDisplay('# 見出し\n本文は[リンク文字](https://example.com)と`code`と~~取消~~です')).toBe('見出し\n本文はリンク文字とcodeと取消です');
    expect(stripMarkdownForDisplay('- 項目1\n- 項目2')).toBe('項目1\n項目2');
    expect(stripMarkdownForDisplay('```ts\nconst a = 1;\n```')).toBe('\nconst a = 1;\n');
    expect(historyExcerptText('```ts\nconst a = 1;\n```', 160)).toBe('const a = 1;');
    // Identifiers with underscores are not Markdown and stay intact.
    expect(stripMarkdownForDisplay('ORIGIN_VOICE_OUTPUT_ENABLED を確認する')).toBe('ORIGIN_VOICE_OUTPUT_ENABLED を確認する');
    expect(stripMarkdownForDisplay('ただの文章です。')).toBe('ただの文章です。');
  });

  it('removes Markdown table syntax from history display text', () => {
    // P7 A-3: separator rows vanish and cell rows lose their pipes, so
    // a pasted table never leaks "|" into a history title or excerpt.
    expect(stripMarkdownForDisplay('| 項目 | 値 |\n| --- | --- |\n| 首都 | 東京 |')).toBe('項目 値\n首都 東京');
    expect(historyExcerptText('| a | b |', 160)).toBe('a b');
  });

  it('builds history titles from the first user message only, formatted at creation time', () => {
    // P7 A-3: assistant-first sessions no longer borrow the answer's
    // heading (the "Version 1（仮設計）" title pollution path).
    expect(historySessionTitle([])).toBe('ORIGIN セッション');
    expect(historySessionTitle([{ id: 'a1', role: 'assistant', content: 'Version 1（仮設計）\n回答本文' }])).toBe('ORIGIN セッション');
    // Markdown and tables are stripped before the boundary cut, so the
    // stored title matches what the drawer displays.
    expect(historySessionTitle([{ id: 'u1', role: 'user', content: '**旅行**の相談\n| 日 | 場所 |\n| --- | --- |\n| 1日目 | 東京 |' }])).toBe('旅行の相談 日 場所 1日目 東京');
    // A leading internal-label line is dropped; the next line is used.
    expect(historySessionTitle([{ id: 'u1', role: 'user', content: 'Version 1（仮設計）\n鎌倉の行程を相談' }])).toBe('鎌倉の行程を相談');
    // displayContent wins over content, matching the drawer display.
    expect(historySessionTitle([{ id: 'u1', role: 'user', content: '内部指示文', displayContent: '要点だけ' }])).toBe('要点だけ');
  });

  it('collapses content-identical history sessions keeping the newest copy', () => {
    // P7 B-2: the same conversation archived through a different id
    // path is folded by content (first user text + last message id).
    const older: ConversationSession = { id: 'session-startup-m1', title: '相談', createdAt: 1, messages: [{ id: 'm1', role: 'user', content: '相談です' }, { id: 'm2', role: 'assistant', content: '回答です' }] };
    const newer: ConversationSession = { id: 'session-other-m1', title: '相談', createdAt: 5, messages: [{ id: 'm1', role: 'user', content: '相談です' }, { id: 'm2', role: 'assistant', content: '回答です' }] };
    const distinct: ConversationSession = { id: 'session-distinct', title: '別の相談', createdAt: 3, messages: [{ id: 'x1', role: 'user', content: '別の相談です' }, { id: 'x2', role: 'assistant', content: '別の回答です' }] };
    expect(dedupeHistorySessions([older, distinct, newer]).map((session) => session.id)).toEqual(['session-distinct', 'session-other-m1']);
    // Same opening but a different last message is a different conversation.
    const continued: ConversationSession = { id: 'session-continued', title: '相談', createdAt: 9, messages: [{ id: 'm1', role: 'user', content: '相談です' }, { id: 'm3', role: 'assistant', content: '続きの回答です' }] };
    expect(dedupeHistorySessions([older, continued])).toHaveLength(2);
    // Sessions without messages are never folded together.
    expect(dedupeHistorySessions([{ id: 'e1', title: '', createdAt: 1, messages: [] }, { id: 'e2', title: '', createdAt: 2, messages: [] }])).toHaveLength(2);
  });

  it('formats history titles and excerpts through the same Markdown-free boundary cut', () => {
    expect(historyExcerptText('短い文です。', 160)).toBe('短い文です。');
    expect(historyExcerptText('**2026年の日本の祝日一覧（振替休日含む）** - 1月1日は元日です', 160)).toBe('2026年の日本の祝日一覧（振替休日含む） - 1月1日は元日です');
    const bold = historyExcerptText(`**${'あ'.repeat(45)}運営計画は${'い'.repeat(100)}**`, 60);
    expect(bold).toBe(`${'あ'.repeat(45)}運営計画は…`);
    expect(bold).not.toContain('*');
  });

  it('takes history excerpts from the first exchange so the excerpt matches the title (K-14)', () => {
    // タイトルは最初の利用者メッセージから作られる。抜粋の源も同じ
    // 最初の交換に固定しないと、会話が別の話題へ進んだ途端にタイトルと
    // 抜粋が食い違い、データの取り違えに見える（LIVE-5 の実働証拠）。
    const drifted: ConversationSession = {
      id: 'k14-drifted', title: '最低賃金について教えて', createdAt: 1,
      messages: [
        { id: 'u1', role: 'user', content: '最低賃金について教えて' },
        { id: 'a1', role: 'assistant', content: '2026年度の最低賃金は全国加重平均で1,121円です。' },
        { id: 'u2', role: 'user', content: 'ついでに祝日も教えて' },
        { id: 'a2', role: 'assistant', content: '2026年の祝日一覧は次のとおりです。1月1日は元日です。' },
      ],
    };
    expect(historySessionExcerptSource(drifted)).toBe('2026年度の最低賃金は全国加重平均で1,121円です。');
    expect(historySessionExcerpt(drifted)).toContain('最低賃金');
    expect(historySessionExcerpt(drifted)).not.toContain('祝日');
    // 検索結果の detail も同じ抜粋になる（経路の一貫性）。
    const found = searchOriginLocalSnapshot('祝日', [drifted], []);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toBe(historySessionExcerpt(drifted));
    // 回答がまだ無い会話は、最初の利用者メッセージが源になる。
    const unanswered: ConversationSession = { id: 'k14-unanswered', title: '質問だけの会話です', createdAt: 2, messages: [{ id: 'u1', role: 'user', content: '質問だけの会話です' }] };
    expect(historySessionExcerpt(unanswered)).toBe('質問だけの会話です');
    // 利用者メッセージが無い旧データは、最後のメッセージに落とす。
    const legacy: ConversationSession = { id: 'k14-legacy', title: 'ORIGIN セッション', createdAt: 3, messages: [{ id: 'a1', role: 'assistant', content: '回答だけの記録です' }] };
    expect(historySessionExcerpt(legacy)).toBe('回答だけの記録です');
    // 空のセッションは固定文。
    expect(historySessionExcerpt({ id: 'k14-empty', title: '', createdAt: 4, messages: [] })).toBe('会話');
    // 最初の交換が調整ターンでも、抜粋は調整後の回答（または表示ラベル）
    // であり、内部指示文にはならない（K-04 の表示解決と一致）。
    const refined: ConversationSession = {
      id: 'k14-refined', title: '回答を調整', createdAt: 5,
      messages: [
        { id: 'u1', role: 'user', content: '直前の回答を、実務でそのまま判断・実行に使える深さまで引き上げてください。', requestKind: 'refinement' },
        { id: 'a1', role: 'assistant', content: '調整した回答です。' },
      ],
    };
    expect(historySessionExcerpt(refined)).toBe('調整した回答です。');
    expect(historySessionExcerpt(refined)).not.toContain('実務でそのまま');
    const refinedOnly: ConversationSession = { id: 'k14-refined-only', title: '回答を調整', createdAt: 6, messages: [{ id: 'u1', role: 'user', content: '直前の回答を圧縮してください。', requestKind: 'refinement' }] };
    expect(historySessionExcerpt(refinedOnly)).toBe('回答を調整');
  });

  it('skips a failed first answer so the history excerpt reflects the first successful answer (2026-11-25)', () => {
    // 本番実測：最初の回答が「確認できなかったため」の定型文で、同じ
    // 会話で再送して正しい表が返ったのに、履歴の抜粋が失敗文のまま
    // 残り、答えた会話が「答えられなかった」と誤読された。抜粋の源は
    // 最初の成功した回答へ進める（タイトルとの対応は K-14 のまま）。
    const recovered: ConversationSession = {
      id: 'excerpt-recovered', title: '日本の歴代首相を表で10人挙げてください', createdAt: 10,
      messages: [
        { id: 'u1', role: 'user', content: '日本の歴代首相を表で10人挙げてください' },
        { id: 'a1', role: 'assistant', content: ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_JA, deliveryState: 'verified' },
        { id: 'u2', role: 'user', content: '日本の歴代首相を表で10人挙げてください' },
        { id: 'a2', role: 'assistant', content: '歴代首相を表で10人挙げます。初代は伊藤博文です。', deliveryState: 'verified' },
      ],
    };
    expect(historySessionExcerptSource(recovered)).toBe('歴代首相を表で10人挙げます。初代は伊藤博文です。');
    expect(historySessionExcerpt(recovered)).not.toContain('確認できなかったため');
    // 英語の定型文も同じく失敗扱いになる。
    const recoveredEn: ConversationSession = {
      id: 'excerpt-recovered-en', title: 'List the prime ministers', createdAt: 11,
      messages: [
        { id: 'u1', role: 'user', content: 'List the prime ministers' },
        { id: 'a1', role: 'assistant', content: ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_EN, deliveryState: 'verified' },
        { id: 'a2', role: 'assistant', content: 'Here are the prime ministers in a table.', deliveryState: 'verified' },
      ],
    };
    expect(historySessionExcerptSource(recoveredEn)).toBe('Here are the prime ministers in a table.');
    // 配送状態が error の回答・調査の失敗表示も飛ばす。
    const errorFirst: ConversationSession = {
      id: 'excerpt-error-first', title: '調べて', createdAt: 12,
      messages: [
        { id: 'u1', role: 'user', content: '調べて' },
        { id: 'a1', role: 'assistant', content: '調査できませんでした。', deliveryState: 'error', researchError: true },
        { id: 'a2', role: 'assistant', content: '調べた結果です。', deliveryState: 'verified' },
      ],
    };
    expect(historySessionExcerptSource(errorFirst)).toBe('調べた結果です。');
    // 成功した回答が一つも無い会話では、失敗文がその会話の実質として残る。
    const failedOnly: ConversationSession = {
      id: 'excerpt-failed-only', title: '日本の歴代首相を表で10人挙げてください', createdAt: 13,
      messages: [
        { id: 'u1', role: 'user', content: '日本の歴代首相を表で10人挙げてください' },
        { id: 'a1', role: 'assistant', content: ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_JA, deliveryState: 'verified' },
      ],
    };
    expect(historySessionExcerptSource(failedOnly)).toBe(ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_JA);
    // 判定自体の境界：利用者メッセージと通常の回答は失敗扱いしない。
    // 未完の部分回答は実質を含むため失敗扱いしない。
    expect(isHistoryExcerptFailureMessage({ id: 'u', role: 'user', content: ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_JA })).toBe(false);
    expect(isHistoryExcerptFailureMessage({ id: 'a', role: 'assistant', content: '通常の回答です。' })).toBe(false);
    expect(isHistoryExcerptFailureMessage({ id: 'a', role: 'assistant', content: '途中までの回答です。', truncated: true })).toBe(false);
    expect(isHistoryExcerptFailureMessage({ id: 'a', role: 'assistant', content: ORIGIN_UNGROUNDED_ASSERTION_FALLBACK_JA })).toBe(true);
  });

  it('does not split a surrogate pair at the history excerpt limit (K-14)', () => {
    const emoji = excerptAtBoundary(`${'あ'.repeat(99)}😀${'い'.repeat(100)}`, 100);
    expect(emoji).toBe(`${'あ'.repeat(99)}😀…`);
    expect(emoji).not.toContain('\uFFFD');
  });

  it('shows the first-exchange excerpt beside the title in the history drawer (K-14)', () => {
    const drifted: ConversationSession = {
      id: 'session-drift', title: '最低賃金について教えて', createdAt: 1,
      messages: [
        { id: 'u1', role: 'user', content: '最低賃金について教えて' },
        { id: 'a1', role: 'assistant', content: '2026年度の最低賃金は全国加重平均で1,121円です。' },
        { id: 'u2', role: 'user', content: 'ついでに祝日も教えて' },
        { id: 'a2', role: 'assistant', content: '2026年の祝日一覧は次のとおりです。' },
      ],
    };
    render(<App messages={[]} sessions={[drifted]} language="ja" />);
    fireEvent.click(screen.getByTestId('history-drawer-toggle'));
    const item = within(screen.getByTestId('history-session-list')).getByTestId('history-session-item-0');
    expect(item.textContent).toContain('最低賃金について教えて');
    expect(item.textContent).toContain('1,121円');
    expect(item.textContent).not.toContain('祝日一覧');
  });

  it('builds a display-only current-conversation session without duplicating an identical stored session', () => {
    const current: ConversationMessage[] = [
      { id: 'live-1', role: 'user', content: '今まさに話している会話' },
      { id: 'live-2', role: 'assistant', content: '応答本文です' },
    ];
    expect(currentConversationSession([], 10)).toBeNull();
    const built = currentConversationSession(current, 10);
    expect(built).toMatchObject({ id: 'session-current-live-1', title: '今まさに話している会話', createdAt: 10 });
    expect(built?.messages.map((message) => message.id)).toEqual(['live-1', 'live-2']);
    // P7 A-3: a session with no user message gets the fixed title
    // instead of borrowing the first answer's heading.
    expect(currentConversationSession([{ id: 'a1', role: 'assistant', content: '回答の見出し' }], 10)?.title).toBe('ORIGIN セッション');

    const past: ConversationSession = { id: 'session-past', title: 'Past session', createdAt: 1, messages: [{ id: 'past-1', role: 'user', content: 'Past question' }] };
    const merged = withCurrentConversationSession([past], current, 10);
    expect(merged.currentSessionId).toBe('session-current-live-1');
    expect(merged.sessions.map((session) => session.id)).toEqual(['session-current-live-1', 'session-past']);

    // 起動時の退避と同じ物差し（先頭メッセージID＋件数）が一致する場合は二重に出さない。
    const storedSame: ConversationSession = { id: 'session-startup-live-1', title: '今まさに話している会話', createdAt: 2, messages: current };
    const deduped = withCurrentConversationSession([storedSame], current, 10);
    expect(deduped.sessions.map((session) => session.id)).toEqual(['session-startup-live-1']);
    expect(deduped.currentSessionId).toBe('session-startup-live-1');

    expect(withCurrentConversationSession([past], [], 10)).toEqual({ sessions: [past], currentSessionId: null });
  });

  it('lists the current conversation beside past sessions in the history drawer and finds it by search', async () => {
    const restore = vi.fn();
    // schedule は「ハンドルを保持→後でコールバックが解除」の順序を前提にするため、
    // 同期実行モックではなくタイマー経由の非同期モックで実ブラウザに寄せる。
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    const past: ConversationSession = { id: 'session-past', title: '先週の旅行計画', createdAt: 1, messages: [{ id: 'past-1', role: 'user', content: '先週の旅行計画' }] };
    const current: ConversationMessage[] = [
      { id: 'live-1', role: 'user', content: '柚子胡椒の使い方を教えて' },
      { id: 'live-2', role: 'assistant', content: '柚子胡椒は鍋にも合います。' },
    ];
    render(<App messages={current} sessions={[past]} onRestoreSession={restore} language="ja" />);
    fireEvent.click(screen.getByTestId('history-drawer-toggle'));
    // 初期表示の一覧に、現在の会話と過去セッションの両方が畳み込まれずに出る。
    const list = screen.getByTestId('history-session-list');
    expect(within(list).getByTestId('history-session-item-0').textContent).toContain('現在の会話');
    expect(within(list).getByTestId('history-session-item-0').textContent).toContain('柚子胡椒の使い方を教えて');
    expect(within(list).getByTestId('history-session-item-1').textContent).toContain('先週の旅行計画');
    // 冗長な「会話 · 」接頭辞は出さない（2026-11-20 外部デザイン評価の
    // 指摘を受けた是正の固定）。現在の会話の目印だけは残る。
    expect(within(list).getByTestId('history-session-item-1').textContent).not.toContain('会話 ·');
    expect(within(list).getByTestId('history-session-item-1').textContent?.trim().startsWith('先週の旅行計画')).toBe(true);
    // 過去セッションは従来どおり復元される。
    fireEvent.click(screen.getByTestId('history-session-item-1'));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(past));
    await waitFor(() => expect(screen.queryByTestId('history-drawer')).toBeNull());
    // 送信直後の会話本文が履歴検索に一致する。
    fireEvent.click(screen.getByTestId('history-drawer-toggle'));
    fireEvent.change(screen.getByTestId('history-search-input'), { target: { value: '柚子胡椒' } });
    await waitFor(() => expect(screen.getByTestId('history-search-results').textContent).toContain('現在の会話'));
    expect(screen.getByTestId('history-search-results').textContent).toContain('柚子胡椒の使い方を教えて');
    // 現在の会話を選んでも復元は走らず、ドロワーが閉じるだけ。
    fireEvent.click(screen.getByTestId('history-search-result-0'));
    await waitFor(() => expect(screen.queryByTestId('history-drawer')).toBeNull());
    expect(restore).toHaveBeenCalledTimes(1);
    frame.mockRestore();
  });

  it('distinguishes same-title history sessions by creation time and folds content duplicates in the drawer', () => {
    // P7 B-2: identical titles get a creation-time label, and the same
    // conversation archived under a different id is folded into one row.
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    const now = Date.now();
    const first: ConversationSession = { id: 'session-a', title: '日本の首都はどこですか？', createdAt: now - 60_000, messages: [{ id: 'a-1', role: 'user', content: '日本の首都はどこですか？' }, { id: 'a-2', role: 'assistant', content: '東京です。' }] };
    const second: ConversationSession = { id: 'session-b', title: '日本の首都はどこですか？', createdAt: now, messages: [{ id: 'b-1', role: 'user', content: '日本の首都はどこですか？' }, { id: 'b-2', role: 'assistant', content: '東京です。' }] };
    const duplicate: ConversationSession = { id: 'session-b-copy', title: '日本の首都はどこですか？', createdAt: now - 30_000, messages: second.messages };
    render(<App messages={[]} sessions={[first, second, duplicate]} language="ja" />);
    fireEvent.click(screen.getByTestId('history-drawer-toggle'));
    const list = screen.getByTestId('history-session-list');
    const items = within(list).getAllByTestId(/history-session-item-/);
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.textContent).toMatch(/· \d{2}:\d{2}/);
    frame.mockRestore();
  });

  it('discards a paid or unverifiable API result and shows the safe-waiting UI instead of a response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 'PROVIDER_POLICY_VIOLATION' }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '安全な回答を依頼' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('無料で使えることを確認できなかったため、回答を表示できませんでした。しばらくしてから、もう一度お試しください。')).toBeTruthy());
    expect(screen.getByTestId('origin-safe-waiting-state').getAttribute('aria-live')).toBe('assertive');
    expect(screen.queryByText('表示してはいけない応答')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows the concrete busy notice without a verified Process Trace after the API retry is exhausted', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
      retryAttempted: true,
    }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '混雑時の動作を確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByText('今、無料AIが混み合っています。入力した内容は残っています。少し待ってから、もう一度お試しください。')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('adds the recovery estimate when a non-retryable 429 reports how long to wait', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 'PROVIDER_RATE_LIMITED',
      message: '無料AIの利用上限に達しました。',
      retryable: false,
      retryAttempted: false,
      retryAfterSeconds: 3600,
    }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '上限時の回復見込みを確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByText((content) => content.startsWith(
      '無料AIの利用上限に達しました。少し時間をおいてから、再試行してください。入力した内容は残っています。回復の目安は',
    ) && /回復の目安は(明日)?\d+時\d+分頃です。$/.test(content))).toBeTruthy());
    vi.unstubAllGlobals();
  });

  it('names the rate-limit cause for a non-retryable 429 and offers a manual retry that does not duplicate the user turn', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const valid = {
      content: '再試行で得られた検証済み回答',
      routing: {
        modelId: model,
        freeOnly: true,
        cost: 0,
        actualCostUsd: 0,
        estimatedCostUsd: 0,
        usage: { costUsd: 0 },
        providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false },
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(valid), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'PROVIDER_RATE_LIMITED',
        message: '無料AIの利用上限に達しました。',
        retryable: false,
        retryAttempted: false,
      }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '上限到達時の再試行' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByText('無料AIの利用上限に達しました。少し時間をおいてから、再試行してください。入力した内容は残っています。')).toBeTruthy());
    expect(screen.queryByText('エラーが発生しました。再度お試しください。')).toBeNull();
    const retryButton = screen.getByTestId('chat-retry-button');
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText('再試行で得られた検証済み回答')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('上限到達時の再試行')).toHaveLength(1);
    expect(screen.queryByTestId('chat-retry-button')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('does not offer a chat retry for a safe-waiting policy failure', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 'PROVIDER_POLICY_VIOLATION' }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'ポリシー失敗時の再試行ボタン確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByTestId('origin-safe-waiting-state')).toBeTruthy());
    expect(screen.queryByTestId('chat-retry-button')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('retries one explicitly retryable free-provider failure and accepts only the verified zero-cost result', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const valid = {
      content: '再試行後の検証済み回答',
      routing: {
        modelId: model,
        freeOnly: true,
        cost: 0,
        actualCostUsd: 0,
        estimatedCostUsd: 0,
        usage: { costUsd: 0 },
        providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false },
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(valid), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'PROVIDER_RATE_LIMITED',
        retryable: true,
        retryAttempted: false,
      }), { status: 429, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(valid), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '無料モデルの一時的な混雑を再試行' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByText('再試行後の検証済み回答')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).model).toBe(model);
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).model).toBe(model);
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('does not retry an edge-level transient /api/chat failure or display an unverified response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporary edge failure', { status: 503 }))
      .mockResolvedValueOnce(new Response('再試行してはいけない回答', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '一時エラー時も再試行しない' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByText('エラーが発生しました。再度お試しください。')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('再試行してはいけない回答')).toBeNull();
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('does not retry a temporary network timeout or display a verified response', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Network request timed out'))
      .mockResolvedValueOnce(new Response('タイムアウト後に表示してはいけない回答', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '通信障害時も再試行しない' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByText('通信が切れてしまい、回答を受け取れませんでした。入力した内容は残っています。接続を確認して、もう一度お試しください。')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('タイムアウト後に表示してはいけない回答')).toBeNull();
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('fails closed with the network notice, not the busy notice, after one network timeout', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network request timed out'));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '通信停止時の案内を確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    // A dropped connection is not congestion (PKG-2): the notice names the
    // network, and the busy wording must not appear.
    await waitFor(() => expect(screen.getByText('通信が切れてしまい、回答を受け取れませんでした。入力した内容は残っています。接続を確認して、もう一度お試しください。')).toBeTruthy());
    expect(screen.queryByText('今、無料AIが混み合っています。入力した内容は残っています。少し待ってから、もう一度お試しください。')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('rejects paid or substituted successful JSON responses before revealing their content', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const payload = {
      content: '表示してはいけない有料応答',
      routing: { modelId: model, freeOnly: true, cost: 0.01, actualCostUsd: 0.01, estimatedCostUsd: 0, usage: { costUsd: 0.01 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '無料条件を確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByTestId('origin-safe-waiting-state')).toBeTruthy());
    expect(screen.queryByText('表示してはいけない有料応答')).toBeNull();
    expect(screen.queryByLabelText('ORIGINの回答')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('accepts verified fixed-model JSON responses and rejects paid headers or unverifiable routing', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const valid = { content: '検証済みの無料回答', routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } } };
    expect(isFreeOnlyPolicyCompliantChatPayload(valid)).toBe(true);
    expect(isFreeOnlyPolicyCompliantChatPayload({ ...valid, routing: { ...valid.routing, freeOnly: false } })).toBe(false);
    expect(isFreeOnlyPolicyCompliantChatPayload({ ...valid, routing: { ...valid.routing, providerRouting: { ...valid.routing.providerRouting, servedModel: 'paid-model' } } })).toBe(false);
    expect(isFreeOnlyPolicyCompliantChatPayload({ content: 'ローカル応答', routing: { model: 'ORIGIN アプリ内処理', freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0 } })).toBe(true);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(valid), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '無料で回答' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('検証済みの無料回答')).toBeTruthy());
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('keeps a truncated SSE answer and appends the incomplete notice instead of discarding it (PKG-2)', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: '途中で終わる部分回答です' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: model, costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: false, truncated: true })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    // Stream rendering is batched through requestAnimationFrame; drive
    // frames with timers so the batch flushes inside the test's waits.
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    try {
      const { container } = render(<App language="ja" />);
      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '詳しく説明してください' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      await waitFor(() => expect(container.textContent).toContain('途中で終わる部分回答です'));
      await waitFor(() => expect(container.textContent).toContain('この回答は長さの上限で途中で終わっています'));
      expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    } finally {
      frame.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('keeps a truncated JSON answer with the incomplete notice (PKG-2)', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const payload = { content: '部分回答の本文です', routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false }, answerTruncated: true }, usage: { costUsd: 0 } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '詳しく説明してください' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(container.textContent).toContain('部分回答の本文です'));
    await waitFor(() => expect(container.textContent).toContain('この回答は長さの上限で途中で終わっています'));
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('withholds streamed content when response headers report a paid tier', async () => {
    const fetchMock = vi.fn(async () => new Response('Paid streaming response must remain hidden', {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'X-Origin-Cost-Usd': '0.001', 'X-Origin-Billing-Tier': 'paid' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="en" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'Validate billing safety' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByTestId('origin-safe-waiting-state').textContent).toContain('free-only policy-compliant response'));
    expect(screen.getByTestId('origin-safe-waiting-state').textContent).toContain('withheld');
    expect(screen.queryByText('Paid streaming response must remain hidden')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('verifies and keeps a completed upstream SSE response', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: '検証済みSSE回答' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: model, costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: false })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'SSEを検証' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('検証済みSSE回答')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('response-announcement')).toBeTruthy());
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows a downloadable file chip for a verified artifact carried by the completion event (PR-3a)', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('ppt/presentation.xml'), Buffer.from('deck-contents')]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const artifact = {
      id: `artifact-pptx-${sha256.slice(0, 20)}`,
      kind: 'presentation',
      artifactType: 'pptx',
      filename: 'proposal-deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sha256,
      byteLength: bytes.length,
      encoding: 'base64',
      data: bytes.toString('base64'),
      verified: true,
      verification: ['non-empty', 'zip-signature', 'pptx-package'],
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    };
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: '提案資料の構成案です' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: model, costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: false, artifacts: [artifact] })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:proposal-deck');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      render(<App language="ja" />);
      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '提案資料を作って' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      await waitFor(() => expect(screen.getByText('提案資料の構成案です')).toBeTruthy());
      await waitFor(() => expect(screen.getByTestId(`chat-file-artifact-${artifact.id}`)).toBeTruthy());
      const chip = screen.getByTestId(`chat-file-artifact-${artifact.id}`);
      expect(chip.textContent).toContain('proposal-deck.pptx');
      fireEvent.click(chip);
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(anchorClick).toHaveBeenCalled();
      expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    } finally {
      anchorClick.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('silently drops a completion-event artifact whose digest does not match (PR-3a)', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('ppt/presentation.xml'), Buffer.from('deck-contents')]);
    const declaredSha256 = createHash('sha256').update(Buffer.from('other-bytes')).digest('hex');
    const artifact = {
      id: `artifact-pptx-${declaredSha256.slice(0, 20)}`,
      kind: 'presentation',
      artifactType: 'pptx',
      filename: 'proposal-deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sha256: declaredSha256,
      byteLength: bytes.length,
      encoding: 'base64',
      data: bytes.toString('base64'),
      verified: true,
      verification: ['non-empty', 'zip-signature', 'pptx-package'],
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    };
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: '回答本文は表示されます' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: model, costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: false, artifacts: [artifact] })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '提案資料を作って' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('回答本文は表示されます')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('response-announcement')).toBeTruthy());
    expect(container.querySelector('[data-testid^="chat-file-artifact-"]')).toBeNull();
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('verifies and keeps a completed upstream SSE response served by the Cloudflare fallback route', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: 'フォールバック経由の検証済みSSE回答' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: '@cf/google/gemma-4-26b-a4b-it', costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: true })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'フォールバックSSEを検証' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('フォールバック経由の検証済みSSE回答')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('response-announcement')).toBeTruthy());
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    expect(screen.queryByText('今、無料AIが混み合っています。入力した内容は残っています。少し待ってから、もう一度お試しください。')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('verifies and keeps a completed upstream SSE response served by the Groq rotation model', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: 'Groq経由の検証済みSSE回答' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: 'openai/gpt-oss-20b', costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: true })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'GroqフォールバックSSEを検証' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('Groq経由の検証済みSSE回答')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('response-announcement')).toBeTruthy());
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('rejects an SSE completion that claims fallback serving by an unverified model', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: '表示してはいけない未検証フォールバック回答' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: 'paid-model', costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: true })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '未検証フォールバックを拒否' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('受け取った回答を確認できなかったため、表示できませんでした。入力した内容は残っています。もう一度お試しください。')).toBeTruthy());
    expect(screen.queryByText('表示してはいけない未検証フォールバック回答')).toBeNull();
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('rejects an SSE completion whose fallback flag contradicts the served model', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const contradictory = [
      { servedModel: '@cf/google/gemma-4-26b-a4b-it', fallbackUsed: false },
      { servedModel: model, fallbackUsed: true },
    ];
    for (const evidence of contradictory) {
      const body = [
        `data: ${JSON.stringify({ type: 'delta', text: '表示してはいけない矛盾した証拠の回答' })}`,
        `data: ${JSON.stringify({ type: 'complete', modelId: model, costEvidenceStatus: 'NOT_MEASURED', ...evidence })}`,
        'data: [DONE]',
        '',
      ].join('\n\n');
      const fetchMock = vi.fn(async () => new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
      }));
      vi.stubGlobal('fetch', fetchMock);
      const view = render(<App language="ja" />);
      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '矛盾した証拠を拒否' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      await waitFor(() => expect(screen.getByText('受け取った回答を確認できなかったため、表示できませんでした。入力した内容は残っています。もう一度お試しください。')).toBeTruthy());
      expect(screen.queryByText('表示してはいけない矛盾した証拠の回答')).toBeNull();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('rejects a fallback SSE completion without NOT_MEASURED cost evidence', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: '表示してはいけない費用証拠不備の回答' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: '@cf/google/gemma-4-26b-a4b-it', costEvidenceStatus: 'MEASURED', fallbackUsed: true })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '費用証拠不備を拒否' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('受け取った回答を確認できなかったため、表示できませんでした。入力した内容は残っています。もう一度お試しください。')).toBeTruthy());
    expect(screen.queryByText('表示してはいけない費用証拠不備の回答')).toBeNull();
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('admits only exactly-shaped verified fallback routing in JSON responses', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const cf = '@cf/google/gemma-4-26b-a4b-it';
    const fallbackPayload = (providerRouting: { requestedModel: string; servedModel: string; fallbackUsed: boolean }) => ({
      content: 'フォールバック経由の検証済み無料回答',
      routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting },
    });
    expect(isFreeOnlyPolicyCompliantChatPayload(fallbackPayload({ requestedModel: cf, servedModel: cf, fallbackUsed: true }))).toBe(true);
    expect(isFreeOnlyPolicyCompliantChatPayload(fallbackPayload({ requestedModel: 'openai/gpt-oss-120b', servedModel: 'openai/gpt-oss-120b', fallbackUsed: true }))).toBe(true);
    expect(isFreeOnlyPolicyCompliantChatPayload(fallbackPayload({ requestedModel: 'openai/gpt-oss-20b', servedModel: 'openai/gpt-oss-20b', fallbackUsed: true }))).toBe(true);
    expect(isFreeOnlyPolicyCompliantChatPayload(fallbackPayload({ requestedModel: 'paid-model', servedModel: 'paid-model', fallbackUsed: true }))).toBe(false);
    expect(isFreeOnlyPolicyCompliantChatPayload(fallbackPayload({ requestedModel: cf, servedModel: 'openai/gpt-oss-120b', fallbackUsed: true }))).toBe(false);
    expect(isFreeOnlyPolicyCompliantChatPayload(fallbackPayload({ requestedModel: cf, servedModel: cf, fallbackUsed: false }))).toBe(false);
    expect(isFreeOnlyPolicyCompliantChatPayload(fallbackPayload({ requestedModel: model, servedModel: model, fallbackUsed: true }))).toBe(false);
    const paidFallback = fallbackPayload({ requestedModel: cf, servedModel: cf, fallbackUsed: true });
    expect(isFreeOnlyPolicyCompliantChatPayload({ ...paidFallback, routing: { ...paidFallback.routing, usage: { costUsd: 0.01 } } })).toBe(false);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fallbackPayload({ requestedModel: cf, servedModel: cf, fallbackUsed: true })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'フォールバックJSONを検証' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('フォールバック経由の検証済み無料回答')).toBeTruthy());
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('rejects legacy numeric-zero SSE completion without explicit NOT_MEASURED evidence', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: '表示してはいけない旧形式の回答' })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: model, costUsd: 0, fallbackUsed: false })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '旧形式のSSEを拒否' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('受け取った回答を確認できなかったため、表示できませんでした。入力した内容は残っています。もう一度お試しください。')).toBeTruthy());
    expect(screen.queryByText('表示してはいけない旧形式の回答')).toBeNull();
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('discards a gracefully truncated upstream SSE response without completion proof', async () => {
    const body = `data: ${JSON.stringify({ type: 'delta', text: '保存してはいけない途中回答' })}\n\n`;
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '切断を検証' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    // An incomplete stream is named as such (PKG-2), not as congestion.
    await waitFor(() => expect(screen.getByText('回答の受信が途中で終わってしまったため、表示できませんでした。入力した内容は残っています。もう一度お試しください。')).toBeTruthy());
    expect(screen.queryByText('保存してはいけない途中回答')).toBeNull();
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows search phases and gathered sources while a phased stream is in flight, then the verified answer', async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller; } });
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'phased', 'X-Origin-Stream-Protocol': 'origin-phased-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '最新の料金を調べて' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    const push = (event: unknown) => streamController.enqueue(encoder.encode(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`));
    push({ type: 'phase', phase: 'searching' });
    // 作業中表示（2026-11-14）：段階テキストは上部中央の大きな
    // オリンの状態ピルに出る。全体画面ステージと会話内の1行
    // 表示は使わない（二重表示にしない）。
    await waitFor(() => expect(screen.getByTestId('origin-orin-presence').textContent).toContain('最新の情報を調べています'));
    expect(screen.queryByTestId('origin-stage')).toBeNull();
    expect(screen.queryByTestId('origin-thinking')).toBeNull();
    // 回答エリア側には同じ汎用フェーズ文言を重ねない（ピルが担う）。
    // まだ回答が無いので「回答をコピー」も出ていない（2026-11-20
    // 外部デザイン評価の指摘を受けた是正の固定）。
    expect(screen.getByRole('log', { name: '会話履歴' }).textContent).not.toContain('最新の情報を調べています');
    expect(screen.queryByRole('button', { name: '回答をコピー' })).toBeNull();
    push({ type: 'sources', sources: [{ title: '料金の公式ページ', domain: 'example.com' }, { title: '比較記事', domain: 'example.org' }] });
    await waitFor(() => expect(screen.getByTestId('origin-stream-sources')).toBeTruthy());
    expect(screen.getByTestId('origin-stream-sources').textContent).toContain('確認した出典');
    expect(screen.getByTestId('origin-stream-sources').textContent).toContain('料金の公式ページ');
    expect(screen.getByTestId('origin-stream-sources').textContent).toContain('example.org');
    push({ type: 'phase', phase: 'composing' });
    await waitFor(() => expect(screen.getByTestId('origin-orin-presence').textContent).toContain('回答をまとめています'));
    push({ type: 'delta', text: '検証済みの調査回答です。' });
    // 本文が流れ始めても、生成が完了するまでは「回答をコピー」を
    // 出さない。
    await waitFor(() => expect(screen.getByText('検証済みの調査回答です。')).toBeTruthy());
    expect(screen.queryByRole('button', { name: '回答をコピー' })).toBeNull();
    push({ type: 'complete' });
    push('[DONE]');
    streamController.close();
    await waitFor(() => expect(screen.getByText('検証済みの調査回答です。')).toBeTruthy());
    // 完了後は「回答をコピー」が出る。
    await waitFor(() => expect(screen.getByRole('button', { name: '回答をコピー' })).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('origin-stream-sources')).toBeNull());
    // 本文が流れ始めたらピルは引っ込み、完了の合図
    // （「できました」、headerDoneCue の2,600ms）をはさんでピルだけが
    // 消える。浮遊プレゼンスの姿はそのまま残る（小さくならない）。
    await waitFor(() => expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull(), { timeout: 5000 });
    expect(screen.getByTestId('origin-orin-presence')).toBeTruthy();
    expect(screen.queryByTestId('origin-safe-waiting-state')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('discards a truncated phased stream without completion proof', async () => {
    const body = [
      `data: ${JSON.stringify({ type: 'phase', phase: 'searching' })}`,
      `data: ${JSON.stringify({ type: 'delta', text: '保存してはいけない途中回答' })}`,
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'phased', 'X-Origin-Stream-Protocol': 'origin-phased-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '切断された調査' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('回答の受信が途中で終わってしまったため、表示できませんでした。入力した内容は残っています。もう一度お試しください。')).toBeTruthy());
    expect(screen.queryByText('保存してはいけない途中回答')).toBeNull();
    expect(screen.queryByTestId('origin-stream-sources')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('treats a phased stream error event as a failed response', async () => {
    const body = [
      `data: ${JSON.stringify({ type: 'phase', phase: 'searching' })}`,
      `data: ${JSON.stringify({ type: 'error', code: 'PROVIDER_RATE_LIMITED' })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'phased', 'X-Origin-Stream-Protocol': 'origin-phased-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '失敗する調査' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('回答の受信が途中で終わってしまったため、表示できませんでした。入力した内容は残っています。もう一度お試しください。')).toBeTruthy());
    expect(screen.queryByTestId('response-verification-details')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('offers a retry under a tier-T3 research fallback answer and resends the previous question', async () => {
    const fallbackText = '公開情報を2件取得しましたが、要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします。';
    const body = [
      `data: ${JSON.stringify({ type: 'phase', phase: 'searching' })}`,
      `data: ${JSON.stringify({ type: 'outcome', researchTier: 'T3', researchOutcome: 'PARTIAL' })}`,
      `data: ${JSON.stringify({ type: 'delta', text: fallbackText })}`,
      `data: ${JSON.stringify({ type: 'complete' })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'phased', 'X-Origin-Stream-Protocol': 'origin-phased-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '最新の料金を調べて' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    // フォールバック（T3）着地がサーバーのメタデータで分かった場合だけ、
    // 回答の下に「もう一度試す」が出る。
    const retryButton = await screen.findByTestId('chat-research-retry-button');
    expect(retryButton.textContent).toBe('もう一度試す');
    fireEvent.click(retryButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(String(secondCall[1].body)).toContain('最新の料金を調べて');
    vi.unstubAllGlobals();
  });

  it('does not offer a retry under an adopted (tier-T0) research answer', async () => {
    const body = [
      `data: ${JSON.stringify({ type: 'phase', phase: 'searching' })}`,
      `data: ${JSON.stringify({ type: 'outcome', researchTier: 'T0', researchOutcome: 'ANSWERED' })}`,
      `data: ${JSON.stringify({ type: 'delta', text: '検証済みの調査回答です。' })}`,
      `data: ${JSON.stringify({ type: 'complete' })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'phased', 'X-Origin-Stream-Protocol': 'origin-phased-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '最新の料金を調べて' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByRole('button', { name: '回答をコピー' })).toBeTruthy());
    expect(screen.queryByTestId('chat-research-retry-button')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('blocks personal data and image attachments locally before production chat fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const privateValue = ['nori', '@', 'example.invalid'].join('');
    render(<App language="ja" />);

    const input = screen.getByTestId('origin-home-request') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: `連絡先は ${privateValue} です` } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByText('入力内容は送信せず、履歴にも追加していません。個人・金融・医療・認証情報を削除してください。画像は個人情報が含まれないことを検証できないため、この版では端末外へ送信しません。')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input.value).toContain(privateValue);
    expect(screen.queryByRole('article', { name: 'あなたの依頼' })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('saves new AI requests to the send outbox while offline instead of dropping them', async () => {
    const online = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    try {
      render(<App language="ja" />);
      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'オフライン要求' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      await waitFor(() => expect(screen.getByTestId('origin-send-queue')).toBeTruthy());
      expect(within(screen.getByTestId('origin-send-queue')).getByText('オフライン要求')).toBeTruthy();
      expect(screen.getByText('オフラインのため送信待ちに保存しました。送信待ちは 1 件です。接続が戻ると自動で送ります。')).toBeTruthy();
      expect(screen.queryByText('オフライン中は新規AI応答を停止しています。端末内の履歴・作成物は閲覧、直接編集、保存、パッケージ化を継続できます。')).toBeNull();
    } finally {
      if (online) Object.defineProperty(window.navigator, 'onLine', online);
      else delete (window.navigator as { onLine?: boolean }).onLine;
    }
  });
});

describe('code examples remain in conversation context', () => {
  it('preserves ordinary code and surrounding explanation without opening an artifact', () => {
    const content = '説明\n\n```ts\nconst value = 0;\n```\n\n次の手順';
    expect(StreamArtifactParser.parse(content)).toEqual({ conversationalText: content, artifacts: [], activeArtifact: null });
  });
  it('preserves a partially streamed ordinary code block', () => {
    const content = '```python\nprint(1)';
    expect(StreamArtifactParser.parse(content).conversationalText).toBe(content);
    expect(StreamArtifactParser.parse(content).artifacts).toHaveLength(0);
  });
  it('still extracts explicitly named code deliverables', () => {
    const result = StreamArtifactParser.parse('実装\n\n```ts:example.ts\nexport const value = 0;\n```');
    expect(result.conversationalText).toBe('実装');
    expect(result.activeArtifact).toMatchObject({ title: 'example.ts', type: 'code', content: 'export const value = 0;\n', isComplete: true });
  });
  it('gives unnamed created items a human title instead of Artifact-1', () => {
    const web = StreamArtifactParser.parse('```html\n<main>売上管理</main>\n```');
    const doc = StreamArtifactParser.parse('```markdown\n# 月次レポート\n```');
    expect(web.activeArtifact?.title).toBe('Webページ 1');
    expect(doc.activeArtifact?.title).toBe('月次レポート');
  });

  it('repairs generic provider titles from the created content without renaming real filenames', () => {
    const genericWeb = StreamArtifactParser.parse('```html:Artifact-1\n<!doctype html><title>営業ダッシュボード</title><main><h1>営業ダッシュボード</h1></main>\n```');
    const genericDoc = StreamArtifactParser.parse('```markdown:作成物-2\n# 提案書ドラフト\n\n本文\n```');
    const namedCode = StreamArtifactParser.parse('```ts:artifact-utils.ts\nexport const ready = true;\n```');

    expect(genericWeb.activeArtifact?.title).toBe('営業ダッシュボード');
    expect(genericDoc.activeArtifact?.title).toBe('提案書ドラフト');
    expect(namedCode.activeArtifact?.title).toBe('artifact-utils.ts');
  });
});

describe('answer refinement pill display label', () => {
  afterEach(cleanup);
  afterEach(() => { vi.unstubAllGlobals(); });

  const jsonChatReply = (content: string) => new Response(JSON.stringify({
    content,
    routing: { modelId: 'google/gemma-4-31b-it:free', freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: 'google/gemma-4-31b-it:free', servedModel: 'google/gemma-4-31b-it:free', fallbackUsed: false } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('shows only the pill label in the user bubble while the model receives the full internal instruction', async () => {
    const chatBodies: { messages: { role: string; content: string }[] }[] = [];
    const seenMessages: ConversationMessage[][] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestPath(input) === '/api/chat') {
        chatBodies.push(JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: string }[] });
        return jsonChatReply(chatBodies.length === 1 ? '最初の回答です' : '要点だけの回答です');
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" onMessagesChange={(messages) => { seenMessages.push([...messages]); }} />);

    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '進め方を教えて' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    expect(await screen.findByText('最初の回答です')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '要点だけ' }));
    expect(await screen.findByText('要点だけの回答です')).toBeTruthy();

    // モデルへ送る内容は従来どおり完全な内部指示文のまま（表示だけの変更）
    expect(chatBodies).toHaveLength(2);
    const lastUser = chatBodies[1]?.messages.at(-1);
    expect(lastUser?.role).toBe('user');
    expect(lastUser?.content).toContain('意思決定に必要な結論と次の行動がすぐ分かる形に圧縮してください');

    // 吹き出し・会話ログに内部指示文は出ない（ラベルは出る）
    const log = screen.getByRole('log');
    expect(log.textContent).not.toContain('意思決定に必要な結論と次の行動');
    const userBubbles = [...log.querySelectorAll('.origin-chat-user')].map((element) => element.textContent);
    expect(userBubbles).toContain('要点だけ');

    // メッセージは content=内部指示文 / displayContent=ラベル で保持される
    const latest = seenMessages.at(-1) ?? [];
    const refinementTurn = latest.filter((message) => message.role === 'user').at(-1);
    expect(refinementTurn?.content).toContain('意思決定に必要な結論と次の行動');
    expect(refinementTurn?.displayContent).toBe('要点だけ');
    // K-04: 調整である種別がメッセージ自体にも刻まれる（表示文の有無に
    // 依存しない印）。サーバーへも同じ印がフィールドで送られる。
    expect(refinementTurn?.requestKind).toBe('refinement');
    const lastBody = chatBodies[1] as unknown as { refinementOfPreviousAnswer?: unknown };
    expect(lastBody.refinementOfPreviousAnswer).toBe(true);
  });

  it('prefers the display label for the session title and falls back to content for legacy messages', () => {
    const session = currentConversationSession([
      { id: 'u1', role: 'user', content: '直前の回答を、意思決定に必要な結論と次の行動がすぐ分かる形に圧縮してください。重要な条件、リスク、不確実性は残し、必要情報ではなく重複を削ってください。', displayContent: '要点だけ' },
      { id: 'a1', role: 'assistant', content: '回答' },
    ], 1);
    expect(session?.title).toBe('要点だけ');
    const legacy = currentConversationSession([{ id: 'u1', role: 'user', content: '昔の質問' }], 1);
    expect(legacy?.title).toBe('昔の質問');
  });

  it('never surfaces the internal instruction for a marked refinement turn even when its display label is missing (K-04)', () => {
    const instruction = '直前の回答を、意思決定に必要な結論と次の行動がすぐ分かる形に圧縮してください。重要な条件、リスク、不確実性は残し、必要情報ではなく重複を削ってください。';
    const marked: ConversationMessage = { id: 'u1', role: 'user', content: instruction, requestKind: 'refinement' };
    expect(conversationMessageDisplayText(marked)).toBe('回答を調整');
    const session = currentConversationSession([marked, { id: 'a1', role: 'assistant', content: '回答' }], 1);
    expect(session?.title).toBe('回答を調整');
    expect(session?.title).not.toContain('意思決定に必要な結論');
    // 表示文がある印付きターンは従来どおりラベルを優先する
    expect(conversationMessageDisplayText({ ...marked, displayContent: '要点だけ' })).toBe('要点だけ');
    // 印の無いメッセージは従来どおり content を表示する（通常送信は不変）
    expect(conversationMessageDisplayText({ id: 'u2', role: 'user', content: '普通の質問' })).toBe('普通の質問');
  });

  it('a refinement pill send is never diverted to the coding or creative workspace and reaches chat with the marker (K-04)', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestPath(input) === '/api/chat') {
        chatBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return jsonChatReply(chatBodies.length === 1 ? '最初の回答です' : 'プランの回答です');
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpenCoding = vi.fn();
    const onOpenCreative = vi.fn();
    render(<App language="ja" onOpenCoding={onOpenCoding} onOpenCreative={onOpenCreative} />);

    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '進め方を教えて' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    expect(await screen.findByText('最初の回答です')).toBeTruthy();

    // 「実行プランにする」の指示文にはコード作業への言及（ファイル・
    // コンポーネント・テスト等）が含まれるが、印付き送信は本文テキスト
    // による画面振り分けに掛けず、チャットの直接経路で処理する。
    fireEvent.click(screen.getByRole('button', { name: '実行プランにする' }));
    expect(await screen.findByText('プランの回答です')).toBeTruthy();
    expect(onOpenCoding).not.toHaveBeenCalled();
    expect(onOpenCreative).not.toHaveBeenCalled();
    expect(chatBodies).toHaveLength(2);
    expect(chatBodies[1]?.refinementOfPreviousAnswer).toBe(true);
  });
});

describe('chat send queue while a response is generating', () => {
  afterEach(cleanup);
  afterEach(() => { vi.unstubAllGlobals(); });

  const model = 'google/gemma-4-31b-it:free';
  const jsonChatResponse = (content: string) => new Response(JSON.stringify({
    content,
    routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  const chatCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter(([input]) => requestPath(input) === '/api/chat');
  const lastUserText = (call: unknown[]) => {
    const body = JSON.parse((call[1] as RequestInit)?.body as string) as { messages: { role: string; content: string }[] };
    return body.messages.at(-1)?.content ?? '';
  };
  const echoChat = (firstResponse: () => Promise<Response>) => {
    let chatCount = 0;
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestPath(input) !== '/api/chat') return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      chatCount += 1;
      if (chatCount === 1) return firstResponse();
      const body = JSON.parse((init?.body as string) ?? '{}') as { messages: { content: string }[] };
      return jsonChatResponse(`回答：${body.messages.at(-1)?.content ?? ''}`);
    });
  };

  it('queues requests sent during generation and drains them in FIFO order after completion', async () => {
    const gate = createDeferred<Response>();
    const fetchMock = echoChat(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '最初の質問' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1));

    const composer = screen.getByTestId('origin-chat-request') as HTMLTextAreaElement;
    expect(composer.disabled).toBe(false);
    fireEvent.change(composer, { target: { value: '二番目の依頼' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('origin-send-queue')).toBeTruthy());
    expect(within(screen.getByTestId('origin-send-queue')).getByText('二番目の依頼')).toBeTruthy();
    expect(screen.getByText('受け付けました。送信待ちは 1 件です。今の回答が終わったら送ります。')).toBeTruthy();
    expect(chatCalls(fetchMock)).toHaveLength(1);

    fireEvent.change(composer, { target: { value: '三番目の依頼' } });
    fireEvent.click(screen.getByTestId('queue-send-button'));
    await waitFor(() => expect(screen.getAllByTestId('origin-send-queue-chip')).toHaveLength(2));
    expect(screen.getByText('受け付けました。送信待ちは 2 件です。今の回答が終わったら送ります。')).toBeTruthy();
    expect(chatCalls(fetchMock)).toHaveLength(1);

    gate.resolve(jsonChatResponse('最初の回答'));
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(3), { timeout: 3000 });
    expect(chatCalls(fetchMock).map((call) => lastUserText(call))).toEqual(['最初の質問', '二番目の依頼', '三番目の依頼']);
    await waitFor(() => expect(screen.getByText('回答：三番目の依頼')).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByTestId('origin-send-queue')).toBeNull();
  });

  it('removes a queued request from its chip so it is never sent', async () => {
    const gate = createDeferred<Response>();
    const fetchMock = echoChat(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '最初の質問' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1));

    const composer = screen.getByTestId('origin-chat-request');
    fireEvent.change(composer, { target: { value: '残す依頼' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    fireEvent.change(composer, { target: { value: '消す依頼' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByTestId('origin-send-queue-chip')).toHaveLength(2));
    const removedChip = screen.getAllByTestId('origin-send-queue-chip').find((chip) => chip.textContent?.includes('消す依頼'));
    fireEvent.click(within(removedChip as HTMLElement).getByTestId('origin-send-queue-remove'));
    await waitFor(() => expect(screen.getAllByTestId('origin-send-queue-chip')).toHaveLength(1));
    expect(screen.queryByText('消す依頼')).toBeNull();

    gate.resolve(jsonChatResponse('最初の回答'));
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(2), { timeout: 3000 });
    expect(chatCalls(fetchMock).map((call) => lastUserText(call))).toEqual(['最初の質問', '残す依頼']);
    await waitFor(() => expect(screen.getByText('回答：残す依頼')).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText('消す依頼')).toBeNull();
  });

  it('does not auto-send after a manual stop, but keeps the chip for manual send', async () => {
    let chatCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestPath(input) !== '/api/chat') return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      chatCount += 1;
      if (chatCount === 1) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) { reject(new DOMException('The operation was aborted.', 'AbortError')); return; }
          signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        });
      }
      const body = JSON.parse((init?.body as string) ?? '{}') as { messages: { content: string }[] };
      return jsonChatResponse(`回答：${body.messages.at(-1)?.content ?? ''}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '止める質問' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1));

    const composer = screen.getByTestId('origin-chat-request');
    fireEvent.change(composer, { target: { value: '保留中の依頼' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('origin-send-queue')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '生成を停止' }));
    await waitFor(() => expect(screen.getByTestId('send-request-button')).toBeTruthy());
    expect(chatCalls(fetchMock)).toHaveLength(1);
    expect(within(screen.getByTestId('origin-send-queue')).getByText('保留中の依頼')).toBeTruthy();

    fireEvent.click(within(screen.getByTestId('origin-send-queue-chip')).getByTestId('origin-send-queue-send-now'));
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(2), { timeout: 3000 });
    expect(lastUserText(chatCalls(fetchMock)[1])).toBe('保留中の依頼');
    await waitFor(() => expect(screen.getByText('回答：保留中の依頼')).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByTestId('origin-send-queue')).toBeNull();
  });

  it('keeps normal sending unchanged when nothing is generating', async () => {
    const fetchMock = echoChat(async () => jsonChatResponse('即時回答'));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '通常の質問' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(screen.getByText('即時回答')).toBeTruthy(), { timeout: 5000 });
    expect(chatCalls(fetchMock)).toHaveLength(1);
    expect(screen.queryByTestId('origin-send-queue')).toBeNull();
    expect((screen.getByTestId('origin-chat-request') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('carries the attachment snapshot taken at enqueue time', async () => {
    const gate = createDeferred<Response>();
    const fetchMock = echoChat(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '最初の質問' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['週次レポートの下書きメモ'], 'memo.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('添付: memo.txt')).toBeTruthy());
    fireEvent.click(screen.getByTestId('queue-send-button'));
    await waitFor(() => expect(screen.getByTestId('origin-send-queue')).toBeTruthy());
    expect(within(screen.getByTestId('origin-send-queue-chip')).getByText('memo.txt')).toBeTruthy();
    expect(chatCalls(fetchMock)).toHaveLength(1);

    gate.resolve(jsonChatResponse('最初の回答'));
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(2), { timeout: 3000 });
    expect(lastUserText(chatCalls(fetchMock)[1])).toContain('memo.txt');
    expect(lastUserText(chatCalls(fetchMock)[1])).toContain('週次レポートの下書きメモ');
  });
});

describe('cat visibility on the top screen and while generating (owner request 2026-11-09)', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows the cat only in the floating presence on the home screen (hero removed, owner spec 2026-11-14)', () => {
    render(<App language="ja" />);
    // 初期画面のヒーロー猫は、上部中央に常駐する浮遊プレゼンスと二重に見えるため廃止（2026-11-14）。
    expect(screen.queryByTestId('origin-core-logo')).toBeNull();
    // 猫はプレゼンスの1か所だけに常時表示される（枠なし方式
    // 2026-11-20 12:06：台座も窓枠も付けず、円盤だけが浮く）。
    // 待機中の姿は季節で差し替わる（冬＝雪景色、1月1日〜10日＝お正月）。
    // ここでは「プレゼンスに猫が1体だけ」の確認が目的なので、季節版も含める。
    const idleSrcs = ['/brand/origin-cat.webp', '/brand/origin-cat-winter.webp', '/brand/origin-cat-newyear.webp'];
    const brandCats = screen.getAllByTestId('origin-cat-state').filter((node) => idleSrcs.includes(node.getAttribute('src') ?? ''));
    expect(brandCats).toHaveLength(1);
    expect(brandCats[0].tagName).toBe('IMG');
    expect(brandCats[0].closest('[data-testid="origin-cat-pedestal"]')).toBeNull();
    expect(brandCats[0].closest('[data-testid="origin-orin-presence"]')).not.toBeNull();
  });

  it('shows the waiting stage in the Orin working presence while generating (PR-β, revised 2026-11-14)', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => { /* 応答を保留し、生成中表示を維持する */ }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '生成中の表示を確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    const presence = await screen.findByTestId('origin-orin-presence');
    // 作業中表示（2026-11-14）：会話内の1行表示は廃止し、段階は
    // 上部中央のオリンの状態ピルが一文で表す。名前タグ「Orin」は
    // 作業中も円盤の横に出続ける（2026-11-24 オーナー指示）。
    expect(presence.textContent).toContain('回答を準備しています');
    expect(within(presence).getByTestId('origin-orin-presence-name').textContent).toBe('Orin');
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
    expect(screen.queryByTestId('origin-thinking')).toBeNull();
    // 状態はプレゼンスのオリンが表す。送信中はタイピング動画で
    // 実際に動く（2026-11-20 18:17：静止画では稼働中か分からない
    // という実機判定を受けた対応。台座なし）。
    const presenceCat = within(presence).getByTestId('origin-cat-state');
    expect(presenceCat.tagName).toBe('VIDEO');
    expect(presenceCat.getAttribute('data-state')).toBe('working');
    expect(presenceCat.closest('[data-testid="origin-cat-pedestal"]')).toBeNull();
    // ヘッダーにオリンは置かない（浮遊プレゼンスに一本化）。
    expect(screen.queryByTestId('origin-header-orin')).toBeNull();
    expect(document.querySelector('.origin-header [data-testid="origin-cat-state"]')).toBeNull();
  });
});

describe('Orin panel (stage 1, owner request 2026-11-24)', () => {
  afterEach(cleanup);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('opens from the floating presence and shows the profile plus the empty work state while nothing is in progress', () => {
    render(<App language="ja" />);
    fireEvent.click(screen.getByRole('button', { name: 'Orin（いまの作業を表示）' }));
    const sheet = screen.getByTestId('origin-orin-panel');
    // パネルではタブ画面の空状態として「いまは作業していません」を
    // 1行出す（パネル設計 §4.5、2026-11-24。旧カードの空状態廃止
    // とは別判断）。名前表記は「Orin」に統一（同日の統括裁定）。
    expect(within(sheet).getByTestId('origin-orin-panel-empty').textContent).toBe('いまは作業していません');
    expect(within(sheet).getByTestId('origin-orin-profile-name').textContent).toBe('Orin');
  });

  it('shows the agent plan steps (not just the current step) in the work sheet', () => {
    reportAgentActivity({
      active: true,
      outcome: 'running',
      stepTitle: '文書を作る',
      currentStep: 2,
      totalSteps: 3,
      steps: [
        { title: 'ウェブで調べる', status: 'completed' },
        { title: '文書を作る', status: 'running' },
        { title: 'テストと動作確認', status: 'queued' },
      ],
      updatedAt: Date.now(),
    });
    try {
      render(<App language="ja" onOpenAgent={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Orin（いまの作業を表示）' }));
      const sheet = screen.getByTestId('origin-orin-panel');
      // 一覧が引けない環境では共有ストアの要約が項目になり、進捗は
      // %＋n/m 併記で出る。ステップ列は開くと見える（設計 §4.1）。
      expect(within(sheet).getByTestId('origin-orin-panel-agent-link')).toBeTruthy();
      expect(sheet.textContent).toContain('33%（3ステップ中 1つ完了）');
      fireEvent.click(within(sheet).getByRole('button', { name: 'ステップを見る' }));
      const steps = within(sheet).getByTestId('origin-orin-panel-steps');
      expect(steps.textContent).toContain('ウェブで調べる');
      expect(steps.textContent).toContain('完了');
      expect(steps.textContent).toContain('実行中');
      expect(steps.textContent).toContain('テストと動作確認');
      expect(steps.textContent).toContain('まだ');
    } finally {
      reportAgentActivity(null);
    }
  });

  it('shows the current chat stage while generating and the last completed work afterwards', async () => {
    const model = 'google/gemma-4-31b-it:free';
    let resolveChat!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => { resolveChat = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/chat') return gate;
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'シートの確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await screen.findByTestId('origin-orin-presence');

    fireEvent.click(screen.getByRole('button', { name: 'Orin（いまの作業を表示）' }));
    const sheet = screen.getByTestId('origin-orin-panel');
    expect(within(sheet).getByText('回答を準備しています')).toBeTruthy();
    expect(sheet.textContent).toContain('作業中');
    fireEvent.click(within(sheet).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByTestId('origin-orin-panel')).toBeNull();

    resolveChat(new Response(JSON.stringify({
      content: 'シート確認の回答',
      routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(await screen.findByText('シート確認の回答')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Orin（いまの作業を表示）' }));
    const reopened = screen.getByTestId('origin-orin-panel');
    expect(within(reopened).getByText('質問への回答')).toBeTruthy();
    expect(reopened.textContent).toContain('完了');
  });
});

describe('Orin floating presence (owner request 2026-11-14, revised 08:59)', () => {
  afterEach(cleanup);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the current stage in the presence pill while waiting, with no stage and no one-line status', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => { /* 応答を保留し、待ち状態を維持する */ }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '吹き出しの確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    // 待ちの段階は上部中央に浮く大きなオリンの状態ピルが一文で出す。
    // 全体画面ステージと会話内の1行表示はどちらも出ない。
    const presence = await screen.findByTestId('origin-orin-presence');
    expect(presence.textContent).toContain('回答を準備しています');
    expect(screen.queryByTestId('origin-stage')).toBeNull();
    expect(screen.queryByTestId('origin-thinking')).toBeNull();
    expect(screen.queryByTestId('origin-research-progress')).toBeNull();
    // 状態はプレゼンスの大きなオリンが表し、ヘッダーにオリンは置かない。
    // 送信中はタイピング動画（working）で稼働を見せる（2026-11-20 18:17）。
    const presenceCat = within(presence).getByTestId('origin-cat-state');
    expect(presenceCat.getAttribute('data-state')).toBe('working');
    expect(screen.queryByTestId('origin-header-orin')).toBeNull();
    expect(document.querySelector('.origin-header [data-testid="origin-cat-state"]')).toBeNull();
  });

  it('keeps exactly one work-sheet control (the floating presence tap target) in idle and working states', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => { /* 応答を保留し、生成中表示を維持する */ }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    // 待機中：「いまの作業を表示」は浮遊プレゼンスのタップ対象ただ1つ
    // （ヘッダー側の同名ボタンは廃止した。PR #1253 のマージ結果で
    // 起きた同名操作の二重化に対する回帰テスト）。
    expect(screen.queryByTestId('origin-header-orin')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Orin（いまの作業を表示）' })).toHaveLength(1);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '単一操作の確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await screen.findByTestId('origin-orin-presence-status');
    // 作業中もただ1つで、それはプレゼンスの中にある。
    const controls = screen.getAllByRole('button', { name: 'Orin（いまの作業を表示）' });
    expect(controls).toHaveLength(1);
    expect(screen.getByTestId('origin-orin-presence').contains(controls[0])).toBe(true);
  });

  it('keeps the presence visible with a joy motion while the profile card is open (2026-11-15 revision)', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => { /* 応答を保留し、待ち状態を維持する */ }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'カードとプレゼンスの確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    expect(await screen.findByTestId('origin-orin-presence')).toBeTruthy();
    // 旧仕様（PR-β）は上から開くシートと重なるためプレゼンスを隠して
    // いたが、新仕様（2026-11-15、Muse アプリのアバタータップ式）は
    // 中央カード／下部シートで重ならないため、プレゼンスは残したまま
    // タップの「喜ぶ」動きを見せる。
    fireEvent.click(screen.getByRole('button', { name: 'Orin（いまの作業を表示）' }));
    const card = screen.getByTestId('origin-orin-panel');
    expect(within(card).getByTestId('origin-orin-profile-name').textContent).toBe('Orin');
    const presence = screen.getByTestId('origin-orin-presence');
    expect(presence.querySelector('.origin-cat-joy')).not.toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByTestId('origin-orin-panel')).toBeNull();
    expect(await screen.findByTestId('origin-orin-presence')).toBeTruthy();
  });

  it('shows the completion cue in the presence pill after the answer lands, then only the pill fades out', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/chat') {
        return new Response(JSON.stringify({
          content: '吹き出し確認の回答',
          routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '完了の合図を確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    expect(await screen.findByText('吹き出し確認の回答')).toBeTruthy();
    // 完了の合図は headerDoneCue（2,600ms）の間だけ円盤の横に出て、
    // その後テキストだけがフェードして消える。姿は同じ大きさで
    // 残り、オリンだけの形に戻る。
    await waitFor(() => expect(screen.getByTestId('origin-orin-presence').textContent).toContain('できました'));
    await waitFor(() => expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull(), { timeout: 5000 });
    const presence = screen.getByTestId('origin-orin-presence');
    expect((within(presence).getByTestId('origin-cat-state') as HTMLElement).style.width).toBe('72px');
  });

  it('places Orin at the head of the scroll content so it scrolls away with the conversation (K-01, 2026-11-24)', async () => {
    const { container } = render(<App language="ja" />);
    const presence = await screen.findByTestId('origin-orin-presence');
    const cat = within(presence).getByTestId('origin-cat-state') as HTMLElement;
    const disc = cat.parentElement as HTMLElement;
    // 待機中は通常の72px（2026-11-20 18:17 の実機判定）。薄くもなっていない。
    expect(cat.style.width).toBe('72px');
    expect(disc.classList.contains('is-scrolling')).toBe(false);
    const scroller = container.querySelector('.origin-chat-scroll') as HTMLElement;
    expect(scroller).toBeTruthy();
    // K-01 の構造条件（是正リスト K-01、選択肢 C）：プレゼンスは
    // スクローラの外の行（P4 形）でも浮遊でもなく、スクロール
    // 内容の先頭の子として置かれる。本文と一緒に流れ去るため、
    // どのスクロール位置でも本文が円盤の下に来ることは構造的
    // に起きない。ホーム／会話の条件分岐より前に描かれるため、
    // どちらの表示でも常に先頭になる（ここではホーム表示で固定）。
    expect(scroller.contains(presence)).toBe(true);
    expect(presence.parentElement).toBe(scroller);
    expect(scroller.firstElementChild).toBe(presence);
    let scrollTop = 120;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => scrollTop });
    fireEvent.scroll(scroller);
    // スクロールしても、絵は縮まず薄くもならない（浮遊前提の
    // 自動縮小・フェードは P4 で廃止済み。K-01 でも維持する）。
    await waitFor(() => expect(cat.style.width).toBe('72px'));
    expect(disc.classList.contains('is-scrolling')).toBe(false);
    // 先頭に戻っても同じ大きさのまま。
    scrollTop = 0;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(cat.style.width).toBe('72px'));
    expect(disc.classList.contains('is-scrolling')).toBe(false);
  });

  it('re-scrolls to the bottom after completion when the content grows late (P5 settle passes, 2026-11-24)', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/chat') {
        return new Response(JSON.stringify({
          content: '完了後の追随を確認する回答',
          routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App language="ja" />);
    const scroller = container.querySelector('.origin-chat-scroll') as HTMLElement;
    expect(scroller).toBeTruthy();
    // jsdom にはレイアウトが無いため、スクローラの寸法を手で与える。
    let scrollHeight = 600;
    let scrollTop = 0;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '完了後の追随確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    expect(await screen.findByText('完了後の追随を確認する回答')).toBeTruthy();
    // 完了直後、操作行の出現や遅延レイアウトで本文がさらに伸びたとする。
    scrollHeight = 1400;
    // 寄せ直し（約300ms後）が新しい最下部まで届くこと。寄せ直しが
    // 無いと伸びる前の高さ（600）で止まり、操作行が入力欄の裏に
    // 半分隠れたままになる（週次品質検査の欠陥#5）。
    await waitFor(() => expect(scrollTop).toBe(1400), { timeout: 3000 });
  });

  it('keeps following when a stale scroll event is delivered after late growth (K-16 residual, 2026-11-24)', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/chat') {
        return new Response(JSON.stringify({
          content: '遅れて届くスクロールイベントでも追随が切れないことを確認する回答',
          routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App language="ja" />);
    const scroller = container.querySelector('.origin-chat-scroll') as HTMLElement;
    expect(scroller).toBeTruthy();
    let scrollHeight = 600;
    let scrollTop = 0;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '遅延イベントでの追随確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    expect(await screen.findByText('遅れて届くスクロールイベントでも追随が切れないことを確認する回答')).toBeTruthy();
    // 完了時の追随で、短い内容の最下部（600）に置かれている。
    await waitFor(() => expect(scrollTop).toBe(600));
    // 本文が遅れて伸びた直後、短い内容の最下部にいた時点で
    // 発生したスクロールイベントが遅れて配送されたとする。
    // 位置は追随処理が置いた 600 のままで読み手は動いておらず、
    // 見かけの距離は 600px 開くが、追随は切れてはいけない。
    // 対策が無いと、このイベントで追随が落ち、寄せ直しが
    // 効かず 600 で止まる（E2E 全体実行で実測した残件）。
    scrollHeight = 1400;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(scrollTop).toBe(1400), { timeout: 3000 });
  });

  it('stops following when the reader actually scrolls up before the settle passes (K-16 residual guard, 2026-11-24)', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/chat') {
        return new Response(JSON.stringify({
          content: '読み手が上へスクロールしたら追随が止まることを確認する回答',
          routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App language="ja" />);
    const scroller = container.querySelector('.origin-chat-scroll') as HTMLElement;
    expect(scroller).toBeTruthy();
    let scrollHeight = 600;
    let scrollTop = 0;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '上スクロールでの追随停止確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    expect(await screen.findByText('読み手が上へスクロールしたら追随が止まることを確認する回答')).toBeTruthy();
    await waitFor(() => expect(scrollTop).toBe(600));
    // 読み手が実際に上へスクロールした（追随処理が置いた位置
    // から動いた）。本文が伸びても、寄せ直しは効いてはいけない
    // （邪魔をしない従来の配慮の維持）。
    scrollTop = 100;
    scrollHeight = 1400;
    fireEvent.scroll(scroller);
    await new Promise((resolve) => { setTimeout(resolve, 700); });
    expect(scrollTop).toBe(100);
  });

  it('shows the existing failure text in the presence pill when the send fails', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network down'); });
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '失敗の合図を確認' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    // 失敗時は既存の失敗文を、失敗キュー（2,600ms）の間だけ
    // ピルに出す。キューの後はピルだけが消え、姿は残る。
    await waitFor(() => expect(screen.getByTestId('origin-orin-presence').textContent).toContain('エラーが発生しました'));
    await waitFor(() => expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull(), { timeout: 5000 });
    expect(screen.getByTestId('origin-orin-presence')).toBeTruthy();
  });

  it('shows the current agent step in the pill while the agent works in the background, and switches as steps advance (2026-11-20 detail pass)', async () => {
    reportAgentActivity({
      active: true,
      outcome: 'running',
      stepTitle: 'ウェブで調べる',
      currentStep: 1,
      totalSteps: 3,
      steps: [
        { title: 'ウェブで調べる', status: 'running' },
        { title: '文書を作る', status: 'queued' },
        { title: 'テストと動作確認', status: 'queued' },
      ],
      updatedAt: Date.now(),
    });
    try {
      render(<App language="ja" />);
      // チャットが待機中でも、裏で進むエージェントの現在のステップが
      // 段階名ではなく実際のタイトルでピルに出る。作業中の文には
      // 稼働ドット（…）が末尾に付く（2026-11-20 18:17）。
      const pill = await screen.findByTestId('origin-orin-presence-status');
      expect(pill.textContent).toBe('ウェブで調べる...');
      expect(within(pill).getByTestId('origin-orin-presence-dots')).toBeTruthy();
      expect(within(screen.getByTestId('origin-orin-presence')).getByTestId('origin-cat-state').getAttribute('data-state')).toBe('working');
      // ステップが進むとピルの文も切り替わる。
      act(() => {
        reportAgentActivity({
          active: true,
          outcome: 'running',
          stepTitle: '文書を作る',
          currentStep: 2,
          totalSteps: 3,
          steps: [
            { title: 'ウェブで調べる', status: 'completed' },
            { title: '文書を作る', status: 'running' },
            { title: 'テストと動作確認', status: 'queued' },
          ],
          updatedAt: Date.now(),
        });
      });
      await waitFor(() => expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('文書を作る...'));
    } finally {
      reportAgentActivity(null);
    }
  });

  it('falls back to a generic agent line in the pill when the agent has no step title yet (2026-11-20 detail pass)', async () => {
    reportAgentActivity({ active: true, outcome: 'running', stepTitle: null, currentStep: 0, totalSteps: 0, updatedAt: Date.now() });
    try {
      render(<App language="ja" />);
      const pill = await screen.findByTestId('origin-orin-presence-status');
      expect(pill.textContent).toBe('エージェントが作業しています...');
    } finally {
      reportAgentActivity(null);
    }
  });

  it('keeps the foreground chat stage in the pill while a send is in flight, even when the agent is also working (2026-11-20 detail pass)', async () => {
    reportAgentActivity({ active: true, outcome: 'running', stepTitle: 'ウェブで調べる', currentStep: 1, totalSteps: 2, updatedAt: Date.now() });
    const fetchMock = vi.fn(() => new Promise<Response>(() => { /* 応答を保留し、待ち状態を維持する */ }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App language="ja" />);
      expect((await screen.findByTestId('origin-orin-presence-status')).textContent).toBe('ウェブで調べる...');
      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '前景の確認' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      // 送信中は前景の段階文が優先し、エージェント文は引っ込む。
      await waitFor(() => expect(screen.getByTestId('origin-orin-presence-status').textContent).toContain('回答を準備しています'));
    } finally {
      reportAgentActivity(null);
    }
  });

  it('hides the agent step pill while the work sheet is open (the sheet shows the steps instead) (2026-11-20 detail pass)', async () => {
    reportAgentActivity({
      active: true,
      outcome: 'running',
      stepTitle: '文書を作る',
      currentStep: 2,
      totalSteps: 3,
      steps: [
        { title: 'ウェブで調べる', status: 'completed' },
        { title: '文書を作る', status: 'running' },
        { title: 'テストと動作確認', status: 'queued' },
      ],
      updatedAt: Date.now(),
    });
    try {
      render(<App language="ja" />);
      expect((await screen.findByTestId('origin-orin-presence-status')).textContent).toBe('文書を作る...');
      fireEvent.click(screen.getByRole('button', { name: 'Orin（いまの作業を表示）' }));
      expect(screen.getByTestId('origin-orin-panel')).toBeTruthy();
      await waitFor(() => expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull(), { timeout: 5000 });
    } finally {
      reportAgentActivity(null);
    }
  });

  it('shows the summarised drawing phase in the pill — never the request text — while an image is generated from the panel (2026-11-20 18:17)', async () => {
    let resolveGeneration: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestPath(input);
      if (url === '/api/generate-image') {
        return new Promise<Response>((resolve) => { resolveGeneration = resolve; });
      }
      return new Response(JSON.stringify({ code: 'UNEXPECTED_REQUEST' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<App language="ja" />);
      fireEvent.click(screen.getByTestId('origin-add-menu-toggle'));
      fireEvent.click(screen.getByRole('menuitem', { name: '画像生成' }));
      fireEvent.change(screen.getByTestId('origin-image-prompt'), { target: { value: '夕焼けの海辺' } });
      fireEvent.click(screen.getByTestId('origin-image-generate-submit'));
      // 描画中のピルは作業の要約（絵を描いています）だけを出し、
      // 依頼文そのものは決して含まない（2026-11-20 18:17 の実機
      // 判定：入力した文字をそのまま表示しない）。作業中のため
      // 稼働ドットが末尾に付く。
      await waitFor(() => expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('絵を描いています...'));
      expect(screen.getByTestId('origin-orin-presence-status').textContent).not.toContain('夕焼けの海辺');
      resolveGeneration?.(new Response(JSON.stringify({
        code: 'PROVIDER_UNAVAILABLE',
        message: '画像生成Providerが未構成です。',
      }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('image phase pill text (2026-11-20 detail pass, summarised 18:17)', () => {
  it('builds the phase texts as fixed summary phrases, with the real check aspects for checking', () => {
    expect(buildImagePhaseText('designing', 'ja')).toBe('絵の設計をしています');
    expect(buildImagePhaseText('drawing', 'ja')).toBe('絵を描いています');
    expect(buildImagePhaseText('checking', 'ja')).toBe('明るさが潰れていないか、中身が描かれているかを確認しています');
    expect(buildImagePhaseText('designing', 'en')).toBe('Designing the image');
    expect(buildImagePhaseText('drawing', 'en')).toBe('Drawing the image');
    expect(buildImagePhaseText('checking', 'en')).toBe('Checking the brightness and that the content is really there');
  });

  it('never embeds the request text in a phase text (2026-11-20 18:17: no verbatim input in working comments)', () => {
    // 依頼文が何であっても、フェーズ文は段階ごとの固定の要約
    // 表現だけになる。入力の断片が文に混ざらないことを固定する。
    const requestFragments = ['夕焼けの海辺', '青い陶器のマグカップ', 'seaside at dusk'];
    for (const language of ['ja', 'en'] as const) {
      for (const phase of ['designing', 'drawing', 'checking'] as const) {
        const text = buildImagePhaseText(phase, language);
        for (const fragment of requestFragments) {
          expect(text).not.toContain(fragment);
        }
        expect(text).not.toContain('『');
      }
    }
  });
});

describe('answer replay for bulk-delivered finalized text (display stage 1)', () => {
  afterEach(cleanup);

  it('splits text into grapheme clusters without breaking surrogate pairs or combining marks', () => {
    expect(splitOriginGraphemes('あいう')).toEqual(['あ', 'い', 'う']);
    expect(splitOriginGraphemes('𐮷野家')).toEqual(['𐮷', '野', '家']);
    expect(splitOriginGraphemes('がく')).toEqual(['が', 'く']);
    expect(countOriginGraphemes('👨‍👩‍👧家族')).toBe(3);
    expect(countOriginGraphemes('')).toBe(0);
  });

  it('takes grapheme prefixes without splitting a cluster', () => {
    expect(originGraphemePrefix('あ𐮷い', 2)).toBe('あ𐮷');
    expect(originGraphemePrefix('あい', 0)).toBe('');
    expect(originGraphemePrefix('あい', 5)).toBe('あい');
  });

  it('clamps the total replay duration into 0.6–5 seconds at about 1,200 graphemes per second', () => {
    expect(originAnswerReplayDurationSeconds(0)).toBe(0);
    expect(originAnswerReplayDurationSeconds(120)).toBe(0.6);
    expect(originAnswerReplayDurationSeconds(720)).toBe(0.6);
    expect(originAnswerReplayDurationSeconds(1200)).toBe(1);
    expect(originAnswerReplayDurationSeconds(3600)).toBe(3);
    expect(originAnswerReplayDurationSeconds(12000)).toBe(5);
  });

  it('starts replay only for bulk arrivals of long answers without reduced motion', () => {
    expect(shouldStartOriginAnswerReplay({ totalGraphemes: 1200, addedGraphemes: 1200, reducedMotion: false })).toBe(true);
    expect(shouldStartOriginAnswerReplay({ totalGraphemes: 1200, addedGraphemes: 1200, reducedMotion: true })).toBe(false);
    expect(shouldStartOriginAnswerReplay({ totalGraphemes: 48, addedGraphemes: 48, reducedMotion: false })).toBe(false);
    expect(shouldStartOriginAnswerReplay({ totalGraphemes: 1200, addedGraphemes: 159, reducedMotion: false })).toBe(false);
    expect(shouldStartOriginAnswerReplay({ totalGraphemes: 1200, addedGraphemes: 160, reducedMotion: false })).toBe(true);
  });

  const manualScheduler = () => {
    let scheduled: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { scheduled = callback; return 7; });
    const cancelFrame = vi.fn(() => { scheduled = undefined; });
    const runFrame = (timestamp: number) => { const callback = scheduled; scheduled = undefined; callback?.(timestamp); };
    return { requestFrame, cancelFrame, runFrame };
  };

  it('reveals graphemes at the clamped rate and completes exactly at the total', () => {
    const { requestFrame, cancelFrame, runFrame } = manualScheduler();
    const onReveal = vi.fn();
    const onDone = vi.fn();
    const player = createOriginAnswerReplay(onReveal, onDone, { requestFrame, cancelFrame });
    player.start(1200, 0);
    runFrame(0);
    expect(onReveal).not.toHaveBeenCalled();
    runFrame(500);
    expect(onReveal).toHaveBeenLastCalledWith(600);
    runFrame(1000);
    expect(onReveal).toHaveBeenLastCalledWith(1200);
    expect(onDone).toHaveBeenCalledOnce();
    expect(player.isPlaying()).toBe(false);
  });

  it('honours already-revealed graphemes when only the tail arrived in bulk', () => {
    const { requestFrame, cancelFrame, runFrame } = manualScheduler();
    const onReveal = vi.fn();
    const onDone = vi.fn();
    const player = createOriginAnswerReplay(onReveal, onDone, { requestFrame, cancelFrame });
    player.start(1200, 600);
    runFrame(0);
    runFrame(300);
    expect(onReveal).toHaveBeenLastCalledWith(900);
    runFrame(600);
    expect(onReveal).toHaveBeenLastCalledWith(1200);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('extends the target when more finalized text lands mid-play', () => {
    const { requestFrame, cancelFrame, runFrame } = manualScheduler();
    const onReveal = vi.fn();
    const onDone = vi.fn();
    const player = createOriginAnswerReplay(onReveal, onDone, { requestFrame, cancelFrame });
    player.start(600, 0);
    runFrame(0);
    runFrame(300);
    expect(onReveal).toHaveBeenLastCalledWith(300);
    player.extend(2400);
    runFrame(2050);
    expect(onReveal).toHaveBeenLastCalledWith(2400);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('caps the rate so a very long answer still finishes within five seconds', () => {
    const { requestFrame, cancelFrame, runFrame } = manualScheduler();
    const onReveal = vi.fn();
    const onDone = vi.fn();
    const player = createOriginAnswerReplay(onReveal, onDone, { requestFrame, cancelFrame });
    player.start(12000, 0);
    runFrame(0);
    runFrame(2500);
    expect(onReveal).toHaveBeenLastCalledWith(6000);
    runFrame(5000);
    expect(onReveal).toHaveBeenLastCalledWith(12000);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('finish reveals everything at once and cancel stays silent', () => {
    const { requestFrame, cancelFrame, runFrame } = manualScheduler();
    const onReveal = vi.fn();
    const onDone = vi.fn();
    const player = createOriginAnswerReplay(onReveal, onDone, { requestFrame, cancelFrame });
    player.start(6000, 0);
    runFrame(0);
    runFrame(100);
    expect(onReveal).toHaveBeenLastCalledWith(120);
    player.finish();
    expect(onReveal).toHaveBeenLastCalledWith(6000);
    expect(onDone).toHaveBeenCalledOnce();

    const quietReveal = vi.fn();
    const quietDone = vi.fn();
    const cancelled = createOriginAnswerReplay(quietReveal, quietDone, { requestFrame, cancelFrame });
    cancelled.start(6000, 0);
    cancelled.cancel();
    runFrame(1000);
    expect(quietReveal).not.toHaveBeenCalled();
    expect(quietDone).not.toHaveBeenCalled();
    expect(cancelled.isPlaying()).toBe(false);
  });

  const longJsonPayload = () => {
    const model = 'google/gemma-4-31b-it:free';
    return {
      content: `${'あ'.repeat(300)}終わりの文です。`,
      routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
      usage: { costUsd: 0 },
    };
  };

  it('replays a long JSON answer progressively and finishes it on tap', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(longJsonPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    // Freeze animation frames so the replay cannot advance on its own;
    // the tap is what finishes it in this test.
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    try {
      const { container } = render(<App language="ja" />);
      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '長く説明してください' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      await waitFor(() => expect(container.querySelector('[data-answer-replaying="true"]')).toBeTruthy());
      expect(container.textContent).not.toContain('終わりの文です');
      expect(screen.queryByText('回答をコピー')).toBeNull();
      fireEvent.click(container.querySelector('[data-answer-replaying="true"]')!);
      await waitFor(() => expect(container.textContent).toContain('終わりの文です'));
      expect(container.querySelector('[data-answer-replaying="true"]')).toBeNull();
      expect(screen.getByText('回答をコピー')).toBeTruthy();
    } finally {
      frame.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('replays a bulk-released verified SSE answer and finishes it on tap', async () => {
    const model = 'google/gemma-4-31b-it:free';
    const body = [
      `data: ${JSON.stringify({ type: 'delta', text: `${'い'.repeat(300)}最後の文です。` })}`,
      `data: ${JSON.stringify({ type: 'complete', modelId: model, servedModel: model, costEvidenceStatus: 'NOT_MEASURED', fallbackUsed: false })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Origin-Stream-Source': 'upstream', 'X-Origin-Stream-Protocol': 'origin-verified-sse-v1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    try {
      const { container } = render(<App language="ja" />);
      fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '長く説明してください' } });
      fireEvent.click(screen.getByTestId('start-request-button'));
      await waitFor(() => expect(container.querySelector('[data-answer-replaying="true"]')).toBeTruthy());
      expect(container.textContent).not.toContain('最後の文です');
      fireEvent.click(container.querySelector('[data-answer-replaying="true"]')!);
      await waitFor(() => expect(container.textContent).toContain('最後の文です'));
      expect(container.querySelector('[data-answer-replaying="true"]')).toBeNull();
    } finally {
      frame.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('shows a long JSON answer at once when the user prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(longJsonPayload()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '長く説明してください' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(container.textContent).toContain('終わりの文です'));
    expect(container.querySelector('[data-answer-replaying="true"]')).toBeNull();
    vi.unstubAllGlobals();
  });
});
