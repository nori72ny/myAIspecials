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
      sources={[]}
      codingEvidence={{ jobId: null, status: null, changedPaths: [], verificationChecks: [] }}
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
      sources={[]}
      codingEvidence={{ jobId: null, status: null, changedPaths: [], verificationChecks: [] }}
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
      sources={[]}
      codingEvidence={{ jobId: null, status: null, changedPaths: [], verificationChecks: [] }}
      activeView="overview"
      onViewChange={onViewChange}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Project Chat' }));
    expect(onViewChange).toHaveBeenCalledWith('chat');
    expect(screen.getByText('Research')).toBeTruthy();
  });

  it('enables Sources only from validated research evidence', () => {
    render(<OriginProjectWorkspaceV31
      mode="research"
      messages={[]}
      sessions={[]}
      artifacts={[]}
      sources={[{
        id: 'S1',
        title: 'Verified source',
        url: 'https://example.com/source',
        domain: 'example.com',
        evidenceLevel: 'page-verified',
        freshness: 'recent',
        score: 90,
        scoreScope: 'retrieval-evidence-only',
        citation: '[S1]',
      }]}
      codingEvidence={{ jobId: null, status: null, changedPaths: [], verificationChecks: [] }}
      activeView="sources"
      onViewChange={() => undefined}
    />);

    expect(screen.getByRole('button', { name: 'Project Sources' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('region', { name: 'Project Sources' }).textContent).toContain('Verified source');
    expect(screen.getByRole('region', { name: 'Project Sources' }).textContent).toContain('example.com');
  });

  it('enables Files and Tasks only from real coding evidence', () => {
    const evidence = {
      jobId: 'coding-abcdefghijklmnopqrstuv',
      status: 'verified' as const,
      changedPaths: ['src/a.ts', 'src/b.ts'],
      verificationChecks: [{ kind: 'test' as const, ok: true, exitCode: 0, timedOut: false, attempt: 1 }],
    };

    const { rerender } = render(<OriginProjectWorkspaceV31
      mode="coding"
      messages={[]}
      sessions={[]}
      artifacts={[]}
      sources={[]}
      codingEvidence={evidence}
      activeView="files"
      onViewChange={() => undefined}
    />);

    expect(screen.getByRole('button', { name: 'Project Files' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('region', { name: 'Project Files' }).textContent).toContain('src/a.ts');

    rerender(<OriginProjectWorkspaceV31
      mode="coding"
      messages={[]}
      sessions={[]}
      artifacts={[]}
      sources={[]}
      codingEvidence={evidence}
      activeView="tasks"
      onViewChange={() => undefined}
    />);

    expect(screen.getByRole('button', { name: 'Project Tasks' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('region', { name: 'Project Tasks' }).textContent).toContain('verified');
    expect(screen.getByRole('region', { name: 'Project Tasks' }).textContent).toContain('test');
  });
});
