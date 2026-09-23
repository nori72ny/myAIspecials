// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginProjectNavigationV31 from '../OriginProjectNavigationV31';

afterEach(cleanup);

describe('OriginProjectNavigationV31', () => {
  it('renders nothing when Project has no grounded evidence', () => {
    const { container } = render(<OriginProjectNavigationV31
      sources={[]}
      codingEvidence={{ jobId: null, status: null, changedPaths: [], verificationChecks: [] }}
      onViewChange={vi.fn()}
    />);
    expect(container.textContent).toBe('');
  });

  it('shows only grounded Files, Tasks, and Sources actions', () => {
    const onViewChange = vi.fn();
    render(<OriginProjectNavigationV31
      sources={[{
        id: 'S1', title: 'Source', url: 'https://example.com', domain: 'example.com', evidenceLevel: 'page-verified', freshness: 'recent', score: 90, scoreScope: 'retrieval-evidence-only', citation: '[S1]',
      }]}
      codingEvidence={{ jobId: 'coding-abcdefghijklmnopqrstuv', status: 'verified', changedPaths: ['src/a.ts'], verificationChecks: [] }}
      onViewChange={onViewChange}
    />);

    const project = screen.getByRole('region', { name: 'Project navigation' });
    expect(project.textContent).toContain('Files');
    expect(project.textContent).toContain('Tasks');
    expect(project.textContent).toContain('Sources');
    expect(project.textContent).not.toContain('Overview');
    expect(project.textContent).not.toContain('Chat');
    expect(project.textContent).not.toContain('Artifacts');

    fireEvent.click(screen.getByRole('button', { name: /Files/ }));
    fireEvent.click(screen.getByRole('button', { name: /Tasks/ }));
    fireEvent.click(screen.getByRole('button', { name: /Sources/ }));
    expect(onViewChange.mock.calls.map(([view]) => view)).toEqual(['files', 'tasks', 'sources']);
  });
});
