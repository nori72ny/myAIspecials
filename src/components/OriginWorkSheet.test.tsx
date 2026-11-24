import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OriginWorkSheet, { ORIN_PROFILE_ART_SIZE_PX, type OriginWorkSheetItem } from './OriginWorkSheet';
import { ORIGIN_CAT_NEWYEAR_FULL_SRC, ORIGIN_CAT_NEWYEAR_IDLE_SRC, ORIGIN_CAT_STILL_SRC, ORIGIN_CAT_WINTER_FULL_SRC, ORIGIN_CAT_WINTER_IDLE_SRC } from './OriginCatState';

afterEach(() => {
  cleanup();
});

const renderSheet = (items: readonly OriginWorkSheetItem[], handlers: { onClose?: () => void; onOpenAgent?: () => void } = {}) => render(
  <OriginWorkSheet
    open
    items={items}
    language="ja"
    onClose={handlers.onClose ?? (() => undefined)}
    onOpenAgent={handlers.onOpenAgent}
  />,
);

describe('OriginWorkSheet', () => {
  it('renders nothing while closed', () => {
    render(<OriginWorkSheet open={false} items={[]} language="ja" onClose={() => undefined} />);
    expect(screen.queryByTestId('origin-work-sheet')).toBeNull();
  });

  it('omits the current-work section entirely while idle (2026-11-21 redesign)', () => {
    renderSheet([]);
    const sheet = screen.getByTestId('origin-work-sheet');
    // 待機中は「いまの作業」の節自体を出さない。空状態文
    // （「いまは作業していません」）も廃止した。
    expect(sheet.textContent).not.toContain('いまの作業');
    expect(sheet.textContent).not.toContain('いまは作業していません');
  });

  it('lists work as plain titles with a status and minimal progress only', () => {
    renderSheet([
      { id: 'chat', title: '回答を準備しています', status: 'active', meta: '出典2件' },
      { id: 'last-completed', title: '画像の生成', status: 'done' },
    ]);
    const sheet = screen.getByTestId('origin-work-sheet');
    // 項目がある時だけ「いまの作業」の節が出る。
    expect(sheet.textContent).toContain('いまの作業');
    expect(sheet.textContent).toContain('回答を準備しています');
    expect(sheet.textContent).toContain('出典2件');
    expect(sheet.textContent).toContain('進行中');
    expect(sheet.textContent).toContain('画像の生成');
    expect(sheet.textContent).toContain('完了');
    // 実行中でない項目はボタンにしない。
    expect(within(sheet).queryByTestId('origin-work-sheet-agent-link')).toBeNull();
  });

  it('makes only the running agent item a jump to the agent screen', () => {
    const onClose = vi.fn();
    const onOpenAgent = vi.fn();
    renderSheet([
      { id: 'agent', title: 'ウェブ調査', status: 'active', meta: '1/3', action: 'agent' },
    ], { onClose, onOpenAgent });
    fireEvent.click(screen.getByTestId('origin-work-sheet-agent-link'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenAgent).toHaveBeenCalledTimes(1);
  });

  it('shows the agent plan steps with their statuses under the agent item', () => {
    renderSheet([
      {
        id: 'agent',
        title: '文書を作る',
        status: 'active',
        meta: '2/3',
        action: 'agent',
        steps: [
          { title: 'ウェブで調べる', status: 'completed' },
          { title: '文書を作る', status: 'running' },
          { title: 'テストと動作確認', status: 'queued' },
        ],
      },
    ], { onOpenAgent: vi.fn() });
    const steps = screen.getByTestId('origin-work-sheet-steps');
    expect(steps.textContent).toContain('1.');
    expect(steps.textContent).toContain('ウェブで調べる');
    expect(steps.textContent).toContain('完了');
    expect(steps.textContent).toContain('2.');
    expect(steps.textContent).toContain('文書を作る');
    expect(steps.textContent).toContain('実行中');
    expect(steps.textContent).toContain('3.');
    expect(steps.textContent).toContain('テストと動作確認');
    expect(steps.textContent).toContain('まだ');
    // ステップ列は表示専用で、行自体はボタンにしない（移動は項目の行だけ）。
    expect(within(steps).queryByRole('button')).toBeNull();
  });

  it('shows a stopped step plainly and no step list when the item has none', () => {
    renderSheet([
      {
        id: 'agent',
        title: 'エージェントの作業',
        status: 'done',
        steps: [
          { title: 'ウェブで調べる', status: 'completed' },
          { title: 'ファイルを作る・直す', status: 'failed' },
        ],
      },
    ]);
    const steps = screen.getByTestId('origin-work-sheet-steps');
    expect(steps.textContent).toContain('ファイルを作る・直す');
    expect(steps.textContent).toContain('止まりました');
    // 失敗したステップはドットと状態文に状態色（--danger）が付き、
    // 完了のステップには付かない（K-10：色でも区別できること）。
    const rows = steps.querySelectorAll('li');
    expect(rows[0].innerHTML).not.toContain('--danger');
    expect(rows[1].innerHTML).toContain('bg-[var(--danger)]');
    expect(rows[1].innerHTML).toContain('text-[var(--danger)]');
  });

  it('does not offer the agent jump for a completed agent item', () => {
    renderSheet([
      { id: 'agent', title: 'エージェントの作業', status: 'done', action: 'agent' },
    ], { onOpenAgent: vi.fn() });
    expect(screen.queryByTestId('origin-work-sheet-agent-link')).toBeNull();
  });

  it('shows the Orin profile header above the work list (profile card, 2026-11-15)', () => {
    renderSheet([]);
    const sheet = screen.getByTestId('origin-work-sheet');
    // オリンの姿は常駐と同じ待機の透過絵（台座なし・80px）で、
    // 名前とひとこと紹介が付く。待機姿は季節で差し替わるため、
    // src は待機3種のいずれかであることを確認する。
    const art = within(sheet).getByTestId('origin-cat-state');
    expect(art.tagName).toBe('IMG');
    expect(art.getAttribute('data-state')).toBe('idle');
    expect([ORIGIN_CAT_STILL_SRC.idle, ORIGIN_CAT_WINTER_IDLE_SRC, ORIGIN_CAT_NEWYEAR_IDLE_SRC]).toContain(art.getAttribute('src'));
    expect((art as HTMLElement).style.width).toBe(`${ORIN_PROFILE_ART_SIZE_PX}px`);
    expect(ORIN_PROFILE_ART_SIZE_PX).toBe(80);
    expect(within(sheet).queryByTestId('origin-cat-pedestal')).toBeNull();
    expect(within(sheet).getByTestId('origin-orin-profile-name').textContent).toBe('オリン');
    expect(within(sheet).getByTestId('origin-orin-profile-intro').textContent).toContain('こんにちは、オリンです');
    expect(sheet.getAttribute('aria-label')).toBe('オリンのプロフィール');
  });

  it('returns focus to the Orin tap target when the card closes (2026-11-21 redesign)', () => {
    const orinTap = document.createElement('button');
    orinTap.type = 'button';
    orinTap.className = 'origin-orin-presence__tap';
    document.body.appendChild(orinTap);
    try {
      const sheet = (
        <OriginWorkSheet open items={[]} language="ja" onClose={() => undefined} />
      );
      const { rerender } = render(sheet);
      expect(document.activeElement).not.toBe(orinTap);
      rerender(<OriginWorkSheet open={false} items={[]} language="ja" onClose={() => undefined} />);
      expect(document.activeElement).toBe(orinTap);
    } finally {
      orinTap.remove();
    }
  });

  it('closes from the × button, the backdrop, and the Escape key', () => {
    const onClose = vi.fn();
    renderSheet([], { onClose });
    fireEvent.click(within(screen.getByTestId('origin-work-sheet')).getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('origin-work-sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    // Esc 以外のキーでは閉じない。
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('pins the profile card CSS: one overlay, bottom sheet by default, popover below Orin from 640px', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    expect(css).toContain('.origin-orin-profile {');
    expect(css).toContain('.origin-orin-profile__card {');
    // カードの重なりはプレゼンス（z-15）より上、ヘッダー（z-50）より下。
    expect(css).toContain('z-index: 40;');
    // 狭い画面は下から出るシート（flex-end）のまま。
    expect(css).toContain('align-items: flex-end;');
    // 640px以上は常駐オリンの直下のポップオーバー（2026-11-21
    // 再デザイン）：暗幕なし、幅320px、角丸12px、影1層。
    const mediaStart = css.indexOf('@media (min-width: 640px)', css.indexOf('.origin-orin-profile {'));
    const wide = css.slice(mediaStart, css.indexOf('@keyframes origin-orin-profile-in', mediaStart));
    expect(wide).toContain('align-items: flex-start;');
    expect(wide).toContain('padding: 168px 24px 24px;');
    expect(wide).toContain('.origin-orin-profile__backdrop');
    expect(wide).toContain('background: transparent;');
    expect(wide).toContain('.origin-orin-profile__card');
    expect(wide).toContain('width: 320px;');
    expect(wide).toContain('border-radius: 12px;');
    expect(wide).toContain('box-shadow: 0 12px 32px rgb(15 23 42 / 16%);');
  });
});

describe('OriginWorkSheet seasonal illustration (profile card only, 2026-11-21)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the winter full illustration with its caption in December', () => {
    vi.setSystemTime(new Date(2026, 11, 15, 12, 0));
    renderSheet([]);
    const season = screen.getByTestId('origin-orin-profile-season');
    const art = season.querySelector('img');
    expect(art?.getAttribute('src')).toBe(ORIGIN_CAT_WINTER_FULL_SRC);
    expect(season.textContent).toContain('雪景色のオリン');
  });

  it('shows the New Year full illustration with its caption on January 5', () => {
    vi.setSystemTime(new Date(2027, 0, 5, 12, 0));
    renderSheet([]);
    const season = screen.getByTestId('origin-orin-profile-season');
    const art = season.querySelector('img');
    expect(art?.getAttribute('src')).toBe(ORIGIN_CAT_NEWYEAR_FULL_SRC);
    expect(season.textContent).toContain('お正月のオリン');
  });

  it('shows no seasonal illustration in June', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0));
    renderSheet([]);
    expect(screen.queryByTestId('origin-orin-profile-season')).toBeNull();
  });
});
