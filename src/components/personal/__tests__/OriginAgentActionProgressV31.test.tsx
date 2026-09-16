// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginAgentActionProgressV31, { projectAgentActionStateV31 } from '../OriginAgentActionProgressV31';

afterEach(() => cleanup());

describe('OriginAgentActionProgressV31', () => {
  it('keeps every action pending before a real job exists', () => {
    expect(projectAgentActionStateV31(null)).toEqual([
      { id: 'plan', state: 'pending' },
      { id: 'execute', state: 'pending' },
      { id: 'test', state: 'pending' },
      { id: 'verify', state: 'pending' },
      { id: 'deliver', state: 'pending' },
    ]);
  });

  it('projects running status without inventing percentage or ETA', () => {
    render(<OriginAgentActionProgressV31 status="running" onStop={() => undefined} />);

    const steps = screen.getByRole('list', { name: 'Agent action steps' });
    expect(within(steps).getByText('Plan').closest('li')).toHaveTextContent('完了');
    expect(within(steps).getByText('Execute').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(steps).getByText('Execute').closest('li')).toHaveTextContent('進行中');
    expect(within(steps).getByText('Test').closest('li')).toHaveTextContent('待機');
    expect(screen.getByText(/進捗率・残り時間・内部思考は推測しません/)).toBeInTheDocument();
  });

  it('does not claim completed actions after an ambiguous terminal failure', () => {
    render(<OriginAgentActionProgressV31 status="failed" />);

    const steps = screen.getByRole('list', { name: 'Agent action steps' });
    expect(within(steps).getAllByText('未確定')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('routes Stop through the supplied real cancellation callback', () => {
    const onStop = vi.fn();
    render(<OriginAgentActionProgressV31 status="repairing" onStop={onStop} />);

    const stopButtons = screen.getAllByRole('button', { name: 'Stop' });
    expect(stopButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(stopButtons[0]);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('disables repeated stop while cancellation confirmation is pending', () => {
    render(<OriginAgentActionProgressV31 status="running" cancelRequested onStop={() => undefined} />);

    expect(screen.getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true);
    expect(screen.getByText(/server側の停止確認を待っています/)).toBeInTheDocument();
  });
});
