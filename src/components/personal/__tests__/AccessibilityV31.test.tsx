// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginProjectWorkspaceV31 from '../OriginProjectWorkspaceV31';
import OriginWorkspaceShellV31 from '../OriginWorkspaceShellV31';

afterEach(cleanup);

describe('ORIGIN accessibility foundations', () => {
  it('keeps the mobile project selector at the minimum interactive target size', () => {
    render(<OriginProjectWorkspaceV31
      mode="chat"
      messages={[]}
      sessions={[]}
      artifacts={[]}
      sources={[]}
      codingEvidence={{ jobId: null, status: null, changedPaths: [], verificationChecks: [] }}
      activeView="overview"
      onViewChange={vi.fn()}
    />);
    const selector = screen.getByLabelText('Project view');
    expect(selector.classList.contains('origin-interactive-target')).toBe(true);
  });

  it('keeps the focused mode controls keyboard-focusable and semantic', () => {
    render(<OriginWorkspaceShellV31 mode="chat" onModeChange={vi.fn()} onProjectToggle={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '詳細を開く' })).toBeTruthy();
  });
});
