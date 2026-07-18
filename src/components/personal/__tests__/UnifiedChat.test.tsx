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

  it('sends a strict zero-cost policy and displays matching execution metadata', async () => {
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
      expect(screen.getByText('ORIGIN 無料AI')).toBeTruthy();
      expect(screen.getByText('独立検証なし')).toBeTruthy();
      expect(screen.getByText('無料')).toBeTruthy();
    });

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
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'SENSITIVE_INPUT_BLOCKED',
        messageKey: 'errors.sensitiveInputBlocked',
        message: '秘密情報の可能性がある内容を検出したため、外部AIへの送信を停止しました。',
        retryable: false,
        requestId: 'origin-sensitive-test',
      }),
    });

    render(<UnifiedChat />);
    sendJapaneseMessage('秘密情報を含む依頼');

    await waitFor(() => {
      expect(screen.getByText('秘密情報の送信を停止しました')).toBeTruthy();
      expect(screen.getByText('秘密情報の可能性がある内容を検出したため、外部AIへの送信を停止しました。')).toBeTruthy();
      expect(screen.getByText('Error Code: SENSITIVE_INPUT_BLOCKED')).toBeTruthy();
    });
    expect(screen.queryByText('再試行')).toBeNull();
    expect(screen.queryByText('接続設定を確認')).toBeNull();
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
      expect(screen.getByText('Error Code: PROVIDER_RATE_LIMITED')).toBeTruthy();
    });
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
