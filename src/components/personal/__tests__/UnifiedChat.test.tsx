import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import UnifiedChat from '../UnifiedChat';
import { useAppState } from '../../../hooks/useAppState';

vi.mock('../../../hooks/useAppState', () => ({
  useAppState: vi.fn(),
}));

const mockDispatchEvent = vi.spyOn(window, 'dispatchEvent');

function mockJapaneseSettings() {
  (useAppState as any).mockReturnValue({
    settings: { language: 'ja', timeoutSeconds: 30 },
  });
}

function sendJapaneseMessage(value: string) {
  const input = screen.getByPlaceholderText('やりたいことを入力');
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '依頼を送信' }));
}

async function expectNonRetryableError(title: string, code: string, description: string) {
  await waitFor(() => {
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(description)).toBeTruthy();
    expect(screen.getByText('技術情報')).toBeTruthy();
  });

  const details = screen.getByTestId('error-details') as HTMLDetailsElement;
  expect(details.open).toBe(false);

  fireEvent.click(screen.getByText('技術情報'));
  expect(details.open).toBe(true);
  expect(screen.getByText('エラーコード')).toBeTruthy();
  expect(screen.getByText(code)).toBeTruthy();

  expect(screen.queryByText('再試行')).toBeNull();
  expect(screen.queryByText('設定を開く')).toBeNull();
}

