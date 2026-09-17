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
  it('separates Files, Diff, Tests, Terminal, and Checkpoint as explicit workspace views', async () => {
    render(<OriginCodingWorkspaceV31 result={result} state="available" changedPaths={['src/example.ts']} />);

    const tabs = screen.getByRole('tablist', { name: 'Coding workspace views' });
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Files',
      'Diff',
      'Tests',
      'TerminalUnavailable',
      'CheckpointUnavailable',
    ]);
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
    expect(panel.textContent).not.toContain('export const value = 1;');
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('states that Terminal is unavailable instead of inventing worker logs', () => {
    render(<OriginCodingWorkspaceV31 result={result} state="available" changedPaths={['src/example.ts']} />);

    fireEvent.click(screen.getByRole('tab', { name: /Terminal/ }));
    expect(screen.queryByText('TerminalはV1.4 runtimeから提供されていません。')).not.toBeNull();
    expect(screen.queryByText(/workerの生ログや擬似コマンド出力は生成しません/)).not.toBeNull();
  });

  it('states that Checkpoint is unavailable instead of implying reversible state', () => {
    render(<OriginCodingWorkspaceV31 result={result} state="available" changedPaths={['src/example.ts']} />);

    fireEvent.click(screen.getByRole('tab', { name: /Checkpoint/ }));
    expect(screen.queryByText('CheckpointはV1.4 runtimeから提供されていません。')).not.toBeNull();
    expect(screen.queryByText(/Undoできるようには見せません/)).not.toBeNull();
  });

  it('falls back to server-observed changed paths when encrypted result details are unavailable', () => {
    render(<OriginCodingWorkspaceV31 result={null} state="unavailable" changedPaths={['src/path-only.ts']} />);

    expect(screen.queryByText('src/path-only.ts')).not.toBeNull();
    expect(screen.queryByText(/サーバーが返した changed paths のみ表示します/)).not.toBeNull();
  });
});
