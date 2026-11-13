import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginWorkSheet, { type OriginWorkSheetItem } from './OriginWorkSheet';

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

  it('does not offer the agent jump for a completed agent item', () => {
    renderSheet([
      { id: 'agent', title: 'エージェントの作業', status: 'done', action: 'agent' },
    ], { onOpenAgent: vi.fn() });
    expect(screen.queryByTestId('origin-work-sheet-agent-link')).toBeNull();
  });
});
