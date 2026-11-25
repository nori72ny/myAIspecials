import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrinRemainingPage from './OrinRemainingPage';
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

  it('shows the plain empty state when nothing is left', () => {
    render(
      <OrinRemainingPage
        language="ja"
        foregroundItems={[]}
        agentFallbackItem={null}
        queuedRequests={[]}
      />,
    );
    expect(screen.getByTestId('origin-remaining-empty').textContent).toBe('残っている依頼はありません');
    expect(screen.getByTestId('origin-remaining-page').textContent).toContain('終わった依頼は、オリンから開く「作業状況」で確認できます');
  });
});
