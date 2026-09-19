// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginWorkspaceShellV31 from '../OriginWorkspaceShellV31';

afterEach(cleanup);

describe('OriginWorkspaceShellV31 mobile UX', () => {
  it('provides one compact mobile controls disclosure while preserving Mode separation', () => {
    render(<OriginWorkspaceShellV31 mode="chat" onModeChange={vi.fn()} />);

    const mobileControls = screen.getByLabelText('ORIGIN mobile controls');
    expect(mobileControls).toBeTruthy();
    expect(mobileControls.textContent).toContain('Model');
    expect(mobileControls.textContent).toContain('ORIGIN Auto');
    expect(mobileControls.textContent).toContain('Tools');
    expect(mobileControls.textContent).toContain('自動管理');
    expect(mobileControls.textContent).toContain('Agent');
    expect(mobileControls.textContent).toContain('通常応答');
    expect(screen.getByRole('navigation', { name: 'Mode' })).toBeTruthy();
  });

  it('reflects Code agent capability without changing Model or Tools semantics', () => {
    render(<OriginWorkspaceShellV31 mode="coding" onModeChange={vi.fn()} />);

    const mobileControls = screen.getByLabelText('ORIGIN mobile controls');
    expect(mobileControls.textContent).toContain('ORIGIN Auto');
    expect(mobileControls.textContent).toContain('自動管理');
    expect(mobileControls.textContent).toContain('実行可能');
  });
});
