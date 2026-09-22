// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginProjectWorkspaceV31 from '../OriginProjectWorkspaceV31';
import OriginWorkspaceShellV31 from '../OriginWorkspaceShellV31';

afterEach(cleanup);

describe('ORIGIN accessibility foundations', () => {
  it('keeps the progressive Project control at the minimum interactive target size', () => {
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
    const selector = screen.getByLabelText('Project context');
    expect(selector.classList.contains('min-h-11')).toBe(true);
  });

  it('keeps progressive system settings keyboard-focusable without restoring the Chat top Mode row', () => {
    const { rerender } = render(<OriginWorkspaceShellV31 mode="chat" onModeChange={vi.fn()} />);
    expect(screen.queryByLabelText('Workspace mode')).toBeNull();
    expect(screen.getByLabelText('ORIGIN Auto settings')).toBeTruthy();

    rerender(<OriginWorkspaceShellV31 mode="research" onModeChange={vi.fn()} />);
    const selector = screen.getByLabelText('Workspace mode');
    expect(selector.classList.contains('min-h-11')).toBe(true);
  });
});
