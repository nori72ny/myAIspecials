import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrinFloatingPresence, {
  ORIN_PRESENCE_FADE_MS,
  ORIN_PRESENCE_CAT_SIZE_PX,
  ORIN_PRESENCE_CAT_SIZE_COMPACT_PX,
  ORIN_PRESENCE_SCROLL_OPACITY,
  ORIN_PRESENCE_SCROLL_RESTORE_MS,
  ORIN_PRESENCE_SCROLL_SHRINK_THRESHOLD_PX,
  resolveOrinAgentBubbleText,
  resolveOrinBubbleText,
  resolveOrinPillState,
  resolveOrinPillText,
  type OrinBubbleSignals,
  type OrinPillPriority,
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

describe('resolveOrinAgentBubbleText (2026-11-20 detail pass)', () => {
  const FALLBACK = 'エージェントが作業しています';

  it('shows the current step title while the agent works and the chat is idle', () => {
    expect(resolveOrinAgentBubbleText({ agentActive: true, chatLoading: false, stepTitle: 'ウェブで調べる' }, FALLBACK)).toBe('ウェブで調べる');
  });

  it('switches the text as the step advances', () => {
    const base = { agentActive: true, chatLoading: false };
    expect(resolveOrinAgentBubbleText({ ...base, stepTitle: 'ウェブで調べる' }, FALLBACK)).toBe('ウェブで調べる');
    expect(resolveOrinAgentBubbleText({ ...base, stepTitle: '文書を作る' }, FALLBACK)).toBe('文書を作る');
    expect(resolveOrinAgentBubbleText({ ...base, stepTitle: 'テストと動作確認' }, FALLBACK)).toBe('テストと動作確認');
  });

  it('falls back to the generic agent text when there is no step title', () => {
    expect(resolveOrinAgentBubbleText({ agentActive: true, chatLoading: false, stepTitle: null }, FALLBACK)).toBe(FALLBACK);
  });

  it('stays silent while a chat send is in flight (the foreground work owns the pill)', () => {
    expect(resolveOrinAgentBubbleText({ agentActive: true, chatLoading: true, stepTitle: 'ウェブで調べる' }, FALLBACK)).toBeNull();
  });

  it('stays silent when the agent is not active', () => {
    expect(resolveOrinAgentBubbleText({ agentActive: false, chatLoading: false, stepTitle: 'ウェブで調べる' }, FALLBACK)).toBeNull();
    expect(resolveOrinAgentBubbleText({ agentActive: false, chatLoading: false, stepTitle: null }, FALLBACK)).toBeNull();
  });
});

describe('resolveOrinPillText priority (2026-11-20 detail pass)', () => {
  function priority(overrides: Partial<OrinPillPriority> = {}): OrinPillPriority {
    return { sheetOpen: false, workingText: null, failureText: null, doneText: null, agentText: null, ...overrides };
  }

  it('returns null when nothing applies', () => {
    expect(resolveOrinPillText(priority())).toBeNull();
  });

  it('shows the agent step text when only the agent is working', () => {
    expect(resolveOrinPillText(priority({ agentText: 'ウェブで調べる' }))).toBe('ウェブで調べる');
  });

  it('prefers foreground chat work over failure, completion and the agent', () => {
    expect(resolveOrinPillText(priority({
      workingText: '回答を準備しています…', failureText: 'エラーが発生しました', doneText: 'できました', agentText: 'ウェブで調べる',
    }))).toBe('回答を準備しています…');
  });

  it('prefers the failure cue over completion and the agent', () => {
    expect(resolveOrinPillText(priority({
      failureText: 'エラーが発生しました', doneText: 'できました', agentText: 'ウェブで調べる',
    }))).toBe('エラーが発生しました');
  });

  it('prefers the completion cue over the agent', () => {
    expect(resolveOrinPillText(priority({ doneText: 'できました', agentText: 'ウェブで調べる' }))).toBe('できました');
  });

  it('hides everything while the work sheet is open', () => {
    expect(resolveOrinPillText(priority({
      sheetOpen: true, workingText: '回答を準備しています…', failureText: 'エラーが発生しました', doneText: 'できました', agentText: 'ウェブで調べる',
    }))).toBeNull();
  });
});

describe('resolveOrinPillState active flag (2026-11-20 18:17 liveness dots)', () => {
  function priority(overrides: Partial<OrinPillPriority> = {}): OrinPillPriority {
    return { sheetOpen: false, workingText: null, failureText: null, doneText: null, agentText: null, ...overrides };
  }

  it('marks foreground chat work as active', () => {
    expect(resolveOrinPillState(priority({ workingText: '回答を準備しています…' }))).toEqual({ text: '回答を準備しています…', active: true });
  });

  it('marks background agent work as active', () => {
    expect(resolveOrinPillState(priority({ agentText: 'ウェブで調べる' }))).toEqual({ text: 'ウェブで調べる', active: true });
  });

  it('does not mark the completion or failure cues as active', () => {
    expect(resolveOrinPillState(priority({ doneText: 'できました' }))).toEqual({ text: 'できました', active: false });
    expect(resolveOrinPillState(priority({ failureText: 'エラーが発生しました' }))).toEqual({ text: 'エラーが発生しました', active: false });
  });

  it('is inactive when nothing is shown', () => {
    expect(resolveOrinPillState(priority())).toEqual({ text: null, active: false });
    expect(resolveOrinPillState(priority({ sheetOpen: true, workingText: '回答を準備しています…' }))).toEqual({ text: null, active: false });
  });
});

describe('Orin presence (2026-11-14 08:59 revision, frameless form + floating auto-shrink 2026-11-20, fully visible revision 15:36)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia(false);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is resident even while idle: the art is present, the status text and the name are not, and the old displays never render', () => {
    renderPresence();
    const presence = screen.getByTestId('origin-orin-presence');
    expect(screen.queryByTestId('origin-orin-overlay')).toBeNull();
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
    // 姿の下の名前テキストは出さない（2026-11-15 ノリ指示で削除。
    // 名前はプロフィールカードの中にだけ出す）。
    expect(screen.queryByTestId('origin-orin-presence-name')).toBeNull();
    // 状態テキストは作業中だけ。待機中は出ない。
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    // 枠なし方式（2026-11-20 12:06）：台座も窓枠も付けない。
    // 円盤は枠も影もないラッパー（__disc）に包まれる。
    expect(within(presence).queryByTestId('origin-cat-pedestal')).toBeNull();
    // 円盤の中のオリン：通常時（待機・未スクロール）は絵72px
    // （2026-11-20 18:17 の実機判定で、顔が読める大きさへ拡大）。
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('IMG');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    expect((cat as HTMLElement).style.height).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    expect(ORIN_PRESENCE_CAT_SIZE_PX).toBe(72);
    expect(presence.contains(cat)).toBe(true);
    expect(cat.parentElement?.classList.contains('origin-orin-presence__disc')).toBe(true);
    // 待機中はオリンだけの形（is-idle）になり、
    // 自動縮小（is-compact）はまだ発火していない。
    const tap = screen.getByRole('button', { name: 'いまの作業を表示' });
    expect(tap.classList.contains('is-idle')).toBe(true);
    expect(tap.classList.contains('is-compact')).toBe(false);
    // 待機中は絵に静かな呼吸が付く。
    expect(cat.classList.contains('origin-cat-breathe')).toBe(true);
  });

  it('renders no name under the art in the English locale either', () => {
    renderPresence({ language: 'en' });
    expect(screen.queryByTestId('origin-orin-presence-name')).toBeNull();
    expect(screen.getByTestId('origin-orin-presence')).toBeTruthy();
  });

  it('plays the one-shot joy motion on the art when the tap joy signal fires', () => {
    const { props, rerender } = renderPresence();
    // 合図が無ければ喜ぶ動きは付かない。
    expect(screen.getByTestId('origin-cat-state').parentElement?.classList.contains('origin-cat-joy')).toBe(false);
    rerender(<OrinFloatingPresence {...props} joySignal={1} />);
    expect(screen.getByTestId('origin-cat-state').parentElement?.classList.contains('origin-cat-joy')).toBe(true);
  });

  it('shows the status text below the disc while working, and shrinks the art to the compact size (2026-11-20 10:10 auto-shrink; text moved below 2026-11-21)', () => {
    const { props, rerender } = renderPresence();
    const idleCat = screen.getByTestId('origin-cat-state');
    expect((idleCat as HTMLElement).style.width).toBe('72px');
    rerender(<OrinFloatingPresence {...props} text="回答を準備しています…" state="thinking" />);
    // 状態テキストは段階文をそのまま円盤の下に出す（中心軸は待機時と固定）。
    expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('回答を準備しています…');
    // 作業中は自動縮小が発火し、絵は48pxになる（テキストは常に見える）。
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat).toBe(idleCat);
    expect(ORIN_PRESENCE_CAT_SIZE_COMPACT_PX).toBe(48);
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_COMPACT_PX}px`);
    expect((cat as HTMLElement).style.height).toBe(`${ORIN_PRESENCE_CAT_SIZE_COMPACT_PX}px`);
    // テキストが出ている間はオリンだけの形ではなく、呼吸も付けない。
    const tap = screen.getByRole('button', { name: 'いまの作業を表示' });
    expect(tap.classList.contains('is-idle')).toBe(false);
    expect(tap.classList.contains('is-compact')).toBe(true);
    expect(cat.classList.contains('origin-cat-breathe')).toBe(false);
  });

  it('shrinks to the compact cat-only form while the conversation is scrolled, and grows back at the top', () => {
    const { props, rerender } = renderPresence({ scrolled: true });
    // スクロール中は待機でも自動縮小：絵48px、テキストは出ず、
    // オリンだけの小さい形（is-idle かつ is-compact）。
    const cat = screen.getByTestId('origin-cat-state');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_COMPACT_PX}px`);
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    const tap = screen.getByRole('button', { name: 'いまの作業を表示' });
    expect(tap.classList.contains('is-idle')).toBe(true);
    expect(tap.classList.contains('is-compact')).toBe(true);
    // 先頭に戻ると通常の72pxに戻る。
    rerender(<OrinFloatingPresence {...props} scrolled={false} />);
    expect((screen.getByTestId('origin-cat-state') as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    expect(screen.getByRole('button', { name: 'いまの作業を表示' }).classList.contains('is-compact')).toBe(false);
  });

  it('keeps the status text visible at the compact size while scrolled during work', () => {
    renderPresence({ text: '回答を準備しています…', state: 'thinking', scrolled: true });
    // スクロール＋作業中でも、状態テキストは隠さず絵だけが小さい。
    expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('回答を準備しています…');
    expect((screen.getByTestId('origin-cat-state') as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_COMPACT_PX}px`);
  });

  it('fades the disc while the conversation is actively scrolling (2026-11-20 15:36 real-device fix)', () => {
    const { props, rerender } = renderPresence();
    const discOf = () => screen.getByTestId('origin-cat-state').parentElement;
    // スクロールしていない間は円盤は通常の不透明度（クラスなし）。
    expect(discOf()?.classList.contains('origin-orin-presence__disc')).toBe(true);
    expect(discOf()?.classList.contains('is-scrolling')).toBe(false);
    // スクロール中は円盤だけが薄くなる（is-scrolling）。絵の
    // サイズや状態テキストには触れない。
    rerender(<OrinFloatingPresence {...props} scrolling={true} />);
    expect(discOf()?.classList.contains('is-scrolling')).toBe(true);
    // スクロールが止まれば（App 側が約300ms後に false に戻す）
    // クラスが外れて不透明度が戻る。
    rerender(<OrinFloatingPresence {...props} scrolling={false} />);
    expect(discOf()?.classList.contains('is-scrolling')).toBe(false);
  });

  it('pins the scroll-shrink threshold the App side uses', () => {
    expect(ORIN_PRESENCE_SCROLL_SHRINK_THRESHOLD_PX).toBe(40);
  });

  it('pins the scroll fade values (opacity + restore delay)', () => {
    expect(ORIN_PRESENCE_SCROLL_OPACITY).toBe(0.35);
    expect(ORIN_PRESENCE_SCROLL_RESTORE_MS).toBe(300);
  });

  it('moves while working: the working state uses the motion video asset', () => {
    renderPresence({ text: '描いています', state: 'working' });
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('VIDEO');
    expect(cat.getAttribute('data-state')).toBe('working');
  });

  it('moves while searching: the searching state uses the look-around video asset', () => {
    renderPresence({ text: '最新の情報を調べています…', state: 'searching', active: true });
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('VIDEO');
    expect(cat.getAttribute('data-state')).toBe('searching');
  });

  it('shows blinking dots after the working text so the text itself shows Orin is running (2026-11-20 18:17)', () => {
    renderPresence({ text: '回答を準備しています…', state: 'working', active: true });
    const status = screen.getByTestId('origin-orin-presence-status');
    const dots = screen.getByTestId('origin-orin-presence-dots');
    expect(status.contains(dots)).toBe(true);
    expect(dots.getAttribute('aria-hidden')).toBe('true');
    expect(dots.querySelectorAll('span')).toHaveLength(3);
    // 文自体の省略記号（…）はドットが引き継ぐため、表示では
    // 外れる（二重の点々にしない）。文の内容は要約表現のまま。
    expect(status.textContent).toBe('回答を準備しています...');
    expect(status.textContent).not.toContain('…');
  });

  it('keeps a working text without an ellipsis as-is and still adds the dots', () => {
    renderPresence({ text: '絵を描いています', state: 'making', active: true });
    const status = screen.getByTestId('origin-orin-presence-status');
    expect(status.textContent).toBe('絵を描いています...');
    expect(screen.getByTestId('origin-orin-presence-dots')).toBeTruthy();
  });

  it('shows no dots for the completion cue (not active)', () => {
    renderPresence({ text: 'できました', state: 'done' });
    expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('できました');
    expect(screen.queryByTestId('origin-orin-presence-dots')).toBeNull();
  });

  it('swaps the status text without unmounting on phase changes', () => {
    const { props, rerender } = renderPresence({ text: '回答を準備しています…', state: 'thinking' });
    const presence = screen.getByTestId('origin-orin-presence');
    act(() => { vi.advanceTimersByTime(50); });
    expect((screen.getByTestId('origin-orin-presence-status') as HTMLElement).style.opacity).toBe('1');
    rerender(<OrinFloatingPresence {...props} text="回答をまとめています…" />);
    expect(screen.getByTestId('origin-orin-presence')).toBe(presence);
    expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('回答をまとめています…');
  });

  it('on completion only the status text fades out — the presence and the art stay, and the art grows back to full size', () => {
    const { props, rerender } = renderPresence({ text: '回答を準備しています…', state: 'thinking' });
    act(() => { vi.advanceTimersByTime(50); });
    // テキスト表示中は自動縮小で48px。
    expect((screen.getByTestId('origin-cat-state') as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_COMPACT_PX}px`);
    rerender(<OrinFloatingPresence {...props} text={null} state="idle" />);
    // フェードアウトの間テキストは残り、尺が過ぎたらテキストだけが消える。
    expect(screen.queryByTestId('origin-orin-presence-status')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(ORIN_PRESENCE_FADE_MS); });
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    // 姿は残り、絵は通常の72pxに戻る。オリンだけの形に戻り、
    // 自動縮小も解ける。
    expect(screen.getByTestId('origin-orin-presence')).toBeTruthy();
    const cat = screen.getByTestId('origin-cat-state');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    const tap = screen.getByRole('button', { name: 'いまの作業を表示' });
    expect(tap.classList.contains('is-idle')).toBe(true);
    expect(tap.classList.contains('is-compact')).toBe(false);
  });

  it('shows and hides the status text immediately under reduced motion, with a still instead of the video', () => {
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

  it('stays hidden while the hidden prop is set, even with a status text', () => {
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

  it('pins the presence CSS: frameless fully visible disc over the scroller, auto-shrink transition, scroller top clearance', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    expect(css).not.toContain('.origin-orin-bubble');
    expect(css).not.toContain('.origin-orin-overlay');
    expect(css).toContain('.origin-orin-presence {');
    expect(css).toContain('.origin-orin-presence__status {');
    // 名前ラベルのスタイルは名前ごと削除した（2026-11-15 ノリ指示）。
    expect(css).not.toContain('.origin-orin-presence__name');
    // 旧・濃色ピル（白文字＋強い影＋backdrop blur）は窓方式で廃止した。
    expect(css).not.toContain('.origin-orin-presence__pill');
    // 浮遊配置（2026-11-20 10:10 refine）：プレゼンスはメイン列の
    // 相対配置を基準に absolute で上部中央に浮く。ビューポート
    // fixed にはしない（サイドバーの開閉で列の中心がずれない
    // ようにするため）。列全体に広がる容器はタップを通し、
    // タップ対象だけがタップを受ける。
    // 全体表示の配置（2026-11-20 15:36）：top は 60px＝ヘッダー
    // 下端の位置（デスクトップ60px／モバイル58px）。タップの
    // パディング 6px 分だけ下に離れ、円盤は全体がヘッダーより
    // 下に出る（頭が切れない）。プレゼンスの z-index は 30 のまま。
    const floatRule = css.match(/\.origin-orin-presence \{[^}]*\}/)?.[0] ?? '';
    expect(floatRule).toContain('position: absolute;');
    expect(floatRule).toContain('top: 60px;');
    expect(floatRule).not.toContain('top: 46px;');
    expect(floatRule).toContain('z-index: 30;');
    expect(floatRule).toContain('display: flex;');
    expect(floatRule).toContain('justify-content: center;');
    expect(floatRule).toContain('pointer-events: none;');
    expect(floatRule).not.toContain('position: fixed');
    // 枠なし（2026-11-20 12:06 オーナー指示）：タップ対象は窓
    // パネルだったものをやめ、border・背景・影・パネル角丸を
    // 全て撤去した。残るのはレイアウトとタップ受けだけ。
    const tapRule = css.match(/\.origin-orin-presence__tap \{[^}]*\}/)?.[0] ?? '';
    // 縦並び（絵→状態文の下方向）で中心軸を全状態で固定する
    // （2026-11-21 再デザイン、外部デザイン評価の回収）。
    expect(tapRule).toContain('flex-direction: column;');
    expect(tapRule).toContain('border: none;');
    expect(tapRule).toContain('background: transparent;');
    expect(tapRule).toContain('box-shadow: none;');
    expect(tapRule).toContain('padding: 6px;');
    // タップの的は全状態で44px以上（2026-11-20 15:36）：最小寸法
    // を44pxに置き、48pxの縮小状態でも的は 60px（48＋ padding
    // 6px×2）になる。
    expect(tapRule).toContain('min-width: 44px;');
    expect(tapRule).toContain('min-height: 44px;');
    expect(tapRule).toContain('pointer-events: auto;');
    expect(tapRule).not.toContain('var(--bg-surface)');
    expect(tapRule).not.toContain('var(--radius-panel)');
    expect(tapRule).not.toContain('var(--shadow-1)');
    expect(tapRule).not.toContain('position: fixed');
    // 透過絵そのままの質感（2026-11-21 再デザイン）：ラッパーは
    // 枠も影も持たず、残るのは ::after の接地影（足元の楕円、
    // ライトテーマのみ）だけ。::after はタップを妨げない。
    const discRule = css.match(/\.origin-orin-presence__disc \{[^}]*\}/)?.[0] ?? '';
    expect(discRule).toContain('position: relative;');
    expect(discRule).not.toContain('border-radius');
    expect(discRule).not.toContain('box-shadow');
    const discAfterRule = css.match(/\.origin-orin-presence__disc::after \{[^}]*\}/)?.[0] ?? '';
    expect(discAfterRule).toContain('position: absolute;');
    expect(discAfterRule).toContain('border-radius: 50%;');
    expect(discAfterRule).toContain('pointer-events: none;');
    expect(discAfterRule).toContain('background: radial-gradient(ellipse at center,');
    expect(discAfterRule).not.toContain('box-shadow');
    // スクロール中フェード（2026-11-20 15:36）：円盤は不透明度
    // のトランジションを持ち、is-scrolling で約0.35まで薄くなる
    // （ORIN_PRESENCE_SCROLL_OPACITY と一致させること）。
    // transform はタップの手がかり（ホバー／押下）の遷移用に
    // 同じ尺で足した（2026-11-20 外部デザイン評価の回収）。
    expect(discRule).toContain('transition: opacity 200ms ease-out, transform 200ms ease-out;');
    const discScrollRule = css.match(/\.origin-orin-presence__disc\.is-scrolling \{[^}]*\}/)?.[0] ?? '';
    expect(discScrollRule).toContain(`opacity: ${ORIN_PRESENCE_SCROLL_OPACITY};`);
    // 作業コメントは枠なしテキスト：背景・枠を持たず、
    // キャンバス色（--bg-primary）のハローで読めるようにする。
    const statusRule = css.match(/\.origin-orin-presence__status \{[^}]*\}/)?.[0] ?? '';
    expect(statusRule).toContain('text-shadow:');
    expect(statusRule).toContain('var(--bg-primary)');
    expect(statusRule).not.toContain('background:');
    // 自動縮小のトランジション：絵の寸法変化は約200ms、
    // reduced-motion では即時（既存の media 規則側で無効化）。
    expect(css).toContain('transition: width 200ms ease-out, height 200ms ease-out;');
    // 作業中ドット（2026-11-20 18:17）：状態文の末尾の3ドットが
    // 順に点滅するアニメーションを持ち、reduced-motion では
    // 点滅を止める。
    expect(css).toContain('.origin-orin-presence__dots {');
    expect(css).toContain('@keyframes origin-orin-dots');
    expect(css).toContain('animation: origin-orin-dots 1200ms ease-in-out infinite;');
    const dotsRules = css.match(/\.origin-orin-presence__dots > span \{[^}]*\}/g) ?? [];
    expect(dotsRules.some((rule) => rule.includes('animation: origin-orin-dots'))).toBe(true);
    expect(dotsRules.some((rule) => rule.includes('animation: none;'))).toBe(true);
    // 会話スクローラ：先頭行が円盤の下端（ヘッダー下端から
    // 78px）より下に来るよう padding-top は 88px、
    // scroll-padding-top は円盤の下端より下の 84px。スクロール
    // した内容は円盤の下を通過できる（パディングはスクロール
    // 領域の一部）。
    expect(css).toContain('.origin-chat-scroll {');
    expect(css).toContain('padding-top: 88px;');
    expect(css).toContain('scroll-padding-top: 84px;');
    expect(css).not.toContain('padding-top: 64px;');
    expect(css).not.toContain('scroll-padding-top: 60px;');
    expect(css).not.toContain('scroll-padding-top: 52px;');
    expect(css).not.toContain('padding-top: 82px;');
    expect(css).not.toContain('scroll-padding-top: 64px;');
    expect(css).not.toContain('scroll-padding-top: 96px;');
    // 固定配置前提の会話クリアランス（131px）は撤去した。
    expect(css).not.toContain('padding-top: 131px !important;');
  });

  it('pins the dark-theme treatment and the quiet tappability cues (2026-11-20 external review follow-up; disc treatment replaced 2026-11-21)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    // ダークテーマ（2026-11-21 再デザイン）：焼き込みクリーム前提の
    // 減光フィルターと深い円盤影（#1402）は廃止。ダーク側の馴染みは
    // リムライト版の絵（OriginCatState の対描画）が担い、CSS 側は
    // 接地影を消すだけ。
    expect(css).not.toContain('saturate(0.84) brightness(0.93)');
    expect(css).not.toContain('0 3px 12px rgb(0 0 0 / 45%)');
    const darkDiscAfterRule = css.match(/:root\[data-theme="dark"\] \.origin-orin-presence__disc::after \{[^}]*\}/)?.[0] ?? '';
    expect(darkDiscAfterRule).toContain('display: none;');
    // タップの手がかり：常時表示の装飾は足さず、ホバーの微拡大と
    // 押下の微縮だけ。キーボードでは :focus-visible の輪郭が担う
    // （既存）。cursor: pointer はタップ規則側に既存。
    const hoverRule = css.match(/\.origin-orin-presence__tap:hover \.origin-orin-presence__disc \{[^}]*\}/)?.[0] ?? '';
    expect(hoverRule).toContain('transform: scale(1.05);');
    const activeRule = css.match(/\.origin-orin-presence__tap:active \.origin-orin-presence__disc \{[^}]*\}/)?.[0] ?? '';
    expect(activeRule).toContain('transform: scale(0.98);');
    const tapRule = css.match(/\.origin-orin-presence__tap \{[^}]*\}/)?.[0] ?? '';
    expect(tapRule).toContain('cursor: pointer;');
    expect(css).toContain('.origin-orin-presence__tap:focus-visible {');
    // reduced-motion では手がかりの拡縮も止める。
    const reducedBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{(?:[^{}]|\{[^{}]*\})*\}/g)?.join('\n') ?? '';
    expect(reducedBlock).toContain('.origin-orin-presence__tap:hover .origin-orin-presence__disc,');
    expect(reducedBlock).toContain('transform: none;');
  });
});
