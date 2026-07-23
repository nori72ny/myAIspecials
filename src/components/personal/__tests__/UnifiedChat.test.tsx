import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    resolveFetch({
      ok: true,
      json: async () => ({ content: '一度だけ処理しました。' }),
    });

    await waitFor(() => expect(screen.getByText('一度だけ処理しました。')).toBeTruthy());
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
          answer: '具体的な回答内容です。',
          evidence: [{
            label: '公式資料',
            sourceUrl: 'https://example.com/evidence',
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
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('候補を確認してください');

    await waitFor(() => {
      expect(screen.getByText('結論')).toBeTruthy();
      expect(screen.getByText('安全条件を満たす候補です。')).toBeTruthy();
      expect(screen.getByText('具体的な回答内容です。')).toBeTruthy();
      expect(screen.getByText('根拠と出典')).toBeTruthy();
      expect(screen.getByRole('link', { name: '公式資料' })).toBeTruthy();
      expect(screen.getByText('出典確認済み')).toBeTruthy();
      expect(screen.getByText('確認済み：本文・更新時点・回答との一致。')).toBeTruthy();
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
          answer: '資料を確認してください。',
          evidence: [{
            label: '提示資料',
            sourceUrl: 'https://example.com/provided',
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
      expect(screen.getByRole('link', { name: '提示資料' })).toBeTruthy();
      expect(screen.getByText('AIが提示・未確認')).toBeTruthy();
      expect(screen.getByText('確認済み：HTTPSリンクの基本形式のみ。接続先・本文・更新時点・回答との一致は未確認です。')).toBeTruthy();
    });
    expect(screen.queryByText('出典確認済み')).toBeNull();
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
  });

  it('opens settings only when connection setup is required', async () => {
    const onOpenSettings = vi.fn();
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'FREE_PROVIDER_NOT_CONFIGURED',
        message: '無料AIの接続が設定されていません。',
        retryable: false,
        requestId: 'origin-config-test',
      }),
    });

    render(<UnifiedChat onOpenSettings={onOpenSettings} />);
    sendJapaneseMessage('文章を確認してください');

    await waitFor(() => {
      expect(screen.getByText('無料AIの接続設定が必要です')).toBeTruthy();
      expect(screen.getByText('設定を開く')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('設定を開く'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
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
  });
});
