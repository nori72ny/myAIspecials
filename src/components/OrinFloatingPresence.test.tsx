import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrinFloatingPresence, {
  ORIN_PRESENCE_FADE_MS,
  ORIN_PRESENCE_CAT_SIZE_PX,
  ORIN_PRESENCE_PEDESTAL_SIZE_PX,
  resolveOrinBubbleText,
  type OrinBubbleSignals,
} from './OrinFloatingPresence';

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

function renderPresence(overrides: Partial<React.ComponentProps<typeof OrinFloatingPresence>> = {}) {
  const props: React.ComponentProps<typeof OrinFloatingPresence> = {
    text: null,
    state: 'idle',
    language: 'ja',
    onOpenWorkSheet: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<OrinFloatingPresence {...props} />) };
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

describe('Orin floating presence (2026-11-14 08:59 revision)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia(false);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('floats even while idle: art and name are present, the pill is not, and the old displays never render', () => {
    renderPresence();
    const presence = screen.getByTestId('origin-orin-presence');
    expect(screen.queryByTestId('origin-orin-overlay')).toBeNull();
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
    // 名前は待機中も円の真下に「オリン」。
    expect(screen.getByTestId('origin-orin-presence-name').textContent).toBe('オリン');
    // 状態ピルは作業中だけ。待機中は出ない。
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    // 大きなオリン：絵96px・台座外径104px（作業中と同じ大きさ）。
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('IMG');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    expect((cat as HTMLElement).style.height).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect((pedestal as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_PEDESTAL_SIZE_PX}px`);
    expect((pedestal as HTMLElement).style.height).toBe(`${ORIN_PRESENCE_PEDESTAL_SIZE_PX}px`);
    expect(ORIN_PRESENCE_PEDESTAL_SIZE_PX).toBe(104);
    expect(presence.contains(pedestal)).toBe(true);
    // 待機中は台座ごと静かな呼吸が付く。
    expect(pedestal.classList.contains('origin-cat-breathe')).toBe(true);
  });

  it('uses the English name for the English locale', () => {
    renderPresence({ language: 'en' });
    expect(screen.getByTestId('origin-orin-presence-name').textContent).toBe('Orin');
  });

  it('shows the status pill only while working, at the same art size as idle', () => {
    const { props, rerender } = renderPresence();
    const idlePedestal = screen.getByTestId('origin-cat-pedestal');
    expect((idlePedestal as HTMLElement).style.width).toBe('104px');
    rerender(<OrinFloatingPresence {...props} text="回答を準備しています…" state="thinking" />);
    // ピルは段階文をそのまま出す。名前も残る。
    expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('回答を準備しています…');
    expect(screen.getByTestId('origin-orin-presence-name').textContent).toBe('オリン');
    // 作業中も大きさは変わらない（絵96px・台座104px）。
    const cat = screen.getByTestId('origin-cat-state');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect(pedestal).toBe(idlePedestal);
    expect((pedestal as HTMLElement).style.width).toBe('104px');
    // ピルが出ている間は呼吸を付けない。
    expect(pedestal.classList.contains('origin-cat-breathe')).toBe(false);
  });

  it('moves while working: the working state uses the motion video asset', () => {
    renderPresence({ text: '描いています', state: 'working' });
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('VIDEO');
    expect(cat.getAttribute('data-state')).toBe('working');
  });

  it('swaps the pill text without unmounting on phase changes', () => {
    const { props, rerender } = renderPresence({ text: '回答を準備しています…', state: 'thinking' });
    const presence = screen.getByTestId('origin-orin-presence');
    act(() => { vi.advanceTimersByTime(50); });
    expect((screen.getByTestId('origin-orin-presence-status') as HTMLElement).style.opacity).toBe('1');
    rerender(<OrinFloatingPresence {...props} text="回答をまとめています…" />);
    expect(screen.getByTestId('origin-orin-presence')).toBe(presence);
    expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('回答をまとめています…');
  });

  it('on completion only the pill fades out — the presence stays at the same size (no shrink back)', () => {
    const { props, rerender } = renderPresence({ text: '回答を準備しています…', state: 'thinking' });
    act(() => { vi.advanceTimersByTime(50); });
    rerender(<OrinFloatingPresence {...props} text={null} state="idle" />);
    // フェードアウトの間ピルは残り、尺が過ぎたらピルだけが消える。
    expect(screen.queryByTestId('origin-orin-presence-status')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(ORIN_PRESENCE_FADE_MS); });
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    // 姿と名前は残り、大きさも待機・作業と同じ（小さくならない）。
    expect(screen.getByTestId('origin-orin-presence')).toBeTruthy();
    expect(screen.getByTestId('origin-orin-presence-name').textContent).toBe('オリン');
    const cat = screen.getByTestId('origin-cat-state');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect((pedestal as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_PEDESTAL_SIZE_PX}px`);
  });

  it('shows and hides the pill immediately under reduced motion, with a still instead of the video', () => {
    stubMatchMedia(true);
    const { props, rerender } = renderPresence({ state: 'working' });
    // マウント時に reduced-motion を読み直させるため、スタブ後に描画する。
    rerender(<OrinFloatingPresence {...props} text="描いています" />);
    const pill = screen.getByTestId('origin-orin-presence-status');
    expect((pill as HTMLElement).style.opacity).toBe('1');
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('IMG');
    expect(cat.getAttribute('data-state')).toBe('working');
    rerender(<OrinFloatingPresence {...props} text={null} />);
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    // reduced-motion でも姿は残る。
    expect(screen.getByTestId('origin-orin-presence')).toBeTruthy();
  });

  it('stays hidden while the work sheet is open (hidden prop), even with a status text', () => {
    renderPresence({ text: '回答を準備しています…', state: 'thinking', hidden: true });
    expect(screen.queryByTestId('origin-orin-presence')).toBeNull();
  });

  it('opens the work sheet when tapped, and is the only control with that name in idle and working states', () => {
    const onOpenWorkSheet = vi.fn();
    const { props, rerender } = renderPresence({ onOpenWorkSheet });
    // 待機中：「いまの作業を表示」はこのタップ対象ただ1つ。
    expect(screen.getAllByRole('button', { name: 'いまの作業を表示' })).toHaveLength(1);
    rerender(<OrinFloatingPresence {...props} text="回答を準備しています…" state="thinking" />);
    // 作業中もただ1つ（ヘッダー側の同名ボタンは廃止した）。
    const controls = screen.getAllByRole('button', { name: 'いまの作業を表示' });
    expect(controls).toHaveLength(1);
    expect(screen.getByTestId('origin-orin-presence').contains(controls[0])).toBe(true);
    fireEvent.click(controls[0]);
    expect(onOpenWorkSheet).toHaveBeenCalledTimes(1);
  });

  it('pins the presence CSS: fixed on screen, z-index below the work sheet, conversation clearance', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    expect(css).not.toContain('.origin-orin-bubble');
    expect(css).not.toContain('.origin-orin-overlay');
    expect(css).toContain('.origin-orin-presence {');
    expect(css).toContain('.origin-orin-presence__pill {');
    // スクロールで動かないよう position: fixed で画面に固定する。
    expect(css).toContain('position: fixed;');
    // ヘッダー（60px／小画面58px）の下＋8pxの位置。
    expect(css).toContain('top: calc(60px + env(safe-area-inset-top, 0px) + 8px);');
    expect(css).toContain('top: calc(58px + env(safe-area-inset-top, 0px) + 8px);');
    // 作業シート（backdrop z-20／panel z-30）より下、会話より上。
    expect(css).toContain('z-index: 15;');
    // タップできるのはプレゼンス自身のタップ対象だけ。
    expect(css).toContain('pointer-events: none;');
    expect(css).toContain('pointer-events: auto;');
    // 待機中に最初のメッセージがプレゼンスに隠れないよう、会話列に
    // 上部の余白を確保する。
    expect(css).toContain('.origin-conversation-log');
    expect(css).toContain('padding-top: 156px !important;');
  });
});
