import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrinPanel, { type OrinPanelProps } from './OrinPanel';
import { setSessionCredential } from '../security/sessionCredentials';

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
});

describe('OrinPanel (panel design 2026-11-24, stage 1)', () => {
  it('shows the profile header with the unified name "Orin" and both tabs', () => {
    renderPanel();
    const panel = screen.getByTestId('origin-orin-panel');
    expect(within(panel).getByTestId('origin-orin-profile-name').textContent).toBe('Orin');
    expect(within(panel).getByTestId('origin-orin-panel-tab-work')).toBeTruthy();
    expect(within(panel).getByTestId('origin-orin-panel-tab-features')).toBeTruthy();
  });

  it('marks the panel work-empty so the desktop rail hugs its content (batch 2)', () => {
    renderPanel();
    // While the work tab is empty the rail must not stretch to the
    // full column height (origin-top-ui.css keys the fit-content
    // height off this class at min-width: 1024px).
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
    expect(features.textContent).toContain('使えます');
    // 資料は「一部使えます」、読み上げは確認できないので「準備中」
    expect(within(features).getByTestId('origin-orin-panel-feature-documents').textContent).toContain('一部使えます');
    expect(within(features).getByTestId('origin-orin-panel-feature-read-aloud').textContent).toContain('準備中');
    // 準備中の項目はボタンにしない
    expect(within(features).getByTestId('origin-orin-panel-feature-read-aloud').tagName).toBe('DIV');
    expect(within(features).getByTestId('origin-orin-panel-feature-agent').tagName).toBe('BUTTON');
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
