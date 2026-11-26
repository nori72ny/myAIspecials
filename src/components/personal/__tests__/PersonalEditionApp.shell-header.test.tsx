// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PersonalEditionApp from '../PersonalEditionApp';

// 統一ヘッダー（デザイン是正バッチ6、仕様A）の統合検証：履歴ドロワーは
// 実物を使い、シェルのヘッダーから開くこと、形状の契約（top-16）が
// 移設後も保たれること、チャット以外の画面からの復元でチャットへ
// 遷移することを固定する。チャット本体（App の default）は軽い
// スタブに差し替え、HistoryDrawer と ArtifactWorkspace は実物を
// 読み込む（importOriginal）。
vi.mock('../CodingWorkspaceV31', () => ({ default: () => <section aria-label="Coding Job Workspace">Coding test workspace</section> }));
vi.mock('../../CreativePanelV15', () => ({ default: () => null }));
vi.mock('../../AgentWorkspaceView', () => ({ default: () => <section aria-label="Agent Workspace">Agent test workspace</section> }));

vi.mock('../../../App', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../App')>();
  return {
    ...actual,
    default: () => <div data-testid="mock-origin-app">ORIGIN</div>,
  };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('PersonalEditionApp shell header with the real HistoryDrawer (design batch 6)', () => {
  it('opens the history drawer from the shell header with the pinned shape', async () => {
    render(<PersonalEditionApp />);

    fireEvent.click(screen.getByTestId('history-drawer-toggle'));
    const drawer = await screen.findByTestId('history-drawer');

    // ドロワーはシェルのヘッダーの中から開く（バッチ6で App から移設）。
    expect(screen.getByTestId('origin-shell-header').contains(drawer)).toBe(true);
    // 形状の契約は不変：上端は 64px（top-16）で、sm:top-20 の段差は無い
    // （App.test.tsx の固定をシェル側へ移したもの。仕様書 §5）。
    expect(drawer.className).toContain('top-16');
    expect(drawer.className).not.toContain('sm:top-20');
    expect(screen.getByTestId('history-session-list')).toBeTruthy();
  });

  it('restores a conversation from a workspace screen and returns to chat', async () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    const sessions = [{
      id: 's-1',
      title: '先週の旅行計画',
      createdAt: Date.now() - 86_400_000,
      messages: [{ id: 'u-1', role: 'user' as const, content: '先週の旅行計画の内容' }],
    }];
    render(<PersonalEditionApp sessions={sessions} />);

    // コード画面へ移動してから、シェルのヘッダーの履歴を開く。
    fireEvent.click(screen.getByTestId('sidebar-nav-coding'));
    expect(await screen.findByRole('region', { name: 'Coding Job Workspace' })).toBeTruthy();
    expect(window.location.search).toBe('?workspace=coding');

    fireEvent.click(screen.getByTestId('history-drawer-toggle'));
    const item = await screen.findByTestId('history-session-item-0');
    expect(item.textContent).toContain('先週の旅行計画');
    fireEvent.click(item);

    // 復元と同時にチャット画面へ遷移する（仕様A §2.2）。
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.queryByRole('region', { name: 'Coding Job Workspace' })).toBeNull();
    expect(screen.getByTestId('mock-origin-app').closest('[hidden]')).toBeNull();
    frame.mockRestore();
  });
});
