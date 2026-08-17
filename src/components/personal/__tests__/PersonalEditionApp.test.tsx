import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

describe('PersonalEditionApp for ORIGIN Personal 2.0', () => {
  it('renders the Personal 2.0 core identity and all four starter cards', () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);

    expect(screen.getAllByText('ORIGIN', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText('Personal 2.0', { exact: true })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '何を実現したいですか？' })).toBeTruthy();
    expect(screen.getByTestId('origin-home-request')).toBeTruthy();
    expect(screen.getByTestId('starter-0').textContent).toContain('整理する');
    expect(screen.getByTestId('starter-1').textContent).toContain('比較する');
    expect(screen.getByTestId('starter-2').textContent).toContain('文章にする');
    expect(screen.getByTestId('starter-3').textContent).toContain('計画する');
  });

  it('preserves the production settings handoff', () => {
    const onOpenSettings = vi.fn();
    render(
      <PersonalEditionApp
        settings={DEFAULT_PERSONAL_SETTINGS}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '設定を開く' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
