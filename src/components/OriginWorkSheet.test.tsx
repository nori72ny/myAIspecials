import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginWorkSheet, { ORIN_PROFILE_ART_SIZE_PX, type OriginWorkSheetItem } from './OriginWorkSheet';
import { ORIGIN_CAT_STILL_SRC } from './OriginCatState';

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

  it('says nothing is in progress when there are no items', () => {
    renderSheet([]);
    const sheet = screen.getByTestId('origin-work-sheet');
    expect(sheet.textContent).toContain('いまは作業していません');
  });

  it('lists work as plain titles with a status and minimal progress only', () => {
    renderSheet([
      { id: 'chat', title: '回答を準備しています', status: 'active', meta: '出典2件' },
      { id: 'last-completed', title: '画像の生成', status: 'done' },
    ]);
    const sheet = screen.getByTestId('origin-work-sheet');
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
    // 大きなオリンは待機の静止画で、名前とひとこと紹介が付く。
    const art = within(sheet).getByTestId('origin-cat-state');
    expect(art.tagName).toBe('IMG');
    expect(art.getAttribute('data-state')).toBe('waiting');
    expect(art.getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC.waiting);
    expect((art as HTMLElement).style.width).toBe(`${ORIN_PROFILE_ART_SIZE_PX}px`);
    expect(within(sheet).getByTestId('origin-orin-profile-name').textContent).toBe('オリン');
    expect(within(sheet).getByTestId('origin-orin-profile-intro').textContent).toContain('こんにちは、オリンです');
    // 「いまの作業」の見出しはプロフィールの下に残る。
    expect(sheet.textContent).toContain('いまの作業');
    expect(sheet.getAttribute('aria-label')).toBe('オリンのプロフィール');
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

  it('pins the profile card CSS: one overlay, bottom sheet by default, centered card from 640px', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    expect(css).toContain('.origin-orin-profile {');
    expect(css).toContain('.origin-orin-profile__card {');
    // カードの重なりはプレゼンス（z-15）より上、ヘッダー（z-50）より下。
    expect(css).toContain('z-index: 40;');
    // 狭い画面は下から出るシート（flex-end）、640px以上は中央カード。
    expect(css).toContain('align-items: flex-end;');
    const wide = css.slice(css.indexOf('@media (min-width: 640px)', css.indexOf('.origin-orin-profile {')));
    expect(wide).toContain('.origin-orin-profile__card');
    expect(wide).toContain('border-radius: 24px;');
  });
});
