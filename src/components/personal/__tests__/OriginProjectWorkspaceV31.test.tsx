// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OriginProjectWorkspaceV31 from '../OriginProjectWorkspaceV31';

const emptyEvidence = { jobId: null, status: null, changedPaths: [], verificationChecks: [] };
const baseProps = {
  mode: 'chat' as const,
  messages: [],
  sessions: [],
  artifacts: [],
  sources: [],
  codingEvidence: emptyEvidence,
  onViewChange: () => undefined,
};

afterEach(cleanup);

describe('OriginProjectWorkspaceV31', () => {
  it('renders no permanent Project chrome for an empty or normal Chat view', () => {
    const { rerender } = render(<OriginProjectWorkspaceV31 {...baseProps} activeView="overview" />);
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
    expect(screen.queryByText('Current workspace')).toBeNull();
    expect(screen.queryByText('Grounded state only')).toBeNull();

    rerender(<OriginProjectWorkspaceV31 {...baseProps} activeView="chat" />);
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
  });

  it('does not render an empty Files, Tasks, or Sources surface without evidence', () => {
    const { rerender } = render(<OriginProjectWorkspaceV31 {...baseProps} activeView="files" />);
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();

    rerender(<OriginProjectWorkspaceV31 {...baseProps} activeView="tasks" />);
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();

    rerender(<OriginProjectWorkspaceV31 {...baseProps} activeView="sources" />);
    expect(screen.queryByRole('region', { name: 'Project Workspace' })).toBeNull();
  });

  it('renders Sources only when validated research evidence exists and is selected', () => {
    render(<OriginProjectWorkspaceV31
      {...baseProps}
      mode="research"
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
      activeView="sources"
    />);

    expect(screen.getByRole('region', { name: 'Project Workspace' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Project Sources' }).textContent).toContain('Verified source');
    expect(screen.getByRole('region', { name: 'Project Sources' }).textContent).toContain('example.com');
  });

  it('renders Files and Tasks only from real coding evidence and only when selected', () => {
    const evidence = {
      jobId: 'coding-abcdefghijklmnopqrstuv',
      status: 'verified' as const,
      changedPaths: ['src/a.ts', 'src/b.ts'],
      verificationChecks: [{ kind: 'test' as const, ok: true, exitCode: 0, timedOut: false, attempt: 1 }],
    };

    const { rerender } = render(<OriginProjectWorkspaceV31
      {...baseProps}
      mode="coding"
      codingEvidence={evidence}
      activeView="files"
    />);

    expect(screen.getByRole('region', { name: 'Project Files' }).textContent).toContain('src/a.ts');

    rerender(<OriginProjectWorkspaceV31
      {...baseProps}
      mode="coding"
      codingEvidence={evidence}
      activeView="tasks"
    />);

    expect(screen.getByRole('region', { name: 'Project Tasks' }).textContent).toContain('verified');
    expect(screen.getByRole('region', { name: 'Project Tasks' }).textContent).toContain('test');
  });
});
