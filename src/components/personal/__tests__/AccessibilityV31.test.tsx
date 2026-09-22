// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginProjectNavigationV31 from '../OriginProjectNavigationV31';
import OriginComposerModeControlV31 from '../OriginComposerModeControlV31';
import OriginWorkspaceShellV31 from '../OriginWorkspaceShellV31';

afterEach(cleanup);

describe('ORIGIN accessibility foundations', () => {
  it('keeps contextual Project actions at the minimum interactive target size without permanent top chrome', () => {
    render(<OriginProjectNavigationV31
      sources={[]}
      codingEvidence={{ jobId: 'coding-abcdefghijklmnopqrstuv', status: 'verified', changedPaths: ['src/a.ts'], verificationChecks: [] }}
      onViewChange={vi.fn()}
    />);
    const files = screen.getByRole('button', { name: /Files/ });
    const tasks = screen.getByRole('button', { name: /Tasks/ });
    expect(files.classList.contains('min-h-11')).toBe(true);
    expect(tasks.classList.contains('min-h-11')).toBe(true);
  });

  it('keeps progressive system settings keyboard-focusable without restoring the Chat top Mode row', () => {
    const { rerender } = render(<OriginWorkspaceShellV31 mode="chat" onModeChange={vi.fn()} />);
    expect(screen.queryByLabelText('Workspace mode')).toBeNull();
    expect(screen.getByLabelText('ORIGIN Auto settings')).toBeTruthy();

    rerender(<><OriginWorkspaceShellV31 mode="research" onModeChange={vi.fn()} /><OriginComposerModeControlV31 mode="research" onModeChange={vi.fn()} /></>);
    const selector = screen.getByLabelText('Workspace mode');
    expect(selector.classList.contains('min-h-11')).toBe(true);
  });
});
