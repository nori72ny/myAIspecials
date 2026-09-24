// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginWorkspaceShellV31 from '../OriginWorkspaceShellV31';

afterEach(cleanup);

describe('OriginWorkspaceShellV31 focused UX', () => {
  it('shows only four understandable primary modes', () => {
    render(<OriginWorkspaceShellV31 mode="chat" onModeChange={vi.fn()} />);

    const mode = screen.getByRole('navigation', { name: 'Mode' });
    expect(mode.getElementsByTagName('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Chat' }).textContent).toContain('会話');
    expect(screen.getByRole('button', { name: 'Research' }).textContent).toContain('調べる');
    expect(screen.getByRole('button', { name: 'Code' }).textContent).toContain('コード');
    expect(screen.getByRole('button', { name: 'Create' }).textContent).toContain('作る');
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Model')).toBeNull();
    expect(screen.queryByText('Tools')).toBeNull();
    expect(screen.queryByText('Agent')).toBeNull();
  });

  it('keeps project details closed until explicitly requested', () => {
    const onProjectToggle = vi.fn();
    render(<OriginWorkspaceShellV31 mode="coding" onModeChange={vi.fn()} projectOpen={false} onProjectToggle={onProjectToggle} />);

    const details = screen.getByRole('button', { name: '詳細を開く' });
    expect(details.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(details);
    expect(onProjectToggle).toHaveBeenCalledOnce();
  });
});
