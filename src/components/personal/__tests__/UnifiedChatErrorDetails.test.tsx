import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import UnifiedChat from '../UnifiedChat';
import { useAppState } from '../../../hooks/useAppState';

vi.mock('../../../hooks/useAppState', () => ({
  useAppState: vi.fn(),
}));

describe('UnifiedChat error details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAppState as any).mockReturnValue({
      settings: { language: 'ja', timeoutSeconds: 30 },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        code: 'PROVIDER_RATE_LIMITED',
        message: '無料AIの利用上限に達しました。時間をおいて再試行してください。',
        retryable: true,
        requestId: 'origin-rate-limit-test',
      }),
    });
  });

  it('keeps support identifiers closed until the user asks for them', async () => {
    render(<UnifiedChat />);

    fireEvent.change(screen.getByPlaceholderText('ORIGINにメッセージを入力...'), {
      target: { value: '文章を確認してください' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'メッセージを送信' }));

    await waitFor(() => {
      expect(screen.getByText('無料AIの利用上限に達しました')).toBeTruthy();
      expect(screen.getByText('問題の詳細を見る')).toBeTruthy();
    });

    const details = screen.getByTestId('error-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText('問題の詳細を見る'));
    expect(details.open).toBe(true);
    expect(screen.getByText('エラーコード')).toBeTruthy();
    expect(screen.getByText('PROVIDER_RATE_LIMITED')).toBeTruthy();
    expect(screen.getByText('問い合わせID')).toBeTruthy();
    expect(screen.getByText('origin-rate-limit-test')).toBeTruthy();
  });
});