describe('UnifiedChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mockJapaneseSettings();
  });

  it('renders the plain Japanese greeting', () => {
    render(<UnifiedChat />);
    expect(screen.getByText('こんにちは。やりたいことを、そのまま入力してください。')).toBeTruthy();
    const log = screen.getByRole('log', { name: '会話履歴' });
    expect(log.getAttribute('aria-live')).toBe('off');
    expect(log.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('article', { name: 'ORIGINの回答' })).toBeTruthy();
  });

  it('renders the plain English greeting', () => {
    render(<UnifiedChat settingsOverride={{ language: 'en', timeoutSeconds: 30 }} />);
    expect(screen.getByText('Hello. Describe what you want to do in your own words.')).toBeTruthy();
  });

  it('preserves Shift+Enter and trims the sent request', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '確認しました。' }),
    });

    render(<UnifiedChat />);

    expect(screen.getByText('Enterで送信 / Shift+Enterで改行')).toBeTruthy();
    expect(screen.getByText('パスワードやAPIキーは入力しないでください。')).toBeTruthy();

    const input = screen.getByPlaceholderText('やりたいことを入力') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '  詳細を確認してください  ' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(input.value).toBe('  詳細を確認してください  ');

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages.at(-1)).toEqual({
      role: 'user',
      content: '詳細を確認してください',
    });
  });

  it('blocks duplicate in-flight submission synchronously', async () => {
    let resolveFetch!: (value: unknown) => void;
    (global.fetch as any).mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    render(<UnifiedChat />);
    const input = screen.getByPlaceholderText('やりたいことを入力');
    const sendButton = screen.getByRole('button', { name: '依頼を送信' });

    fireEvent.change(input, { target: { value: '一度だけ送ってください' } });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('log', { name: '会話履歴' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('article', { name: 'あなたの依頼' })).toBeTruthy();
    expect(screen.getByText('依頼を整理して、回答を作成しています…')).toBeTruthy();

    resolveFetch({
      ok: true,
      json: async () => ({ content: '一度だけ処理しました。' }),
    });

    await waitFor(() => {
      expect(screen.getByText('一度だけ処理しました。')).toBeTruthy();
      expect(screen.getByTestId('response-announcement').textContent).toBe('ORIGINの回答が届きました。');
      expect(screen.getByRole('log', { name: '会話履歴' }).getAttribute('aria-busy')).toBe('false');
    });
  });

  it('sends a strict zero-cost policy and shows plain execution details', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '確認結果です。',
        routing: {
          model: 'ORIGIN 無料AI',
          reason: '無料条件を満たすAIを選びました。',
          timeMs: 25,
          actualCostUsd: 0,
          freeOnly: true,
          verificationStatus: 'not-run',
          verificationReason: 'この版では別AIによる確認を実行していません。',
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('文章を確認してください');

    await waitFor(() => {
      expect(screen.getByText('確認結果です。')).toBeTruthy();
      expect(screen.getByText('無料で回答しました')).toBeTruthy();
      expect(screen.getByText('詳細')).toBeTruthy();
    });

    const details = screen.getByTestId('execution-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText('詳細'));
    expect(details.open).toBe(true);
    expect(screen.getByText('使用したAI')).toBeTruthy();
    expect(screen.getByText('ORIGIN 無料AI')).toBeTruthy();
    expect(screen.getByText('別のAIによる確認')).toBeTruthy();
    expect(screen.getByText('今回は別のAIで確認していません')).toBeTruthy();
    expect(screen.getByText('無料')).toBeTruthy();
    expect(screen.getByText('1秒未満')).toBeTruthy();

    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.executionPolicy).toEqual({
      maxEstimatedCostUsd: 0,
      timeoutMs: 30000,
    });
    expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'aiCoreStateChange' }));
  });

  it('renders the provider-neutral answer structure with progressive disclosure', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '従来互換の回答です。',
        answer: {
          schemaVersion: 'origin.answer.v1',
          language: 'ja',
          conclusion: '安全条件を満たす候補です。',
          answer: [
            '具体的な回答内容です。',
            '',
            '公式資料がこの結論を裏付けています。〔出典: [公式資料](https://example.com/evidence)〕',
          ].join('\n'),
          evidence: [{
            label: '公式資料',
            sourceUrl: 'https://example.com/evidence',
            claim: '公式資料がこの結論を裏付けています。',
            claimBinding: 'explicit-inline-citation',
            evidenceLevel: 'source-checked',
            checks: {
              safeUrl: 'passed',
              content: 'passed',
              freshness: 'passed',
              claimSupport: 'passed',
            },
          }],
          verification: {
            status: 'not-run',
            independentReviewPerformed: false,
            summary: '今回は別のAIによる確認を実施していません。',
          },
          limitations: ['実環境では未確認です。'],
          nextActions: ['実環境の確認後に判断します。'],
          richOutputs: [],
        },
        routing: {
          model: 'ORIGIN 無料AI',
          reason: '無料条件を満たすAIを選びました。',
          timeMs: 100,
          actualCostUsd: 0,
          freeOnly: true,
          verificationStatus: 'not-run',
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('候補を確認してください');

    await waitFor(() => {
      expect(screen.getByText('結論')).toBeTruthy();
      expect(screen.getByText('安全条件を満たす候補です。')).toBeTruthy();
      expect(screen.getByText('具体的な回答内容です。')).toBeTruthy();
      expect(screen.getByText('この回答の確認範囲')).toBeTruthy();
      expect(screen.getByText('すべての出典内容を確認済み')).toBeTruthy();
      expect(screen.getByText('未実施')).toBeTruthy();
      expect(screen.getByText('根拠と出典')).toBeTruthy();
    expect(
      within(screen.getByTestId('structured-answer')).getByRole('link', {
        name: '公式資料',
      }),
    ).toBeTruthy();
      expect(screen.getByText('出典確認済み')).toBeTruthy();
      expect(screen.getByText('確認済み：本文・更新時点・回答との一致。')).toBeTruthy();
      expect(screen.getByText('確認した主張：')).toBeTruthy();
      expect(screen.getByText('公式資料がこの結論を裏付けています。')).toBeTruthy();
      expect(screen.getByText('確認状況')).toBeTruthy();
      expect(screen.getByText('今回は別のAIによる確認を実施していません。')).toBeTruthy();
      expect(screen.getByText('制約・未確認事項')).toBeTruthy();
      expect(screen.getByText('次にできること')).toBeTruthy();
    });
    expect(screen.queryByText('従来互換の回答です。')).toBeNull();
  });

  it('labels provider-supplied evidence as not checked', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '従来互換の回答です。',
        answer: {
          schemaVersion: 'origin.answer.v1',
          language: 'ja',
          conclusion: '提示された資料があります。',
          answer: [
            '資料を確認してください。',
            '',
            'AIがこの資料を主張に対応付けました。〔出典: [提示資料](https://example.com/provided)〕',
          ].join('\n'),
          evidence: [{
            label: '提示資料',
            sourceUrl: 'https://example.com/provided',
            claim: 'AIがこの資料を主張に対応付けました。',
            claimBinding: 'explicit-inline-citation',
            evidenceLevel: 'provided',
            checks: {
              safeUrl: 'passed',
              content: 'not-run',
              freshness: 'not-run',
              claimSupport: 'not-run',
            },
          }],
          verification: {
            status: 'not-run',
            independentReviewPerformed: false,
            summary: '出典内容は未確認です。',
          },
          limitations: ['出典内容は未確認です。'],
          nextActions: ['リンク先を確認してください。'],
          richOutputs: [],
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('資料を確認してください');

    await waitFor(() => {
    expect(
      within(screen.getByTestId('structured-answer')).getByRole('link', {
        name: '提示資料',
      }),
    ).toBeTruthy();
      expect(screen.getByText('AIが提示・未確認')).toBeTruthy();
      expect(screen.getByText('出典内容は未確認')).toBeTruthy();
      expect(screen.getByText('確認済み：HTTPSリンクの基本形式のみ。接続先・本文・更新時点・回答との一致は未確認です。')).toBeTruthy();
      expect(screen.getByText('AIがこの資料を主張に対応付けました。')).toBeTruthy();
      expect(screen.getByText('AIが対応付けた主張：')).toBeTruthy();
      expect(screen.getByTestId('response-announcement').textContent).toBe(
        'ORIGINの回答が届きました。出典内容は未確認。別AIによる確認：未実施。',
      );
    });
    expect(screen.queryByText('出典確認済み')).toBeNull();
  });

  it('distinguishes mixed source checks from an independent review decision', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '従来互換の回答です。',
        answer: {
          schemaVersion: 'origin.answer.v1',
          language: 'ja',
          conclusion: '確認範囲を分けて表示します。',
          answer: [
            '確認済みの主張です。〔出典: [確認済み資料](https://example.com/checked)〕',
            '未確認の主張です。〔出典: [未確認資料](https://example.com/unchecked)〕',
          ].join('\n'),
          evidence: [
            {
              label: '確認済み資料',
              sourceUrl: 'https://example.com/checked',
              claim: '確認済みの主張です。',
              claimBinding: 'explicit-inline-citation',
              evidenceLevel: 'source-checked',
              checks: {
                safeUrl: 'passed',
                content: 'passed',
                freshness: 'passed',
                claimSupport: 'passed',
              },
            },
            {
              label: '未確認資料',
              sourceUrl: 'https://example.com/unchecked',
              claim: '未確認の主張です。',
              claimBinding: 'explicit-inline-citation',
              evidenceLevel: 'provided',
              checks: {
                safeUrl: 'passed',
                content: 'not-run',
                freshness: 'not-run',
                claimSupport: 'not-run',
              },
            },
          ],
          verification: {
            status: 'not-required',
            independentReviewPerformed: false,
            summary: 'この回答では追加の独立確認を必須としていません。',
          },
          limitations: ['未確認の出典を含みます。'],
          nextActions: ['重要な判断の前に未確認の出典を確認してください。'],
          richOutputs: [],
        },
        routing: {
          model: 'ORIGIN 無料AI',
          reason: '無料条件を満たすAIを選びました。',
          timeMs: 100,
          actualCostUsd: 0,
          freeOnly: true,
          verificationStatus: 'not-required',
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('確認範囲を表示してください');

    await waitFor(() => {
      expect(screen.getByText('確認済み・未確認の出典が混在')).toBeTruthy();
      expect(screen.getByText('この回答では不要')).toBeTruthy();
    });
  });

  it('states when a structured answer contains no sources', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '従来互換の回答です。',
        answer: {
          schemaVersion: 'origin.answer.v1',
          language: 'ja',
          conclusion: 'アプリ内で回答できます。',
          answer: 'アプリ内で回答できます。',
          evidence: [],
          verification: {
            status: 'not-required',
            independentReviewPerformed: false,
            summary: 'この回答では追加の独立確認を必須としていません。',
          },
          limitations: [],
          nextActions: [],
          richOutputs: [],
        },
        routing: {
          model: 'ORIGIN アプリ内処理',
          reason: '外部AIを利用しない処理です。',
          timeMs: 0,
          actualCostUsd: 0,
          freeOnly: true,
          verificationStatus: 'not-required',
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('確認してください');

    await waitFor(() => {
      expect(screen.getByText('回答内の出典なし')).toBeTruthy();
      expect(screen.getByText('この回答では不要')).toBeTruthy();
    });
  });

  it('falls back to plain content when answer and routing verification states conflict', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '確認状態が矛盾するため、通常表示へ戻します。',
        answer: {
          schemaVersion: 'origin.answer.v1',
          language: 'ja',
          conclusion: '表示してはいけない確認済み結論です。',
          answer: '表示してはいけない確認済み回答です。',
          evidence: [],
          verification: {
            status: 'passed',
            independentReviewPerformed: true,
            summary: '別AIで確認済みです。',
          },
          limitations: [],
          nextActions: [],
          richOutputs: [],
        },
        routing: {
          model: 'ORIGIN 無料AI',
          reason: '無料条件を満たすAIを選びました。',
          timeMs: 50,
          actualCostUsd: 0,
          freeOnly: true,
          verificationStatus: 'not-run',
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('回答してください');

    await waitFor(() => {
      expect(screen.getByText('確認状態が矛盾するため、通常表示へ戻します。')).toBeTruthy();
    });
    expect(screen.queryByText('表示してはいけない確認済み回答です。')).toBeNull();
    expect(screen.queryByTestId('structured-answer')).toBeNull();
  });

  it('rejects an empty successful response without offering an unsafe retry', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '   ' }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('回答してください');

    await expectNonRetryableError(
      '無料AIを現在利用できません',
      'PROVIDER_INVALID_RESPONSE',
      '無料AIから正しい形式の回答を受け取れませんでした。',
    );
  });

  it('falls back to the legacy content when an answer envelope is malformed', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '安全な従来形式です。',
        answer: {
          schemaVersion: 'origin.answer.v1',
          conclusion: '',
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('回答してください');

    await waitFor(() => expect(screen.getByText('安全な従来形式です。')).toBeTruthy());
    expect(screen.queryByTestId('structured-answer')).toBeNull();
  });

  it('rejects a source-checked label without recorded content and claim checks', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '確認状態を検証できないため従来形式へ戻します。',
        answer: {
          schemaVersion: 'origin.answer.v1',
          language: 'ja',
          conclusion: '表示してはいけない確認済み結論です。',
          answer: '表示してはいけない確認済み回答です。',
          evidence: [{
            label: '確認記録のない資料',
            sourceUrl: 'https://example.com/missing-checks',
            evidenceLevel: 'source-checked',
          }],
          verification: {
            status: 'not-run',
            independentReviewPerformed: false,
            summary: '別AI確認は未実施です。',
          },
          limitations: [],
          nextActions: [],
          richOutputs: [],
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('回答してください');

    await waitFor(() => {
      expect(screen.getByText('確認状態を検証できないため従来形式へ戻します。')).toBeTruthy();
    });
    expect(screen.queryByText('表示してはいけない確認済み回答です。')).toBeNull();
    expect(screen.queryByText('出典確認済み')).toBeNull();
  });

  it('rejects malformed nested evidence instead of rendering an untrusted envelope', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '検証済みの従来形式です。',
        answer: {
          schemaVersion: 'origin.answer.v1',
          language: 'ja',
          conclusion: '表示してはいけない結論です。',
          answer: '表示してはいけない本文です。',
          evidence: [null],
          verification: {
            status: 'passed',
            independentReviewPerformed: false,
            summary: '矛盾した確認状態です。',
          },
          limitations: [],
          nextActions: [],
          richOutputs: [],
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('回答してください');

    await waitFor(() => expect(screen.getByText('検証済みの従来形式です。')).toBeTruthy());
    expect(screen.queryByText('表示してはいけない本文です。')).toBeNull();
    expect(screen.queryByTestId('structured-answer')).toBeNull();
  });

  it('shows a truthful sensitive-input block without retry or settings actions', async () => {
    const description = '秘密情報の可能性がある内容を検出したため、外部AIへの送信を停止しました。';
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'SENSITIVE_INPUT_BLOCKED',
        message: description,
        retryable: false,
        requestId: 'origin-sensitive-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('秘密情報を含む依頼');

    await expectNonRetryableError('秘密情報の送信を停止しました', 'SENSITIVE_INPUT_BLOCKED', description);
    expect(screen.getByRole('article', { name: 'ORIGINのエラー' })).toBeTruthy();
    expect(screen.getByTestId('response-announcement').textContent).toBe('');
  });

  it('explains server-side connection readiness without offering a non-functional setting', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'FREE_PROVIDER_NOT_CONFIGURED',
        message: '無料AIの接続が設定されていません。',
        retryable: false,
        requestId: 'origin-config-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('文章を確認してください');

    await waitFor(() => {
      expect(screen.getByText('無料AIの接続準備が完了していません')).toBeTruthy();
      expect(screen.getByText('ORIGIN側の接続準備が完了するまで回答できません。入力した依頼に問題はありません。')).toBeTruthy();
    });
    expect(screen.queryByText('設定を開く')).toBeNull();
    expect(screen.queryByText('再試行')).toBeNull();
  });

  it('withholds an answer when zero cost cannot be verified', async () => {
    const description = '無料実行であることを利用明細から確認できなかったため、回答を返しません。';
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'PROVIDER_COST_UNVERIFIED',
        message: description,
        retryable: false,
        requestId: 'origin-cost-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('文章を確認してください');

    await expectNonRetryableError('無料実行を確認できませんでした', 'PROVIDER_COST_UNVERIFIED', description);
  });

  it('withholds an answer when the actual route cannot be verified', async () => {
    const description = '実際に使用されたモデルと提供元を確認できなかったため、回答を返しません。';
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'PROVIDER_ROUTING_UNVERIFIED',
        message: description,
        retryable: false,
        requestId: 'origin-routing-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('文章を確認してください');

    await expectNonRetryableError('実際に使われたAIを確認できませんでした', 'PROVIDER_ROUTING_UNVERIFIED', description);
  });

  it('keeps retry available for provider rate limits', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'PROVIDER_RATE_LIMITED',
        message: '無料AIの利用上限に達しました。時間をおいて再試行してください。',
        retryable: true,
        requestId: 'req-123',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('利用上限ですか？');

    await waitFor(() => {
      expect(screen.getByText('無料AIの利用上限に達しました')).toBeTruthy();
      expect(screen.getByText('再試行')).toBeTruthy();
      expect(screen.getByText('技術情報')).toBeTruthy();
    });
  });

  it('handles an initial prompt exactly once', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ content: 'Initial prompt response.' }),
    });

    render(<UnifiedChat initialPrompt="This is a test prompt" />);

    await waitFor(() => {
      expect(screen.getByText('This is a test prompt')).toBeTruthy();
      expect(screen.getByText('Initial prompt response.')).toBeTruthy();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('こんにちは。やりたいことを、そのまま入力してください。')).toBeNull();
    const fetchCall = (global.fetch as any).mock.calls[0];
    expect(JSON.parse(fetchCall[1].body).messages).toEqual([
      { role: 'user', content: 'This is a test prompt' },
    ]);
  });
});
