import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrinSpeechBubble, {
  ORIN_BUBBLE_FADE_MS,
  ORIN_OVERLAY_CAT_SIZE_PX,
  ORIN_OVERLAY_PEDESTAL_SIZE_PX,
  resolveOrinBubbleText,
  type OrinBubbleSignals,
} from './OrinSpeechBubble';

const TEXTS = {
  waitingText: '回答を準備しています…',
  researchStageText: '公開情報を探しています',
  imagePhaseText: '描いています',
};

function signals(overrides: Partial<OrinBubbleSignals> = {}): OrinBubbleSignals {
  return { imagePhase: null, researchStage: null, streamPhase: null, isLoading: false, ...overrides };
}

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderPresence(overrides: Partial<React.ComponentProps<typeof OrinSpeechBubble>> = {}) {
  const props: React.ComponentProps<typeof OrinSpeechBubble> = {
    text: '回答を準備しています…',
    state: 'thinking',
    language: 'ja',
    onOpenWorkSheet: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<OrinSpeechBubble {...props} />) };
}

describe('resolveOrinBubbleText', () => {
  it('returns null when nothing is in flight', () => {
    expect(resolveOrinBubbleText(signals(), TEXTS)).toBeNull();
  });

  it('uses the waiting text while a plain send is in flight, keeping the existing ellipsis form', () => {
    expect(resolveOrinBubbleText(signals({ isLoading: true }), TEXTS)).toBe('回答を準備しています…');
  });

  it('uses the waiting text for both stream phases (the phase wording itself lives in waitingText)', () => {
    expect(resolveOrinBubbleText(signals({ isLoading: true, streamPhase: 'searching' }), TEXTS)).toBe(TEXTS.waitingText);
    expect(resolveOrinBubbleText(signals({ isLoading: true, streamPhase: 'composing' }), TEXTS)).toBe(TEXTS.waitingText);
  });

  it('prefers the research stage text over the stream phase', () => {
    expect(resolveOrinBubbleText(signals({ isLoading: true, researchStage: 'checking', streamPhase: 'searching' }), TEXTS)).toBe(TEXTS.researchStageText);
  });

  it('prefers the image phase text over research and stream signals', () => {
    expect(resolveOrinBubbleText(signals({ isLoading: true, imagePhase: 'drawing', researchStage: 'searching', streamPhase: 'searching' }), TEXTS)).toBe(TEXTS.imagePhaseText);
  });
});

describe('Orin working presence (2026-11-14 revision)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia(false);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders nothing while the text is null, and never renders the old bubble', () => {
    renderPresence({ text: null });
    expect(screen.queryByTestId('origin-orin-overlay')).toBeNull();
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
  });

  it('renders the large Orin with the name and the status pill while working', () => {
    renderPresence();
    const overlay = screen.getByTestId('origin-orin-overlay');
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
    // 名前は円の真下に「オリン」。
    expect(screen.getByTestId('origin-orin-overlay-name').textContent).toBe('オリン');
    // 状態ピルは吹き出しと同じ解決済みテキストをそのまま出す。
    expect(screen.getByTestId('origin-orin-overlay-status').textContent).toBe('回答を準備しています…');
    // 大きなオリン：絵96px・台座外径104px（約104pxの円）。
    const cat = screen.getByTestId('origin-cat-state');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_OVERLAY_CAT_SIZE_PX}px`);
    expect((cat as HTMLElement).style.height).toBe(`${ORIN_OVERLAY_CAT_SIZE_PX}px`);
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect((pedestal as HTMLElement).style.width).toBe(`${ORIN_OVERLAY_PEDESTAL_SIZE_PX}px`);
    expect((pedestal as HTMLElement).style.height).toBe(`${ORIN_OVERLAY_PEDESTAL_SIZE_PX}px`);
    expect(ORIN_OVERLAY_PEDESTAL_SIZE_PX).toBe(104);
    expect(overlay.contains(pedestal)).toBe(true);
  });

  it('uses the English name for the English locale', () => {
    renderPresence({ language: 'en' });
    expect(screen.getByTestId('origin-orin-overlay-name').textContent).toBe('Orin');
  });

  it('moves while working: the working state uses the motion video asset', () => {
    renderPresence({ state: 'working' });
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('VIDEO');
    expect(cat.getAttribute('data-state')).toBe('working');
  });

  it('swaps the status text without unmounting on phase changes', () => {
    const { props, rerender } = renderPresence();
    const overlay = screen.getByTestId('origin-orin-overlay');
    act(() => { vi.advanceTimersByTime(50); });
    expect((overlay as HTMLElement).style.opacity).toBe('1');
    rerender(<OrinSpeechBubble {...props} text="回答をまとめています…" state="thinking" />);
    expect(screen.getByTestId('origin-orin-overlay')).toBe(overlay);
    expect(screen.getByTestId('origin-orin-overlay-status').textContent).toBe('回答をまとめています…');
  });

  it('fades out and unmounts after the fade when the text clears', () => {
    const { props, rerender } = renderPresence();
    act(() => { vi.advanceTimersByTime(50); });
    rerender(<OrinSpeechBubble {...props} text={null} />);
    // フェードアウトの間はまだ残り、尺が過ぎたら消える。
    expect(screen.queryByTestId('origin-orin-overlay')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(ORIN_BUBBLE_FADE_MS); });
    expect(screen.queryByTestId('origin-orin-overlay')).toBeNull();
  });

  it('shows and hides immediately under reduced motion, with a still instead of the video', () => {
    stubMatchMedia(true);
    const { props, rerender } = renderPresence({ text: null, state: 'working' });
    rerender(<OrinSpeechBubble {...props} text="描いています" />);
    const overlay = screen.getByTestId('origin-orin-overlay');
    expect((overlay as HTMLElement).style.opacity).toBe('1');
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('IMG');
    expect(cat.getAttribute('data-state')).toBe('working');
    rerender(<OrinSpeechBubble {...props} text={null} />);
    expect(screen.queryByTestId('origin-orin-overlay')).toBeNull();
  });

  it('stays hidden while the work sheet is open (hidden prop), even with a status text', () => {
    renderPresence({ hidden: true });
    expect(screen.queryByTestId('origin-orin-overlay')).toBeNull();
  });

  it('opens the work sheet when the overlay is tapped', () => {
    const onOpenWorkSheet = vi.fn();
    renderPresence({ onOpenWorkSheet });
    fireEvent.click(screen.getByRole('button', { name: 'いまの作業を表示' }));
    expect(onOpenWorkSheet).toHaveBeenCalledTimes(1);
  });

  it('pins the overlay CSS: no old bubble styles, z-index below the work sheet', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    expect(css).not.toContain('.origin-orin-bubble');
    expect(css).not.toContain('top: 3.5rem');
    expect(css).toContain('.origin-orin-overlay {');
    expect(css).toContain('.origin-orin-overlay__pill {');
    // 作業シート（backdrop z-20／panel z-30）より下、会話より上。
    expect(css).toContain('z-index: 15;');
    // タップできるのはプレゼンス自身のタップ対象だけ。
    expect(css).toContain('pointer-events: none;');
    expect(css).toContain('pointer-events: auto;');
  });
});
