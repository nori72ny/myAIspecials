// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginWorkspaceShellV31 from '../OriginWorkspaceShellV31';

afterEach(cleanup);

describe('OriginWorkspaceShellV31 conversation-first UX', () => {
  it('keeps Chat free of a persistent top Mode row', () => {
    render(<OriginWorkspaceShellV31 mode="chat" onModeChange={vi.fn()} />);

    expect(screen.queryByLabelText('Workspace mode')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Mode' })).toBeNull();
    expect(screen.getByLabelText('ORIGIN Auto settings')).toBeTruthy();
    expect(screen.getByLabelText('Model ORIGIN Auto').textContent).toContain('ORIGIN Auto');
    expect(screen.getByLabelText('Tools capability').textContent).toContain('Files');
    expect(screen.getByLabelText('Agent runtime evidence policy').textContent).toContain('実行時のみ状態表示');
  });

  it('keeps non-Chat mode controls out of the product header', () => {
    render(<OriginWorkspaceShellV31 mode="coding" onModeChange={vi.fn()} />);
    expect(screen.queryByLabelText('Workspace mode')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByLabelText('ORIGIN Auto settings')).toBeTruthy();
  });
});
