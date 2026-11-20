import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrinFloatingPresence, {
  ORIN_PRESENCE_FADE_MS,
  ORIN_PRESENCE_CAT_SIZE_PX,
  ORIN_PRESENCE_CAT_SIZE_COMPACT_PX,
  ORIN_PRESENCE_SCROLL_SHRINK_THRESHOLD_PX,
  resolveOrinAgentBubbleText,
  resolveOrinBubbleText,
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

describe('Orin presence (2026-11-14 08:59 revision, frameless peeking form + floating auto-shrink 2026-11-20)', () => {
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
    // 円盤は「穴」質感のラッパー（__disc）に包まれる。
    expect(within(presence).queryByTestId('origin-cat-pedestal')).toBeNull();
    // 円盤の中のオリン：通常時（待機・未スクロール）は絵56px。
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('IMG');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    expect((cat as HTMLElement).style.height).toBe(`${ORIN_PRESENCE_CAT_SIZE_PX}px`);
    expect(ORIN_PRESENCE_CAT_SIZE_PX).toBe(56);
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

  it('shows the status text beside the disc while working, and shrinks the art to the compact size (2026-11-20 10:10 auto-shrink)', () => {
    const { props, rerender } = renderPresence();
    const idleCat = screen.getByTestId('origin-cat-state');
    expect((idleCat as HTMLElement).style.width).toBe('56px');
    rerender(<OrinFloatingPresence {...props} text="回答を準備しています…" state="thinking" />);
    // 状態テキストは段階文をそのまま円盤の右側に出す。
    expect(screen.getByTestId('origin-orin-presence-status').textContent).toBe('回答を準備しています…');
    // 作業中は自動縮小が発火し、絵は36pxになる（テキストは常に見える）。
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat).toBe(idleCat);
    expect(ORIN_PRESENCE_CAT_SIZE_COMPACT_PX).toBe(36);
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
    // スクロール中は待機でも自動縮小：絵36px、テキストは出ず、
    // オリンだけの小さい形（is-idle かつ is-compact）。
    const cat = screen.getByTestId('origin-cat-state');
    expect((cat as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_COMPACT_PX}px`);
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    const tap = screen.getByRole('button', { name: 'いまの作業を表示' });
    expect(tap.classList.contains('is-idle')).toBe(true);
    expect(tap.classList.contains('is-compact')).toBe(true);
    // 先頭に戻ると通常の56pxに戻る。
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

  it('pins the scroll-shrink threshold the App side uses', () => {
    expect(ORIN_PRESENCE_SCROLL_SHRINK_THRESHOLD_PX).toBe(40);
  });

  it('moves while working: the working state uses the motion video asset', () => {
    renderPresence({ text: '描いています', state: 'working' });
    const cat = screen.getByTestId('origin-cat-state');
    expect(cat.tagName).toBe('VIDEO');
    expect(cat.getAttribute('data-state')).toBe('working');
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
    // テキスト表示中は自動縮小で36px。
    expect((screen.getByTestId('origin-cat-state') as HTMLElement).style.width).toBe(`${ORIN_PRESENCE_CAT_SIZE_COMPACT_PX}px`);
    rerender(<OrinFloatingPresence {...props} text={null} state="idle" />);
    // フェードアウトの間テキストは残り、尺が過ぎたらテキストだけが消える。
    expect(screen.queryByTestId('origin-orin-presence-status')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(ORIN_PRESENCE_FADE_MS); });
    expect(screen.queryByTestId('origin-orin-presence-status')).toBeNull();
    // 姿は残り、絵は通常の56pxに戻る。オリンだけの形に戻り、
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

  it('pins the presence CSS: frameless peeking disc over the scroller, auto-shrink transition, scroller top clearance', () => {
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
    // 覗き配置（2026-11-20 12:06）：top は 46px。ヘッダー 60px ＋
    // タップのパディング 4px を引くと、円盤の上端はヘッダー下端
    // から 10px 上に来て、円盤の上部がヘッダー（z-50）の裏に
    // 隠れる。プレゼンスの z-index は 30 のまま。
    const floatRule = css.match(/\.origin-orin-presence \{[^}]*\}/)?.[0] ?? '';
    expect(floatRule).toContain('position: absolute;');
    expect(floatRule).toContain('top: 46px;');
    expect(floatRule).toContain('z-index: 30;');
    expect(floatRule).toContain('display: flex;');
    expect(floatRule).toContain('justify-content: center;');
    expect(floatRule).toContain('pointer-events: none;');
    expect(floatRule).not.toContain('position: fixed');
    // 枠なし（2026-11-20 12:06 オーナー指示）：タップ対象は窓
    // パネルだったものをやめ、border・背景・影・パネル角丸を
    // 全て撤去した。残るのはレイアウトとタップ受けだけ。
    const tapRule = css.match(/\.origin-orin-presence__tap \{[^}]*\}/)?.[0] ?? '';
    expect(tapRule).toContain('border: none;');
    expect(tapRule).toContain('background: transparent;');
    expect(tapRule).toContain('box-shadow: none;');
    expect(tapRule).toContain('padding: 4px;');
    expect(tapRule).toContain('pointer-events: auto;');
    expect(tapRule).not.toContain('var(--bg-surface)');
    expect(tapRule).not.toContain('var(--radius-panel)');
    expect(tapRule).not.toContain('var(--shadow-1)');
    expect(tapRule).not.toContain('position: fixed');
    // 円盤の「穴」質感：ラッパーには柔らかい落影だけ、内側の
    // 窪みの影は ::after の inset 影で付ける（枠線は付けない）。
    // ::after はタップを妨げない。
    const discRule = css.match(/\.origin-orin-presence__disc \{[^}]*\}/)?.[0] ?? '';
    expect(discRule).toContain('position: relative;');
    expect(discRule).toContain('border-radius: 50%;');
    expect(discRule).toContain('box-shadow: 0 2px 8px rgba(24, 35, 59, 0.10);');
    const discAfterRule = css.match(/\.origin-orin-presence__disc::after \{[^}]*\}/)?.[0] ?? '';
    expect(discAfterRule).toContain('position: absolute;');
    expect(discAfterRule).toContain('inset: 0;');
    expect(discAfterRule).toContain('border-radius: 50%;');
    expect(discAfterRule).toContain('pointer-events: none;');
    expect(discAfterRule).toContain('box-shadow: inset 0 2px 5px rgba(24, 35, 59, 0.28), inset 0 -1px 2px rgba(24, 35, 59, 0.12);');
    // 作業コメントは枠なしテキスト：背景・枠を持たず、
    // キャンバス色（--bg-primary）のハローで読めるようにする。
    const statusRule = css.match(/\.origin-orin-presence__status \{[^}]*\}/)?.[0] ?? '';
    expect(statusRule).toContain('text-shadow:');
    expect(statusRule).toContain('var(--bg-primary)');
    expect(statusRule).not.toContain('background:');
    // 自動縮小のトランジション：絵の寸法変化は約200ms、
    // reduced-motion では即時（既存の media 規則側で無効化）。
    expect(css).toContain('transition: width 200ms ease-out, height 200ms ease-out;');
    // 会話スクローラ：先頭行が円盤の下端（ヘッダー下端から
    // 46px）より下に来るよう padding-top を 64px に詰め、
    // scroll-padding-top は 52px。スクロールした内容は円盤の
    // 下を通過できる（パディングはスクロール領域の一部）。
    expect(css).toContain('.origin-chat-scroll {');
    expect(css).toContain('padding-top: 64px;');
    expect(css).toContain('scroll-padding-top: 52px;');
    expect(css).not.toContain('padding-top: 82px;');
    expect(css).not.toContain('scroll-padding-top: 64px;');
    expect(css).not.toContain('scroll-padding-top: 96px;');
    // 固定配置前提の会話クリアランス（131px）は撤去した。
    expect(css).not.toContain('padding-top: 131px !important;');
  });
});
