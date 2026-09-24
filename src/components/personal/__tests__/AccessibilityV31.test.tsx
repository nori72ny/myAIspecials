// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginProjectWorkspaceV31 from '../OriginProjectWorkspaceV31';

afterEach(cleanup);

describe('ORIGIN accessibility foundations', () => {
  it('keeps the mobile project selector at the minimum interactive target size', () => {
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
    const selector = screen.getByLabelText('Project view');
    expect(selector.classList.contains('origin-interactive-target')).toBe(true);
  });

  it('does not expose unavailable project views as disabled navigation', () => {
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
    expect(screen.queryByRole('button', { name: 'Project Files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project Tasks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Project Sources' })).toBeNull();
  });
});
