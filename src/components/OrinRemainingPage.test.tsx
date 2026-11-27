import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrinRemainingPage from './OrinRemainingPage';
import OrinPanel from './OrinPanel';
import { setSessionCredential } from '../security/sessionCredentials';

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

describe('OrinRemainingPage (expansion design §7, moved to a sidebar page 2026-11-25)', () => {
  it('projects only unfinished requests, in attention order', async () => {
    setSessionCredential('admin', 'test-credential');
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const base = { hold: null, createdAt: iso(now - 3600_000), updatedAt: iso(now) };
    stubFetch((url) => {
      if (url.includes('/api/agent/v3/runs')) {
        return runsResponse([
          { ...base, runId: 'run-approval', status: 'awaiting_approval', goal: '資料を作る', plan: [{ toolName: 'document_generator' }], stepsState: [{ id: 's0', status: 'queued' }] },
          {
            ...base, runId: 'run-held', status: 'held', goal: '大きな調査',
            plan: [{ toolName: 'web_search_grounding' }, { toolName: 'document_generator' }],
            stepsState: [{ id: 's0', status: 'completed' }, { id: 's1', status: 'queued' }],
            hold: { reason: 'quota_exhausted', resumeCondition: { kind: 'quota_reset' } },
          },
          { ...base, runId: 'run-failed', status: 'failed', goal: '失敗した依頼', plan: [{ toolName: 'web_search_grounding' }], stepsState: [{ id: 's0', status: 'failed' }] },
          {
            ...base, runId: 'run-active', status: 'running', goal: '競合を調べてまとめる',
            plan: [{ toolName: 'web_search_grounding' }, { toolName: 'document_generator' }, { toolName: 'verification_runner' }, { toolName: 'file_writer' }],
            stepsState: [{ id: 's0', status: 'completed' }, { id: 's1', status: 'completed' }, { id: 's2', status: 'completed' }, { id: 's3', status: 'running' }],
          },
          { ...base, runId: 'run-done', status: 'completed', goal: '終わった依頼', plan: [{ toolName: 'web_search_grounding' }], stepsState: [{ id: 's0', status: 'completed' }] },
          { ...base, runId: 'run-cancelled', status: 'cancelled', goal: 'やめた依頼', plan: [], stepsState: [] },
          { ...base, runId: 'run-expired', status: 'expired', goal: '期限切れの依頼', plan: [], stepsState: [] },
        ]);
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    render(
      <OrinRemainingPage
        language="ja"
        foregroundItems={[]}
        agentFallbackItem={null}
        queuedRequests={[{ id: 'q1', summary: 'あとで送る質問' }]}
        onOpenAgent={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );
    const page = await screen.findByTestId('origin-remaining-page');
    await waitFor(() => expect(page.textContent).toContain('資料を作る'));
    const text = page.textContent ?? '';
    // 節の並び：あなたの番 → 止まっています → 作業中 → 送信待ち
    expect(text.indexOf('あなたの番')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('あなたの番')).toBeLessThan(text.indexOf('止まっています'));
    expect(text.indexOf('止まっています')).toBeLessThan(text.indexOf('作業中'));
    expect(text.indexOf('作業中')).toBeLessThan(text.indexOf('送信待ち'));
    // 次の一手の行
    expect(text).toContain('計画を確認する');
    expect(text).toContain('エージェント画面で見る');
    expect(text).toContain('会話で確認する');
    // held は理由と停止時点の%、実行中は進捗%（承認待ちには%を付けない）
    expect(text).toContain('混み合っているため一時停止中です。自動で再開します');
    expect(text).toContain('50%（2ステップ中 1つ完了）');
    expect(text).toContain('75%（4ステップ中 3つ完了）');
    // 終わったもの（完了・キャンセル・期限切れ）は出ない
    expect(text).not.toContain('終わった依頼');
    expect(text).not.toContain('やめた依頼');
    expect(text).not.toContain('期限切れの依頼');
  });

  it('shows the plain empty state when the list was read and nothing is left', async () => {
    setSessionCredential('admin', 'test-credential');
    stubFetch((url) => {
      if (url.includes('/api/agent/v3/runs')) return runsResponse([]);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    render(
      <OrinRemainingPage
        language="ja"
        foregroundItems={[]}
        agentFallbackItem={null}
        queuedRequests={[]}
      />,
    );
    const empty = await screen.findByTestId('origin-remaining-empty');
    expect(empty.textContent).toBe('残っている依頼はありません');
    expect(screen.getByTestId('origin-remaining-page').textContent).toContain('終わった依頼は、オリンから開く「作業状況」で確認できます');
  });

  it('does not claim zero when the runs list cannot be read', async () => {
    // キーはあるのに取得が失敗した状態で「0件」と言い切るのは
    // 捏造になるため、読み込めなかった旨を出す。
    setSessionCredential('admin', 'test-credential');
    stubFetch((url) => {
      if (url.includes('/api/agent/v3/runs')) {
        return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    render(
      <OrinRemainingPage
        language="ja"
        foregroundItems={[]}
        agentFallbackItem={null}
        queuedRequests={[]}
      />,
    );
    const unavailable = await screen.findByTestId('origin-remaining-unavailable');
    expect(unavailable.textContent).toBe('依頼の状況を読み込めませんでした');
    expect(screen.queryByTestId('origin-remaining-empty')).toBeNull();
    expect(screen.queryByTestId('origin-remaining-needs-credential')).toBeNull();
  });

  it('guides to the admin key instead of an error when no key is entered', async () => {
    // キー未入力は取得の失敗ではない（2026-11-25 夜の本番チェック：
    // パネルはローカル表示で完了1件を出すのに、ページだけが
    // 「読み込めませんでした」になり、壊れているように見えた）。
    // 0件とも失敗とも言わず、入力先を案内する。
    render(
      <OrinRemainingPage
        language="ja"
        foregroundItems={[]}
        agentFallbackItem={null}
        queuedRequests={[]}
      />,
    );
    const guide = await screen.findByTestId('origin-remaining-needs-credential');
    expect(guide.textContent).toBe('エージェントの依頼を表示するには、管理者キーが必要です');
    expect(screen.getByTestId('origin-remaining-page').textContent).toContain('設定から管理者キーを入力してください');
    expect(screen.queryByTestId('origin-remaining-unavailable')).toBeNull();
    expect(screen.queryByTestId('origin-remaining-empty')).toBeNull();
  });

  it('opens settings at the admin key from the no-permission state (C-4)', async () => {
    const onOpenSettings = vi.fn();
    render(
      <OrinRemainingPage
        language="ja"
        foregroundItems={[]}
        agentFallbackItem={null}
        queuedRequests={[]}
        onOpenSettings={onOpenSettings}
      />,
    );
    await screen.findByTestId('origin-remaining-needs-credential');
    fireEvent.click(screen.getByTestId('origin-remaining-open-settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith('admin');
  });

  it('shows no settings button in the no-permission state without a settings handler (C-4)', async () => {
    render(
      <OrinRemainingPage
        language="ja"
        foregroundItems={[]}
        agentFallbackItem={null}
        queuedRequests={[]}
      />,
    );
    await screen.findByTestId('origin-remaining-needs-credential');
    expect(screen.queryByTestId('origin-remaining-open-settings')).toBeNull();
  });

  it('shows the same unfinished runs as the Orin panel (shared source)', async () => {
    setSessionCredential('admin', 'test-credential');
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const base = { hold: null, createdAt: iso(now - 3600_000), updatedAt: iso(now) };
    let runsFetchCount = 0;
    stubFetch((url) => {
      if (url.includes('/api/agent/v3/runs')) {
        runsFetchCount += 1;
        return runsResponse([
          { ...base, runId: 'run-approval', status: 'awaiting_approval', goal: '資料を作る', plan: [{ toolName: 'document_generator' }], stepsState: [{ id: 's0', status: 'queued' }] },
          {
            ...base, runId: 'run-held', status: 'held', goal: '大きな調査',
            plan: [{ toolName: 'web_search_grounding' }, { toolName: 'document_generator' }],
            stepsState: [{ id: 's0', status: 'completed' }, { id: 's1', status: 'queued' }],
            hold: { reason: 'quota_exhausted', resumeCondition: { kind: 'quota_reset' } },
          },
          { ...base, runId: 'run-failed', status: 'failed', goal: '失敗した依頼', plan: [{ toolName: 'web_search_grounding' }], stepsState: [{ id: 's0', status: 'failed' }] },
          {
            ...base, runId: 'run-active', status: 'running', goal: '競合を調べてまとめる',
            plan: [{ toolName: 'web_search_grounding' }, { toolName: 'document_generator' }, { toolName: 'verification_runner' }, { toolName: 'file_writer' }],
            stepsState: [{ id: 's0', status: 'completed' }, { id: 's1', status: 'completed' }, { id: 's2', status: 'completed' }, { id: 's3', status: 'running' }],
          },
          { ...base, runId: 'run-done', status: 'completed', goal: '終わった依頼', plan: [{ toolName: 'web_search_grounding' }], stepsState: [{ id: 's0', status: 'completed' }] },
          { ...base, runId: 'run-cancelled', status: 'cancelled', goal: 'やめた依頼', plan: [], stepsState: [] },
        ]);
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    render(
      <>
        <OrinRemainingPage
          language="ja"
          foregroundItems={[]}
          agentFallbackItem={null}
          queuedRequests={[{ id: 'q1', summary: 'あとで送る質問' }]}
          onOpenAgent={vi.fn()}
          onOpenChat={vi.fn()}
        />
        <OrinPanel
          open
          language="ja"
          foregroundItems={[]}
          agentFallbackItem={null}
          lastCompletedChat={null}
          lastCompletedAgent={null}
          queuedRequests={[{ id: 'q1', summary: 'あとで送る質問' }]}
          onClose={vi.fn()}
        />
      </>,
    );
    const page = await screen.findByTestId('origin-remaining-page');
    const panel = await screen.findByTestId('origin-orin-panel');
    await waitFor(() => expect(page.textContent).toContain('資料を作る'));
    await waitFor(() => expect(panel.textContent).toContain('資料を作る'));
    // 材料は共有ストアの1回の取得（パネルとページで別々に引かない）。
    expect(runsFetchCount).toBe(1);
    const pageText = page.textContent ?? '';
    const panelWork = within(panel).getByTestId('origin-orin-panel-work').textContent ?? '';
    // 未完了の run は両方に出る（あなたの番／作業中／止まっています）。
    for (const title of ['資料を作る', '大きな調査', '失敗した依頼', '競合を調べてまとめる']) {
      expect(pageText).toContain(title);
      expect(panelWork).toContain(title);
    }
    // 件数の対応：あなたの番1件・作業中1件・送信待ち1件は両方で一致する。
    expect(pageText).toContain('あなたの番（1件）');
    expect(pageText).toContain('作業中（1件）');
    expect(pageText).toContain('送信待ち（1件）');
    expect(panelWork).toContain('作業中（1件）');
    expect(panelWork).toContain('未対応（2件）'); // 承認待ち1＋送信待ち1
    // 止まっていますは射影の意味が違う（ページ＝held/failed のみ、
    // パネル＝取り消しも含む状態ボード）ため、ページは2件になる。
    expect(pageText).toContain('止まっています（2件）');
    expect(pageText).not.toContain('やめた依頼');
    // 完了はページに出ない（パネルの完了節には出る）。
    expect(pageText).not.toContain('終わった依頼');
    expect(panelWork).toContain('終わった依頼');
  });
});
