import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  const input = screen.getByPlaceholderText('ORIGINにメッセージを入力...');
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'メッセージを送信' }));
}

async function expectNonRetryableError(title: string, code: string, description: string) {
  await waitFor(() => {
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(description)).toBeTruthy();
    expect(screen.getByText('問題の詳細を見る')).toBeTruthy();
  });

  const details = screen.getByTestId('error-details') as HTMLDetailsElement;
  expect(details.open).toBe(false);

  fireEvent.click(screen.getByText('問題の詳細を見る'));
  expect(details.open).toBe(true);
  expect(screen.getByText('エラーコード')).toBeTruthy();
  expect(screen.getByText(code)).toBeTruthy();

  expect(screen.queryByText('再試行')).toBeNull();
  expect(screen.queryByText('接続設定を確認')).toBeNull();
}

describe('UnifiedChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mockJapaneseSettings();
  });

  it('renders the ORIGIN greeting in Japanese', () => {
    render(<UnifiedChat />);
    expect(screen.getByText('こんにちは。ORIGIN Personalです。達成したいことを教えてください。')).toBeTruthy();
  });

  it('renders the ORIGIN greeting in English', () => {
    (useAppState as any).mockReturnValue({
      settings: { language: 'en', timeoutSeconds: 30 },
    });
    render(<UnifiedChat />);
    expect(screen.getByText('Hello! I am ORIGIN Personal. What outcome would you like to achieve?')).toBeTruthy();
  });

  it('sends a strict zero-cost policy and progressively discloses matching execution metadata', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: '確認結果です。',
        routing: {
          model: 'ORIGIN 無料AI',
          reason: '無料限定ポリシーに適合する実行先を選択しました。',
          timeMs: 25,
          actualCostUsd: 0,
          freeOnly: true,
          verificationStatus: 'not-run',
          verificationReason: 'Phase 1では独立検証を実行していません。',
        },
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('文章を確認してください');

    await waitFor(() => {
      expect(screen.getByText('確認結果です。')).toBeTruthy();
      expect(screen.getByText('無料で実行')).toBeTruthy();
      expect(screen.getByText('実行情報を見る')).toBeTruthy();
    });

    const details = screen.getByTestId('execution-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText('実行情報を見る'));
    expect(details.open).toBe(true);
    expect(screen.getByText('使用したAI')).toBeTruthy();
    expect(screen.getByText('ORIGIN 無料AI')).toBeTruthy();
    expect(screen.getByText('独立検証なし')).toBeTruthy();
    expect(screen.getByText('無料')).toBeTruthy();
    expect(screen.getByText('25ms')).toBeTruthy();
    expect(screen.getByText('無料限定ポリシーに適合する実行先を選択しました。')).toBeTruthy();

    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.executionPolicy).toEqual({
      maxEstimatedCostUsd: 0,
      timeoutMs: 30000,
    });
    expect(body.messages.at(-1)).toEqual({
      role: 'user',
      content: '文章を確認してください',
    });
    expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'aiCoreStateChange' }));
  });

  it('shows a truthful sensitive-input block without retry or settings actions', async () => {
    const description = '秘密情報の可能性がある内容を検出したため、外部AIへの送信を停止しました。';
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'SENSITIVE_INPUT_BLOCKED',
        messageKey: 'errors.sensitiveInputBlocked',
        message: description,
        retryable: false,
        requestId: 'origin-sensitive-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('秘密情報を含む依頼');

    await expectNonRetryableError('秘密情報の送信を停止しました', 'SENSITIVE_INPUT_BLOCKED', description);
  });

  it('shows connection settings only when a free provider is not configured', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'FREE_PROVIDER_NOT_CONFIGURED',
        message: '明示的に無料と確認できるAIプロバイダーが設定されていません。',
        retryable: false,
        requestId: 'origin-config-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('文章を確認してください');

    await waitFor(() => {
      expect(screen.getByText('無料AIの接続設定が必要です')).toBeTruthy();
      expect(screen.getByText('接続設定を確認')).toBeTruthy();
    });
    expect(screen.queryByText('再試行')).toBeNull();
  });

  it('explains stale free-model evidence without pretending it is a user setting', async () => {
    const description = '無料モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。';
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'FREE_MODEL_EVIDENCE_STALE',
        message: description,
        retryable: false,
        requestId: 'origin-catalog-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('文章を確認してください');

    await expectNonRetryableError(
      '無料モデルの利用可能性を再確認する必要があります',
      'FREE_MODEL_EVIDENCE_STALE',
      description,
    );
  });

  it('explains oversized latest input without retrying the same request', async () => {
    const description = '最新の依頼が外部送信の上限（12000文字）を超えています。内容を分割または要約してください。';
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'LATEST_MESSAGE_TOO_LARGE',
        message: description,
        retryable: false,
        requestId: 'origin-size-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('長い依頼');

    await expectNonRetryableError('依頼内容が長すぎます', 'LATEST_MESSAGE_TOO_LARGE', description);
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

  it('withholds an answer when the actual provider route cannot be verified', async () => {
    const description = '実際に使用されたモデルとプロバイダーを確認できなかったため、回答を返しません。';
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

    await expectNonRetryableError('実際の実行先を確認できませんでした', 'PROVIDER_ROUTING_UNVERIFIED', description);
  });

  it('handles provider rate limits and keeps retry available', async () => {
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
    sendJapaneseMessage('API上限ですか？');

    await waitFor(() => {
      expect(screen.getByText('無料AIの利用上限に達しました')).toBeTruthy();
      expect(screen.getByText('再試行')).toBeTruthy();
      expect(screen.getByText('問題の詳細を見る')).toBeTruthy();
    });

    const details = screen.getByTestId('error-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText('問題の詳細を見る'));
    expect(details.open).toBe(true);
    expect(screen.getByText('エラーコード')).toBeTruthy();
    expect(screen.getByText('PROVIDER_RATE_LIMITED')).toBeTruthy();
  });

  it('handles the initial prompt override', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ content: 'Initial prompt response.' }),
    });

    render(<UnifiedChat initialPrompt="This is a test prompt" />);

    await waitFor(() => {
      expect(screen.getByText('This is a test prompt')).toBeTruthy();
      expect(screen.getByText('Initial prompt response.')).toBeTruthy();
    });
  });
});
