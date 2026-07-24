import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import UnifiedChat from '../UnifiedChat';

describe('UnifiedChat error details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    fireEvent.change(screen.getByPlaceholderText('やりたいことを入力'), {
      target: { value: '文章を確認してください' },
    });
    fireEvent.click(screen.getByRole('button', { name: '依頼を送信' }));

    await waitFor(() => {
      expect(screen.getByText('無料AIの利用上限に達しました')).toBeTruthy();
      expect(screen.getByText('技術情報')).toBeTruthy();
    });

    const details = screen.getByTestId('error-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText('技術情報'));
    expect(details.open).toBe(true);
    expect(screen.getByText('エラーコード')).toBeTruthy();
    expect(screen.getByText('PROVIDER_RATE_LIMITED')).toBeTruthy();
    expect(screen.getByText('問い合わせID')).toBeTruthy();
    expect(screen.getByText('origin-rate-limit-test')).toBeTruthy();
  });
});
