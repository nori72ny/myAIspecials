// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OriginCodingWorkspaceV31 from '../OriginCodingWorkspaceV31';

const result = {
  repairRounds: 1,
  diffs: [{
    path: 'src/example.ts',
    kind: 'modified' as const,
    before: 'export const value = 1;',
    after: 'export const value = 2;',
    beforeTruncated: false,
    afterTruncated: false,
    previewAvailable: true,
  }],
  verificationChecks: (['typecheck', 'lint', 'test', 'build'] as const).map(kind => ({
    kind,
    ok: true,
    exitCode: 0,
    timedOut: false,
    attempt: 1,
  })),
};

afterEach(() => cleanup());

describe('OriginCodingWorkspaceV31', () => {
  it('does not render an empty coding dashboard before real evidence exists', () => {
    render(<OriginCodingWorkspaceV31 result={null} state="pending" changedPaths={[]} />);
    expect(screen.queryByRole('tablist', { name: 'Coding workspace views' })).toBeNull();
    expect(screen.queryByText('変更と検証')).toBeNull();
  });

  it('shows only evidence-backed Files, Diff, and Tests views', async () => {
    render(<OriginCodingWorkspaceV31 result={result} state="available" changedPaths={['src/example.ts']} />);

    const tabs = screen.getByRole('tablist', { name: 'Coding workspace views' });
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Files', 'Diff', 'Tests']);
    expect(screen.queryByText(/Terminal/i)).toBeNull();
    expect(screen.queryByText(/Checkpoint/i)).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Diff' }).getAttribute('aria-selected')).toBe('true');
    });
  });

  it('keeps changed-file, diff, and test evidence in separate views', async () => {
    render(<OriginCodingWorkspaceV31 result={result} state="available" changedPaths={['src/example.ts']} />);

    await waitFor(() => {
      expect(screen.getByRole('tabpanel').textContent).toContain('export const value = 1;');
    });
    let panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('export const value = 2;');

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('src/example.ts');
    expect(panel.textContent).not.toContain('export const value = 1;');

    fireEvent.click(screen.getByRole('tab', { name: 'Tests' }));
    panel = screen.getByRole('tabpanel');
    expect(within(panel).getAllByText('PASS')).toHaveLength(4);
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('falls back to server-observed changed paths when encrypted result details are unavailable', () => {
    render(<OriginCodingWorkspaceV31 result={null} state="unavailable" changedPaths={['src/path-only.ts']} />);

    expect(screen.queryByText('src/path-only.ts')).not.toBeNull();
    expect(screen.queryByText(/サーバーが返した changed paths のみ表示します/)).not.toBeNull();
  });
});
