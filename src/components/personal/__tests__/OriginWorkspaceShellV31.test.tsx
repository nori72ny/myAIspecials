// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByLabelText('Tools 自動管理').textContent).toContain('自動管理');
    expect(screen.getByLabelText('Agent 通常応答').textContent).toContain('通常応答');
  });

  it('shows one compact workspace selector outside Chat so users can return to Chat', () => {
    const onModeChange = vi.fn();
    render(<OriginWorkspaceShellV31 mode="coding" onModeChange={onModeChange} />);

    const selector = screen.getByLabelText('Workspace mode') as HTMLSelectElement;
    expect(selector.value).toBe('coding');
    expect(Array.from(selector.options).map((option) => option.textContent)).toEqual(['Chat', 'Research', 'Code', 'Create']);
    fireEvent.change(selector, { target: { value: 'chat' } });
    expect(onModeChange).toHaveBeenCalledWith('chat');
    expect(screen.getByLabelText('Agent 実行可能').textContent).toContain('実行可能');
  });
});
