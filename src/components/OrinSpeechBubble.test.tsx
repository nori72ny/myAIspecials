import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrinSpeechBubble, {
  ORIN_BUBBLE_FADE_MS,
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

describe('OrinSpeechBubble', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia(false);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders nothing while the text is null', () => {
    render(<OrinSpeechBubble text={null} />);
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
  });

  it('fades in when a stage text arrives and swaps text without unmounting on phase changes', () => {
    const { rerender } = render(<OrinSpeechBubble text={null} />);
    rerender(<OrinSpeechBubble text="回答を準備しています…" />);
    const bubble = screen.getByTestId('origin-orin-bubble');
    expect(bubble.textContent).toContain('回答を準備しています…');
    act(() => { vi.advanceTimersByTime(50); });
    expect((bubble as HTMLElement).style.opacity).toBe('1');
    rerender(<OrinSpeechBubble text="回答をまとめています…" />);
    expect(screen.getByTestId('origin-orin-bubble').textContent).toContain('回答をまとめています…');
  });

  it('fades out and unmounts after the fade when the text clears', () => {
    const { rerender } = render(<OrinSpeechBubble text="回答を準備しています…" />);
    act(() => { vi.advanceTimersByTime(50); });
    rerender(<OrinSpeechBubble text={null} />);
    // フェードアウトの間はまだ残り、尺が過ぎたら消える。
    expect(screen.queryByTestId('origin-orin-bubble')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(ORIN_BUBBLE_FADE_MS); });
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
  });

  it('shows and hides immediately under reduced motion (no fade)', () => {
    stubMatchMedia(true);
    const { rerender } = render(<OrinSpeechBubble text={null} />);
    rerender(<OrinSpeechBubble text="回答を準備しています…" />);
    const bubble = screen.getByTestId('origin-orin-bubble');
    expect((bubble as HTMLElement).style.opacity).toBe('1');
    rerender(<OrinSpeechBubble text={null} />);
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
  });
});
