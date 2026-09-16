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
    const plan = within(steps).getByText('Plan').closest('li');
    const execute = within(steps).getByText('Execute').closest('li');
    const test = within(steps).getByText('Test').closest('li');
    expect(plan?.textContent).toContain('完了');
    expect(execute?.getAttribute('aria-current')).toBe('step');
    expect(execute?.textContent).toContain('進行中');
    expect(test?.textContent).toContain('待機');
    expect(screen.queryByText(/進捗率・残り時間・内部思考は推測しません/)).not.toBeNull();
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

    const stopButtons = screen.getAllByRole('button', { name: 'Stop' });
    expect(stopButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(stopButtons[0]);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('disables repeated stop while cancellation confirmation is pending', () => {
    render(<OriginAgentActionProgressV31 status="running" cancelRequested onStop={() => undefined} />);

    expect(screen.getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true);
    expect(screen.queryByText(/server側の停止確認を待っています/)).not.toBeNull();
  });
});
