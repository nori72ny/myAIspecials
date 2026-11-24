import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrinFloatingPresence, {
  ORIN_PRESENCE_FADE_MS,
  ORIN_PRESENCE_CAT_SIZE_PX,
  ORIN_PRESENCE_CAT_SIZE_COMPACT_PX,
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

  it('is resident even while idle: the art and the Orin name tag are present, the status text is not, and the old displays never render', () => {
    renderPresence();
    const presence = screen.getByTestId('origin-orin-presence');
    expect(screen.queryByTestId('origin-orin-overlay')).toBeNull();
    expect(screen.queryByTestId('origin-orin-bubble')).toBeNull();
    // 名前は円盤の横の吹き出しタグに出す（2026-11-24 オーナー
    // 指示。2026-11-15 の「姿の下の名前テキストは出さない」は
    // 撤回された）。表記は言語によらず英字「Orin」で常時表示。
    expect(screen.getByTestId('origin-orin-presence-name').textContent).toBe('Orin');
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
    const tap = screen.getByRole('button', { name: 'Orin（いまの作業を表示）' });
    expect(tap.classList.contains('is-idle')).toBe(true);
    expect(tap.classList.contains('is-compact')).toBe(false);
    // 待機中は絵に静かな呼吸が付く。
    expect(cat.classList.contains('origin-cat-breathe')).toBe(true);
  });

  it('shows the same Orin name tag in the English locale (the tag text is always "Orin")', () => {
    renderPresence({ language: 'en' });
    expect(screen.getByTestId('origin-orin-presence-name').textContent).toBe('Orin');
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
    // 名前タグは作業中（48px の縮小状態）でも常に出て読める。
    expect(screen.getByTestId('origin-orin-presence-name').textContent).toBe('Orin');
    // テキストが出ている間はオリンだけの形ではなく、呼吸も付けない。
    const tap = screen.getByRole('button', { name: 'Orin（いまの作業を表示）' });
    expect(tap.classList.contains('is-idle')).toBe(false);
    expect(tap.classList.contains('is-compact')).toBe(true);
    expect(cat.classList.contains('origin-cat-breathe')).toBe(false);
  });

  it('keeps the full idle size: scroll state no longer shrinks the presence (P4, 2026-11-23)', () => {
    renderPresence();
    // P4 改訂：プレゼンスは通常フロー内の行になり、スクロールで
    // 縮むことも薄くなることもなくなった。待機中は常に 72px で、
    // is-compact は付かず、円盤に is-scrolling も付かない。
    const cat = screen.getByTestId('origin-cat-state');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    const tap = screen.getByRole('button', { name: 'Orin（いまの作業を表示）' });
    expect(tap.classList.contains('is-idle')).toBe(true);
    expect(tap.classList.contains('is-compact')).toBe(false);
    expect(cat.parentElement?.classList.contains('is-scrolling')).toBe(false);
  });

  it('keeps the status text visible at the compact size during work', () => {
    renderPresence({ text: '回答を準備しています…', state: 'thinking' });
    // 作業中は、状態テキストは隠さず絵だけが小さい。
    expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('回答を準備しています…');
    expect((screen.getByTestId('origin-cat-state') as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_COMPACT_PX}px`);
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
    const tap = screen.getByRole('button', { name: 'Orin（いまの作業を表示）' });
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
    expect(screen.getAllByRole('button', { name: 'Orin（いまの作業を表示）' })).toHaveLength(1);
    rerender(<OrinFloatingPresence {...props} text="回答を準備しています…" state="thinking" />);
    // 作業中もただ1つ（ヘッダー側の同名ボタンは廃止した）。
    const controls = screen.getAllByRole('button', { name: 'Orin（いまの作業を表示）' });
    expect(controls).toHaveLength(1);
    expect(screen.getByTestId('origin-orin-presence').contains(controls[0])).toBe(true);
    fireEvent.click(controls[0]);
    expect(onOpenWorkSheet).toHaveBeenCalledTimes(1);
  });

  it('pins the presence CSS: frameless fully visible disc at the head of the scroll content, auto-shrink transition, scroller top clearance', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    expect(css).not.toContain('.origin-orin-bubble');
    expect(css).not.toContain('.origin-orin-overlay');
    expect(css).toContain('.origin-orin-presence {');
    expect(css).toContain('.origin-orin-presence__status {');
    // 名前タグ（2026-11-24 オーナー指示で復活）：円盤＋タグの
    // ひとまとまり（__unit）と、吹き出しタグ（__name）が要る。
    // 文字色はロゴ紺のアクセント変数（両テーマ対応）。
    expect(css).toContain('.origin-orin-presence__unit {');
    expect(css).toContain('.origin-orin-presence__name {');
    const nameRule = css.match(/\.origin-orin-presence__name \{[^}]*\}/)?.[0] ?? '';
    expect(nameRule).toContain('color: var(--accent-primary);');
    expect(nameRule).toContain('background: var(--bg-surface);');
    // 旧・濃色ピル（白文字＋強い影＋backdrop blur）は窓方式で廃止した。
    expect(css).not.toContain('.origin-orin-presence__pill');
    // 配置（K-01 改訂、2026-11-24。是正リスト K-01 の選択肢 C）：
    // プレゼンスは浮遊（absolute）でもメイン列の行（P4 形）でも
    // なく、会話スクローラの中の通常フローの行（スクロール内容
    // の先頭）。本文と一緒に流れ去るため、どのスクロール位置
    // でも本文が円盤の下に潜ることは物理的に起きない。列の
    // flex 子ではなくなったため flex: none は持たない。行全体に
    // 広がる容器はタップを通し、タップ対象だけがタップを受け
    // る（従来どおり）。
    const floatRule = css.match(/\.origin-orin-presence \{[^}]*\}/)?.[0] ?? '';
    expect(floatRule).not.toContain('flex: none;');
    expect(floatRule).toContain('display: flex;');
    expect(floatRule).toContain('justify-content: center;');
    expect(floatRule).toContain('pointer-events: none;');
    expect(floatRule).not.toContain('position: absolute');
    expect(floatRule).not.toContain('top: 60px;');
    expect(floatRule).not.toContain('z-index: 30;');
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
    // 円盤のトランジションは transform（タップの手がかり＝
    // ホバー／押下の反応、2026-11-20 外部デザイン評価の回収）
    // だけ。スクロール中フェード（2026-11-20 15:36 の
    // is-scrolling、不透明度0.35）は P4 改訂（2026-11-23）で
    // 廃止した：フロー内の行では本文が下を通らない。
    expect(discRule).toContain('transition: transform 200ms ease-out;');
    expect(css).not.toContain('.origin-orin-presence__disc.is-scrolling');
    expect(css).not.toContain('opacity: 0.35;');
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
    // 会話スクローラ（P4 改訂、2026-11-23／K-01 改訂、
    // 2026-11-24）：プレゼンスがスクロール内容の先頭の行に
    // なったため、円盤を避けるクリアランスは不要。浮遊前提の
    // padding-top 88px／scroll-padding-top 84px は撤去し、
    // scrollIntoView の停止位置に少しだけ余白を残す
    // scroll-padding-top 16px のみ。
    expect(css).toContain('.origin-chat-scroll {');
    expect(css).toContain('scroll-padding-top: 16px;');
    expect(css).not.toContain('padding-top: 88px;');
    expect(css).not.toContain('scroll-padding-top: 84px;');
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
