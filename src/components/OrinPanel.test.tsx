import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrinPanel, { type OrinPanelProps } from './OrinPanel';
import { setSessionCredential } from '../security/sessionCredentials';
import { clearOrinAiNewsCache } from './orinAiNews';

const baseProps: OrinPanelProps = {
  open: true,
  language: 'ja',
  foregroundItems: [],
  agentFallbackItem: null,
  lastCompletedChat: null,
  lastCompletedAgent: null,
  queuedRequests: [],
  onClose: vi.fn(),
};

function renderPanel(overrides: Partial<OrinPanelProps> = {}) {
  return render(<OrinPanel {...baseProps} {...overrides} />);
}

function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => handler(String(input))));
}

function runsResponse(runs: unknown[]) {
  return new Response(JSON.stringify({ ok: true, runs }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setSessionCredential('admin', '');
  clearOrinAiNewsCache();
});

describe('OrinPanel (panel design 2026-11-24, expansion 2026-11-25)', () => {
  it('shows the profile header with the unified name "Orin" and the two labelled tabs (C-5)', () => {
    renderPanel();
    const panel = screen.getByTestId('origin-orin-panel');
    expect(within(panel).getByTestId('origin-orin-profile-name').textContent).toBe('Orin');
    // タブはアイコン＋短い文字ラベルの併記（デザイン是正 C-5）。
    // 可視ラベルが accessible name と一致する。
    const workTab = within(panel).getByTestId('origin-orin-panel-tab-work');
    expect(workTab.getAttribute('aria-label')).toBe('作業状況');
    expect(workTab.getAttribute('title')).toBe('作業状況');
    expect(within(workTab).getByText('作業状況')).toBeTruthy();
    const featuresTab = within(panel).getByTestId('origin-orin-panel-tab-features');
    expect(featuresTab.getAttribute('aria-label')).toBe('できること');
    expect(featuresTab.getAttribute('title')).toBe('できること');
    expect(within(featuresTab).getByText('できること')).toBeTruthy();
    expect(within(panel).getByTestId('origin-orin-panel-tab-indicator')).toBeTruthy();
  });

  it('shows the Christmas profile art without a season figure in December (appearance patterns Phase 1, 2026-11-26)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 25, 12, 0));
    try {
      renderPanel();
      const panel = screen.getByTestId('origin-orin-panel');
      // 12月は待機姿がクリスマス差し替えになる。
      expect(within(panel).getByTestId('origin-cat-state').getAttribute('src')).toBe('/brand/origin-cat-christmas.webp');
      // クリスマスは完成イラストが無いため、季節図版は出さない。
      expect(within(panel).queryByTestId('origin-orin-profile-season')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('slides the tab page from the side of the tab being opened (direction by tab index)', () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByTestId('origin-orin-panel-tab-features'));
    expect(container.querySelector('.origin-orin-panel__page--from-right')).not.toBeNull();
    fireEvent.click(screen.getByTestId('origin-orin-panel-tab-work'));
    expect(container.querySelector('.origin-orin-panel__page--from-left')).not.toBeNull();
  });

  it('marks the panel work-empty for the sheet treatment below 1024px', () => {
    renderPanel();
    // While the work tab is empty, the full-screen form below
    // 1024px becomes a content-height sheet over the scrim
    // (origin-top-ui.css keys that treatment off this class).
    // At 1024px and up the class carries no geometry: the rail
    // background always spans the full height (owner instruction,
    // 2026-11-25 — the rail must not look cut off partway down).
    expect(screen.getByTestId('origin-orin-panel').className).toContain('origin-orin-panel--work-empty');
    fireEvent.click(screen.getByTestId('origin-orin-panel-empty-guide'));
    expect(screen.getByTestId('origin-orin-panel').className).not.toContain('origin-orin-panel--work-empty');
  });

  it('guides from the empty work state into the features tab (K-23)', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('origin-orin-panel-empty-guide'));
    expect(screen.getByTestId('origin-orin-panel-features')).toBeTruthy();
    expect(screen.getByTestId('origin-orin-panel-tab-features').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the plain empty line when nothing is in progress', () => {
    renderPanel();
    expect(screen.getByTestId('origin-orin-panel-empty').textContent).toBe('いまは作業していません');
  });

  it('offers three next actions in the empty work state (C-1)', () => {
    const onClose = vi.fn();
    const onOpenAgent = vi.fn();
    const onOpenCoding = vi.fn();
    const onOpenCreative = vi.fn();
    renderPanel({ onClose, onOpenAgent, onOpenCoding, onOpenCreative });
    expect(screen.getByTestId('origin-orin-panel-empty-action-agent').textContent).toBe('エージェントに任せる');
    expect(screen.getByTestId('origin-orin-panel-empty-action-coding').textContent).toBe('コードを書く・直す');
    expect(screen.getByTestId('origin-orin-panel-empty-action-creative').textContent).toBe('画像を作る');
    fireEvent.click(screen.getByTestId('origin-orin-panel-empty-action-coding'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenCoding).toHaveBeenCalledTimes(1);
  });

  it('shows only the empty actions whose screen can open (C-1)', () => {
    renderPanel({ onOpenAgent: vi.fn() });
    expect(screen.getByTestId('origin-orin-panel-empty-action-agent')).toBeTruthy();
    expect(screen.queryByTestId('origin-orin-panel-empty-action-coding')).toBeNull();
    expect(screen.queryByTestId('origin-orin-panel-empty-action-creative')).toBeNull();
  });

  it('lists foreground work as active and queued requests as waiting, without percentages', () => {
    renderPanel({
      foregroundItems: [{ id: 'chat', title: '回答を準備しています', meta: '出典2件' }],
      queuedRequests: [{ id: 'q1', summary: 'あとで送る質問' }],
    });
    const work = screen.getByTestId('origin-orin-panel-work');
    expect(work.textContent).toContain('作業中');
    expect(work.textContent).toContain('回答を準備しています');
    expect(work.textContent).toContain('未対応');
    expect(work.textContent).toContain('あとで送る質問');
    expect(work.textContent).toContain('送信待ち');
    expect(work.textContent).not.toContain('%');
  });

  it('falls back to the shared agent summary (with steps) when the runs list cannot be read', () => {
    renderPanel({
      agentFallbackItem: {
        title: '文書を作る',
        currentStep: 2,
        totalSteps: 3,
        steps: [
          { title: 'ウェブで調べる', status: 'completed' },
          { title: '文書を作る', status: 'running' },
          { title: 'テストと動作確認', status: 'queued' },
        ],
      },
      onOpenAgent: vi.fn(),
    });
    const work = screen.getByTestId('origin-orin-panel-work');
    expect(work.textContent).toContain('33%（3ステップ中 1つ完了）');
    fireEvent.click(within(work).getByRole('button', { name: 'ステップを見る' }));
    const steps = within(work).getByTestId('origin-orin-panel-steps');
    expect(steps.textContent).toContain('ウェブで調べる');
    expect(steps.textContent).toContain('実行中');
    expect(steps.textContent).toContain('まだ');
    expect(within(work).getByTestId('origin-orin-panel-agent-link')).toBeTruthy();
  });

  it('renders runs from the list API into the four groups with honest progress', async () => {
    setSessionCredential('admin', 'test-credential');
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    stubFetch((url) => {
      if (url.includes('/api/agent/v3/runs')) {
        return runsResponse([
          {
            runId: 'run-active', status: 'running', goal: '競合を調べてまとめる',
            plan: [{ toolName: 'web_search_grounding' }, { toolName: 'document_generator' }, { toolName: 'verification_runner' }, { toolName: 'file_writer' }],
            stepsState: [
              { id: 's0', status: 'completed' }, { id: 's1', status: 'completed' },
              { id: 's2', status: 'completed' }, { id: 's3', status: 'running' },
            ],
            hold: null, createdAt: iso(now - 3600_000), updatedAt: iso(now),
          },
          {
            runId: 'run-approval', status: 'awaiting_approval', goal: '資料を作る',
            plan: [{ toolName: 'document_generator' }],
            stepsState: [{ id: 's0', status: 'queued' }],
            hold: null, createdAt: iso(now - 1800_000), updatedAt: iso(now),
          },
          {
            runId: 'run-held', status: 'held', goal: '大きな調査',
            plan: [{ toolName: 'web_search_grounding' }, { toolName: 'document_generator' }],
            stepsState: [{ id: 's0', status: 'completed' }, { id: 's1', status: 'queued' }],
            hold: { reason: 'quota_exhausted', resumeCondition: { kind: 'quota_reset' } },
            createdAt: iso(now - 7200_000), updatedAt: iso(now),
          },
          {
            runId: 'run-done', status: 'completed', goal: '終わった依頼',
            plan: [{ toolName: 'web_search_grounding' }],
            stepsState: [{ id: 's0', status: 'completed' }],
            hold: null, createdAt: iso(now - 3600_000), updatedAt: iso(now - 600_000),
          },
        ]);
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    renderPanel({ onOpenAgent: vi.fn() });
    const work = await screen.findByTestId('origin-orin-panel-work');
    await waitFor(() => expect(work.textContent).toContain('競合を調べてまとめる'));
    // 作業中：%は n/m 併記
    expect(work.textContent).toContain('75%（4ステップ中 3つ完了）');
    // 未対応：承認待ちに%は付けない
    expect(work.textContent).toContain('計画の確認待ちです');
    expect(work.textContent).not.toContain('ステップ中 0つ完了');
    // 止まっています：held の平易な1行と停止時点の%
    expect(work.textContent).toContain('混み合っているため一時停止中です。自動で再開します');
    expect(work.textContent).toContain('50%（2ステップ中 1つ完了）');
    // 完了
    expect(work.textContent).toContain('終わった依頼');
    expect(work.textContent).toContain('100%（1ステップ中 1つ完了）');
  });

  it('switches to the features tab with honest statuses (fail closed without health proof)', async () => {
    stubFetch(() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    renderPanel({ onOpenAgent: vi.fn(), onOpenCoding: vi.fn() });
    fireEvent.click(screen.getByTestId('origin-orin-panel-tab-features'));
    const features = screen.getByTestId('origin-orin-panel-features');
    expect(features.textContent).toContain('チャットで質問する');
    // 拡張設計 §6.3：状態ラベルは例外（partial / preparing）だけに付け、
    // ready の行には付けない（全行への「使えます」反復は廃止）。
    expect(within(features).getByTestId('origin-orin-panel-feature-status-documents').textContent).toBe('一部使えます');
    expect(within(features).getByTestId('origin-orin-panel-feature-status-read-aloud').textContent).toBe('準備中');
    expect(within(features).queryByTestId('origin-orin-panel-feature-status-agent')).toBeNull();
    expect(within(features).queryByTestId('origin-orin-panel-feature-status-chat')).toBeNull();
    // 準備中の項目はボタンにしない
    expect(within(features).getByTestId('origin-orin-panel-feature-read-aloud').tagName).toBe('DIV');
    expect(within(features).getByTestId('origin-orin-panel-feature-agent').tagName).toBe('BUTTON');
  });

  it('routes 資料を作る to the chat draft entrance instead of only closing (Q7-02)', async () => {
    stubFetch(() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const onClose = vi.fn();
    const onOpenDocuments = vi.fn();
    renderPanel({ onClose, onOpenDocuments });
    fireEvent.click(screen.getByTestId('origin-orin-panel-tab-features'));
    const features = screen.getByTestId('origin-orin-panel-features');
    const row = within(features).getByTestId('origin-orin-panel-feature-documents');
    expect(row.tagName).toBe('BUTTON');
    fireEvent.click(row);
    expect(onOpenDocuments).toHaveBeenCalledWith('資料の企画・構成を相談したい');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render 資料を作る as a button when no documents entrance is wired (Q7-02)', async () => {
    stubFetch(() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    renderPanel({ onOpenAgent: vi.fn() });
    fireEvent.click(screen.getByTestId('origin-orin-panel-tab-features'));
    const features = screen.getByTestId('origin-orin-panel-features');
    expect(within(features).getByTestId('origin-orin-panel-feature-documents').tagName).toBe('DIV');
  });

  it('closes on Escape and on the back control', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('origin-orin-panel-back'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
