// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(screen.queryByText('実行詳細')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Agent action steps' })).toBeNull();
  });

  it('keeps workflow stages inside one progressive-disclosure control', () => {
    render(<OriginAgentActionProgressV31 status="running" />);

    expect(screen.getByText('実行詳細')).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Agent action steps' });
    const plan = within(steps).getByText('Plan').closest('li');
    const execute = within(steps).getByText('Execute').closest('li');
    const test = within(steps).getByText('Test').closest('li');
    expect(plan?.textContent).toContain('完了');
    expect(execute?.getAttribute('aria-current')).toBe('step');
    expect(execute?.textContent).toContain('進行中');
    expect(test?.textContent).toContain('待機');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not claim completed actions after an ambiguous terminal failure', () => {
    render(<OriginAgentActionProgressV31 status="failed" />);

    const steps = screen.getByRole('list', { name: 'Agent action steps' });
    expect(within(steps).getAllByText('未確定')).toHaveLength(5);
  });

  it('does not pin a permanent mobile status bar over the workspace', () => {
    render(<OriginAgentActionProgressV31 status="running" />);
    expect(screen.queryByLabelText('Agent mobile controls')).toBeNull();
  });
});
