import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrinStage, {
  ORIN_STAGE_APPEAR_DELAY_MS,
  ORIN_STAGE_CAT_SIZE_DESKTOP_PX,
  ORIN_STAGE_CAT_SIZE_MOBILE_PX,
  ORIN_STAGE_DONE_CUE_MS,
  ORIN_STAGE_FADE_OUT_MS,
  ORIN_STAGE_OUTCOME_SETTLE_MS,
  ORIN_STAGE_QUIET_AFTER_MS,
  ORIN_STAGE_SORRY_CUE_MS,
  resolveOrinStageDisplay,
  stripOrinStageTitle,
  type OrinStageDisplay,
  type OrinStageProps,
} from './OrinStage';

const TEXTS = {
  waitingText: '回答を準備しています…',
  researchStageText: '公開情報を探しています',
  imagePhaseText: '描いています',
};

function stubMatchMedia({ reduced = false, wide = false }: { reduced?: boolean; wide?: boolean } = {}) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : wide,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const THINKING_DISPLAY: OrinStageDisplay = { catState: 'thinking', motion: 'thinking', title: '回答を準備しています' };
const WORKING_DISPLAY: OrinStageDisplay = { catState: 'working', motion: 'working', title: '描いています' };

function baseProps(overrides: Partial<OrinStageProps> = {}): OrinStageProps {
  return {
    waiting: false,
    sending: false,
    episode: 1,
    outcome: null,
    display: null,
    backLabel: '会話に戻る',
    ...overrides,
  };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('resolveOrinStageDisplay (design §3.3 correspondence table)', () => {
  const signals = { imagePhase: null, researchStage: null, streamPhase: null, isLoading: false } as const;

  it('maps image phases first', () => {
    expect(resolveOrinStageDisplay({ ...signals, imagePhase: 'designing', isLoading: true }, TEXTS))
      .toEqual({ catState: 'thinking', motion: 'designing', title: '描いています' });
    expect(resolveOrinStageDisplay({ ...signals, imagePhase: 'drawing', isLoading: true }, TEXTS))
      .toEqual({ catState: 'working', motion: 'working', title: '描いています' });
    expect(resolveOrinStageDisplay({ ...signals, imagePhase: 'checking', isLoading: true }, TEXTS))
      .toEqual({ catState: 'thinking', motion: 'checking', title: '描いています' });
  });

  it('maps research stages', () => {
    expect(resolveOrinStageDisplay({ ...signals, researchStage: 'searching', isLoading: true }, TEXTS))
      .toEqual({ catState: 'searching', motion: 'searching', title: '公開情報を探しています' });
    expect(resolveOrinStageDisplay({ ...signals, researchStage: 'checking', isLoading: true }, TEXTS))
      .toEqual({ catState: 'searching', motion: 'checking', title: '公開情報を探しています' });
    expect(resolveOrinStageDisplay({ ...signals, researchStage: 'writing', isLoading: true }, TEXTS))
      .toEqual({ catState: 'thinking', motion: 'composing', title: '公開情報を探しています' });
  });

  it('maps phased-stream phases and the plain waiting state, stripping the trailing ellipsis from titles', () => {
    expect(resolveOrinStageDisplay({ ...signals, streamPhase: 'searching', isLoading: true }, TEXTS))
      .toEqual({ catState: 'searching', motion: 'searching', title: '回答を準備しています' });
    expect(resolveOrinStageDisplay({ ...signals, streamPhase: 'composing', isLoading: true }, TEXTS))
      .toEqual({ catState: 'thinking', motion: 'composing', title: '回答を準備しています' });
    expect(resolveOrinStageDisplay({ ...signals, isLoading: true }, TEXTS))
      .toEqual({ catState: 'thinking', motion: 'thinking', title: '回答を準備しています' });
  });

  it('returns null when nothing is in flight', () => {
    expect(resolveOrinStageDisplay({ ...signals }, TEXTS)).toBeNull();
  });

  it('stripOrinStageTitle removes trailing ellipsis / period runs only', () => {
    expect(stripOrinStageTitle('回答を準備しています…')).toBe('回答を準備しています');
    expect(stripOrinStageTitle('描いています')).toBe('描いています');
    expect(stripOrinStageTitle('Preparing your answer…')).toBe('Preparing your answer');
  });
});

describe('OrinStage visibility state machine', () => {
  it('appears only after the 200ms appearance delay and reports visibility', () => {
    const onVisibilityChange = vi.fn();
    render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY, onVisibilityChange })} />);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
    advance(ORIN_STAGE_APPEAR_DELAY_MS - 1);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
    advance(1);
    const stage = screen.getByTestId('origin-stage');
    expect(stage.textContent).toContain('回答を準備しています');
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
  });

  it('never appears when the wait ends inside the delay (fast answer)', () => {
    const { rerender } = render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS - 50);
    rerender(<OrinStage {...baseProps({ waiting: false, sending: false, display: null })} />);
    advance(1000);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
  });

  it('recedes without a cue when the answer starts streaming (sending continues)', () => {
    const { rerender } = render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    expect(screen.getByTestId('origin-stage')).toBeTruthy();
    rerender(<OrinStage {...baseProps({ waiting: false, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_FADE_OUT_MS);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
    // 本文開始後に出し直される合図はない（確定設計1、§3.4）。
    advance(5000);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
  });

  it('shows the done cue (small nod) when the send completes normally', () => {
    const { rerender } = render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    rerender(<OrinStage {...baseProps({ waiting: false, sending: false, outcome: 'done', display: null })} />);
    advance(ORIN_STAGE_OUTCOME_SETTLE_MS);
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.getAttribute('data-state')).toBe('done');
    expect(cat.parentElement?.className).toContain('origin-stage-done');
    // 合図の間はステージが残り、合図＋フェードで消える。
    advance(ORIN_STAGE_DONE_CUE_MS - 1);
    expect(screen.queryByTestId('origin-stage')).not.toBeNull();
    advance(1 + ORIN_STAGE_FADE_OUT_MS);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
  });

  it('waits for a late-arriving outcome classification before choosing the cue', () => {
    const { rerender } = render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    rerender(<OrinStage {...baseProps({ waiting: false, sending: false, outcome: null, display: null })} />);
    advance(ORIN_STAGE_OUTCOME_SETTLE_MS - 30);
    rerender(<OrinStage {...baseProps({ waiting: false, sending: false, outcome: 'done', display: null })} />);
    advance(30);
    expect(screen.getByTestId('origin-cat-state').getAttribute('data-state')).toBe('done');
  });

  it('shows the sorry cue for 1,200ms when the send fails', () => {
    const { rerender } = render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    rerender(<OrinStage {...baseProps({ waiting: false, sending: false, outcome: 'sorry', display: null })} />);
    advance(ORIN_STAGE_OUTCOME_SETTLE_MS);
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.getAttribute('data-state')).toBe('sorry');
    expect(cat.parentElement?.className).toContain('origin-stage-sorry');
    advance(ORIN_STAGE_SORRY_CUE_MS - 1);
    expect(screen.queryByTestId('origin-stage')).not.toBeNull();
    advance(1 + ORIN_STAGE_FADE_OUT_MS);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
  });

  it('recedes without any cue on abort / clarification outcomes (outcome stays null)', () => {
    const { rerender } = render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    rerender(<OrinStage {...baseProps({ waiting: false, sending: false, outcome: null, display: null })} />);
    advance(ORIN_STAGE_OUTCOME_SETTLE_MS);
    // 合図の猫（done / sorry）には切り替わらない。
    expect(screen.getByTestId('origin-cat-state').getAttribute('data-state')).toBe('thinking');
    advance(ORIN_STAGE_FADE_OUT_MS);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
  });

  it('minimizes on tap and stays minimized for the rest of the episode; a new episode re-arms it', () => {
    const onVisibilityChange = vi.fn();
    const { rerender } = render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY, onVisibilityChange })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(screen.queryByTestId('origin-stage')).toBeNull();
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
    advance(5000);
    expect(screen.queryByTestId('origin-stage')).toBeNull();
    // 次の送信（episode が増える）では再び出る。
    rerender(<OrinStage {...baseProps({ waiting: false, sending: false, episode: 1, display: null, onVisibilityChange })} />);
    rerender(<OrinStage {...baseProps({ waiting: true, sending: true, episode: 2, display: THINKING_DISPLAY, onVisibilityChange })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    expect(screen.getByTestId('origin-stage')).toBeTruthy();
  });

  it('minimizes on Escape', () => {
    render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('origin-stage')).toBeNull();
  });

  it('always passes stillOnly: the working state renders a still, never the audited mp4', () => {
    render(<OrinStage {...baseProps({ waiting: true, sending: true, display: WORKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('IMG');
    expect(cat.getAttribute('data-state')).toBe('working');
    expect(document.querySelector('video')).toBeNull();
    // 台座ディスクは付けない（統括確定 U-2）。
    expect(screen.queryByTestId('origin-cat-pedestal')).toBeNull();
  });

  it('sizes the cat at the δ1 caps (224px mobile / 256px at sm and up)', () => {
    render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    expect((screen.getByTestId('origin-cat-state') as HTMLElement).style.width).toBe(`${ORIN_STAGE_CAT_SIZE_MOBILE_PX}px`);
    cleanup();
    stubMatchMedia({ wide: true });
    render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    expect((screen.getByTestId('origin-cat-state') as HTMLElement).style.width).toBe(`${ORIN_STAGE_CAT_SIZE_DESKTOP_PX}px`);
  });

  it('quiets the thinking/searching motion after 20 seconds of waiting (§4.2)', () => {
    render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    expect(document.querySelector('.origin-stage--quiet')).toBeNull();
    advance(ORIN_STAGE_QUIET_AFTER_MS);
    expect(document.querySelector('.origin-stage--quiet')).not.toBeNull();
  });

  it('renders the stage without motion classes under prefers-reduced-motion', () => {
    stubMatchMedia({ reduced: true });
    render(<OrinStage {...baseProps({ waiting: true, sending: true, display: THINKING_DISPLAY })} />);
    advance(ORIN_STAGE_APPEAR_DELAY_MS);
    expect(screen.getByTestId('origin-stage')).toBeTruthy();
    expect(document.querySelector('.origin-stage-breathe')).toBeNull();
    expect(document.querySelector('.origin-stage-tilt')).toBeNull();
  });
});

describe('OrinStage CSS contract (§4.2 numbers pinned in origin-top-ui.css)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');

  it('pins the stage layer and per-state motion durations', () => {
    expect(css).toContain('.origin-stage {');
    expect(css).toContain('z-index: 60');
    expect(css).toContain('origin-stage-breathe 5200ms');
    expect(css).toContain('origin-stage-tilt 7800ms');
    expect(css).toContain('origin-stage-searching 6000ms');
    expect(css).toContain('origin-stage-working 2400ms');
    expect(css).toContain('origin-stage-designing 4000ms');
    expect(css).toContain('origin-stage-checking 6000ms');
    expect(css).toContain(`origin-stage-nod ${ORIN_STAGE_DONE_CUE_MS}ms`);
    expect(css).toContain('origin-stage-sorry 900ms');
    expect(css).toContain('@keyframes origin-stage-breathe-quiet');
    expect(css).toContain('@keyframes origin-stage-searching-quiet');
  });

  it('keeps amplitudes inside the §4.2 caps', () => {
    // thinking の呼吸ピークは scale 1.02、searching の平行移動は ±6px、
    // done の頷きは translateY 3px、sorry の下げは translateY 4px。
    expect(css).toContain('42% { transform: scale(1.02); }');
    expect(css).toContain('translateX(-6px)');
    expect(css).toContain('translateX(6px)');
    expect(css).toContain('35% { transform: translateY(3px) scale(0.985); }');
    expect(css).toContain('to { transform: translateY(4px) scale(0.99); }');
    // 静音側（20秒超）は半減値。
    expect(css).toContain('42% { transform: scale(1.01); }');
    expect(css).toContain('translateX(-3px)');
  });

  it('stops stage motion under prefers-reduced-motion in CSS as a second net', () => {
    const reducedBlock = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reducedBlock).toContain('.origin-stage-breathe');
    expect(reducedBlock).toContain('.origin-stage-searching');
    expect(reducedBlock).toContain('animation: none');
  });
});
