// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CodingWorkspaceV31 from '../CodingWorkspaceV31';

vi.mock('../../CodingJobWorkspaceV14', () => ({
  default: ({ initialGoal }: { initialGoal?: string }) => <section aria-label="Coding Job Workspace">Grounded coding runtime{initialGoal ? `: ${initialGoal}` : ''}</section>,
}));

afterEach(() => cleanup());

describe('CodingWorkspaceV31', () => {
  it('passes a supervised goal into the proven coding runtime', () => {
    render(<CodingWorkspaceV31 initialGoal="ログイン処理を修正して" />);
    expect(screen.getByRole('region', { name: 'Coding Job Workspace' }).textContent).toContain('ログイン処理を修正して');
  });

  it('keeps the proven coding runtime as the only primary coding surface', () => {
    render(<CodingWorkspaceV31 />);

    expect(screen.queryByRole('region', { name: 'ORIGIN Coding Workspace' })).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).not.toBeNull();
    expect(screen.queryByText('Grounded execution evidence')).toBeNull();
    expect(screen.queryByText(/Terminal \/ Checkpoint/)).toBeNull();
  });
});
