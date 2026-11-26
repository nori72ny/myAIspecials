import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrinAiNewsPage from './OrinAiNewsPage';
import { clearOrinAiNewsCache } from './orinAiNews';

function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => handler(String(input))));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearOrinAiNewsCache();
});

describe('OrinAiNewsPage (expansion design §8, moved to a sidebar page 2026-11-25)', () => {
  it('shows the weekly digest and live headlines', async () => {
    stubFetch((url) => {
      if (url.includes('/api/orin/ai-news')) {
        return new Response(JSON.stringify({
          ok: true,
          fetchedAt: new Date().toISOString(),
          items: [{ title: 'テスト見出し', url: 'https://example.com/news', source: 'example.com', publishedAt: new Date().toISOString() }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    render(<OrinAiNewsPage language="ja" />);
    const page = screen.getByTestId('origin-ai-news-page');
    // ページ見出しは「AIの最新情報」、第1層は週次ダイジェスト
    expect(page.textContent).toContain('AIの最新情報');
    expect(page.textContent).toContain('今週のまとめ');
    expect(page.textContent).toContain('11月25日更新');
    // 第2層の見出し（出典ドメイン＋相対時刻つき）
    expect(await within(page).findByText('テスト見出し')).toBeTruthy();
    expect(page.textContent).toContain('example.com');
    expect(page.textContent).toContain('たった今');
  });

  it('keeps the digest visible when the live headlines cannot be loaded', async () => {
    stubFetch((url) => {
      if (url.includes('/api/orin/ai-news')) {
        return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    render(<OrinAiNewsPage language="ja" />);
    expect(await screen.findByTestId('origin-ai-news-error')).toBeTruthy();
    expect(screen.getByTestId('origin-ai-news-error').textContent).toBe('最新の見出しを取得できませんでした');
    expect(screen.getByTestId('origin-ai-news-page').textContent).toContain('今週のまとめ');
  });

  it('lets the reader retry from the error state and then shows the headlines', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        ok: true,
        fetchedAt: new Date().toISOString(),
        items: [{ title: 'テスト見出し', url: 'https://example.com/news', source: 'example.com', publishedAt: new Date().toISOString() }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    render(<OrinAiNewsPage language="ja" />);
    expect(await screen.findByTestId('origin-ai-news-error')).toBeTruthy();
    const retryButton = screen.getByTestId('origin-ai-news-retry');
    expect(retryButton.textContent).toBe('もう一度試す');
    fireEvent.click(retryButton);
    expect(await screen.findByText('テスト見出し')).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('says the load is taking a while, then gives up at the limit and offers a retry', async () => {
    vi.useFakeTimers();
    try {
      // 応答が返らず、中断（abort）された時だけ失敗する取得。
      vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')); });
      })));
      render(<OrinAiNewsPage language="ja" />);
      expect(screen.getByTestId('origin-ai-news-loading').textContent).toContain('読み込んでいます');
      // 10秒を超えたら、読み込み中である旨に加えて時間がかかって
      // いることを知らせる。
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(screen.getByTestId('origin-ai-news-loading').textContent).toContain('読み込みに時間がかかっています');
      // 上限（30秒）を超えたら失敗として扱い、再試行できるように
      // する（読み込み中のまま無言にしない）。
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(screen.getByTestId('origin-ai-news-error')).toBeTruthy();
      expect(screen.getByTestId('origin-ai-news-retry')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
