// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginAgentActionProgressV31, { projectAgentActionStateV31 } from '../OriginAgentActionProgressV31';

afterEach(() => cleanup());

describe('OriginAgentActionProgressV31', () => {
  it('keeps every action pending before a real job exists without rendering empty workflow UI', () => {
    expect(projectAgentActionStateV31(null)).toEqual([
      { id: 'plan', state: 'pending' },
      { id: 'execute', state: 'pending' },
      { id: 'test', state: 'pending' },
      { id: 'verify', state: 'pending' },
      { id: 'deliver', state: 'pending' },
    ]);

    render(<OriginAgentActionProgressV31 status={null} />);
    expect(screen.queryByText('実行状況')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Agent action steps' })).toBeNull();
  });

  it('shows a compact running state and keeps step internals under details', () => {
    render(<OriginAgentActionProgressV31 status="running" onStop={() => undefined} />);

    expect(screen.getByText('実行中')).toBeTruthy();
    expect(screen.getByText('コードを確認・変更しています。')).toBeTruthy();
    expect(screen.getByText('実行詳細')).toBeTruthy();

    const steps = screen.getByRole('list', { name: 'Agent action steps' });
    const plan = within(steps).getByText('Plan').closest('li');
    const execute = within(steps).getByText('Execute').closest('li');
    expect(plan?.textContent).toContain('完了');
    expect(execute?.getAttribute('aria-current')).toBe('step');
    expect(execute?.textContent).toContain('進行中');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('does not claim completed actions after an ambiguous terminal failure', () => {
    render(<OriginAgentActionProgressV31 status="failed" />);

    const steps = screen.getByRole('list', { name: 'Agent action steps' });
    expect(within(steps).getAllByText('未確定')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('routes Stop through the supplied real cancellation callback', () => {
    const onStop = vi.fn();
    render(<OriginAgentActionProgressV31 status="repairing" onStop={onStop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('disables repeated stop while cancellation confirmation is pending', () => {
    render(<OriginAgentActionProgressV31 status="running" cancelRequested onStop={() => undefined} />);

    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/停止要求を送信しました/)).not.toBeNull();
  });

  it('does not pin a permanent mobile status bar over the workspace', () => {
    render(<OriginAgentActionProgressV31 status="running" onStop={() => undefined} />);
    expect(screen.queryByLabelText('Agent mobile controls')).toBeNull();
  });
});
