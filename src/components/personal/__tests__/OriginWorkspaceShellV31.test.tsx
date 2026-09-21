// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginWorkspaceShellV31 from '../OriginWorkspaceShellV31';

afterEach(cleanup);

describe('OriginWorkspaceShellV31 mobile UX', () => {
  it('provides one compact mobile Mode selector plus progressive ORIGIN Auto settings', () => {
    render(<OriginWorkspaceShellV31 mode="chat" onModeChange={vi.fn()} />);

    const mode = screen.getByLabelText('Mode') as HTMLSelectElement;
    expect(mode.value).toBe('chat');
    expect(Array.from(mode.options).map((option) => option.textContent)).toEqual(['Chat', 'Research', 'Code', 'Create']);
    expect(screen.getByLabelText('ORIGIN Auto settings')).toBeTruthy();
    expect(screen.getByLabelText('Model ORIGIN Auto').textContent).toContain('ORIGIN Auto');
    expect(screen.getByLabelText('Tools 自動管理').textContent).toContain('自動管理');
    expect(screen.getByLabelText('Agent 通常応答').textContent).toContain('通常応答');
  });

  it('reflects Code agent capability without changing Model or Tools semantics', () => {
    render(<OriginWorkspaceShellV31 mode="coding" onModeChange={vi.fn()} />);

    expect((screen.getByLabelText('Mode') as HTMLSelectElement).value).toBe('coding');
    expect(screen.getByLabelText('Model ORIGIN Auto').textContent).toContain('ORIGIN Auto');
    expect(screen.getByLabelText('Tools 自動管理').textContent).toContain('自動管理');
    expect(screen.getByLabelText('Agent 実行可能').textContent).toContain('実行可能');
  });
});
