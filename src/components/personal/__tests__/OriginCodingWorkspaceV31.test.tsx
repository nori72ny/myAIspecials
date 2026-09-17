// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  it('separates Files, Diff, Tests, Terminal, and Checkpoint as workspace views', () => {
    render(<OriginCodingWorkspaceV31 result={result} state="available" changedPaths={['src/example.ts']} />);

    const tabs = screen.getByRole('tablist', { name: 'Coding workspace views' });
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Files',
      'Diff',
      'Tests',
      'TerminalUnavailable',
      'CheckpointUnavailable',
    ]);
    expect(screen.getByRole('tab', { name: 'Diff' }).getAttribute('aria-selected')).toBe('true');
  });

  it('renders real changed-file, diff, and verification evidence without fabricating data', () => {
    render(<OriginCodingWorkspaceV31 result={result} state="available" changedPaths={['src/example.ts']} />);

    expect(screen.queryByText('src/example.ts')).not.toBeNull();
    expect(screen.queryByText('export const value = 1;')).not.toBeNull();
    expect(screen.queryByText('export const value = 2;')).not.toBeNull();
    expect(screen.getAllByText('PASS')).toHaveLength(4);
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

  it('falls back to changed paths when encrypted result details are unavailable', () => {
    render(<OriginCodingWorkspaceV31 result={null} state="unavailable" changedPaths={['src/path-only.ts']} />);

    expect(screen.queryByText('src/path-only.ts')).not.toBeNull();
    expect(screen.queryByText(/サーバーが返した changed paths のみ表示します/)).not.toBeNull();
  });
});
