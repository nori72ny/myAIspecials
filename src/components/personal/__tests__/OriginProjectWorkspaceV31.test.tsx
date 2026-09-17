// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginProjectWorkspaceV31 from '../OriginProjectWorkspaceV31';

afterEach(cleanup);

describe('OriginProjectWorkspaceV31', () => {
  it('shows only grounded counts and keeps unavailable views disabled', () => {
    render(<OriginProjectWorkspaceV31
      mode="chat"
      messages={[{ id: 'm1', role: 'user', content: 'hello' }]}
      sessions={[]}
      artifacts={[]}
      activeView="overview"
      onViewChange={() => undefined}
    />);

    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Project Files unavailable' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Project Tasks unavailable' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Project Sources unavailable' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Project Artifacts unavailable' }).hasAttribute('disabled')).toBe(true);
  });

  it('allows artifact navigation only when a real artifact exists', () => {
    const onViewChange = vi.fn();
    render(<OriginProjectWorkspaceV31
      mode="chat"
      messages={[]}
      sessions={[]}
      artifacts={[{ id: 'a1', type: 'markdown', title: 'Report', language: 'markdown', content: '# Report', isComplete: true }]}
      activeView="overview"
      onViewChange={onViewChange}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Project Artifacts' }));
    expect(onViewChange).toHaveBeenCalledWith('artifacts');
  });

  it('does not mutate Mode when project views change', () => {
    const onViewChange = vi.fn();
    render(<OriginProjectWorkspaceV31
      mode="research"
      messages={[]}
      sessions={[]}
      artifacts={[]}
      activeView="overview"
      onViewChange={onViewChange}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Project Chat' }));
    expect(onViewChange).toHaveBeenCalledWith('chat');
    expect(screen.getByText('Research')).toBeTruthy();
  });
});
