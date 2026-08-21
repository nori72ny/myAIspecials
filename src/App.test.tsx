// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArtifactWorkspace, type ArtifactBlock } from './App';

const artifact: ArtifactBlock = {
  id: 'artifact-1', type: 'html', language: 'html', title: 'Safe preview',
  content: '<main><button>Ready</button></main>', isComplete: true,
};

describe('ArtifactWorkspace action bar and sandbox runtime boundary', () => {
  afterEach(cleanup);

  it('renders the four explicit artifact actions with 44px minimum targets', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    for (const id of ['artifact-action-copy', 'artifact-action-save', 'artifact-action-share', 'artifact-action-edit']) {
      expect(screen.getByTestId(id).className).toContain('min-h-11');
    }
    expect(screen.getByRole('button', { name: '成果物を共有' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Canvas Direct Touchで編集' })).toBeTruthy();
  });

  it('isolates a sandbox runtime error and restores the last known good revision', () => {
    render(<ArtifactWorkspace artifact={artifact} isOpen language="ja" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを表示' }));
    const frame = screen.getByTitle('プレビュー') as HTMLIFrameElement;
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'ready' } })));
    act(() => window.dispatchEvent(new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'runtime-error', message: 'broken widget' } })));
    expect(screen.getByTestId('sandbox-runtime-boundary').textContent).toContain('Sandbox内で実行時エラーを検知しました。');
    fireEvent.click(screen.getByTestId('restore-last-known-good'));
    expect(screen.queryByTestId('sandbox-runtime-boundary')).toBeNull();
    expect((screen.getByTitle('プレビュー') as HTMLIFrameElement).srcdoc).toContain('Ready');
  });
});
