import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import UnifiedChat from '../UnifiedChat';
import { useAppState } from '../../../hooks/useAppState';

// Mock useAppState
vi.mock('../../../hooks/useAppState', () => ({
  useAppState: vi.fn()
}));

const mockDispatchEvent = vi.spyOn(window, 'dispatchEvent');

describe('UnifiedChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    (useAppState as any).mockReturnValue({
      settings: { language: 'ja' }
    });
  });

  it('renders default greeting in Japanese when language is ja', () => {
    render(<UnifiedChat />);
    expect(screen.getByText('こんにちは！ACOS統合AIです。何かお手伝いしましょうか？')).toBeTruthy();
  });

  it('renders default greeting in English when language is en', () => {
    (useAppState as any).mockReturnValue({
      settings: { language: 'en' }
    });
    render(<UnifiedChat />);
    expect(screen.getByText('Hello! I am ACOS Unified AI. How can I assist you today?')).toBeTruthy();
  });

  it('handles user input and API success', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '今日の天気は晴れです。' })
    });

    render(<UnifiedChat />);
    
    const input = screen.getByPlaceholderText('ACOSにメッセージを入力...');
    fireEvent.change(input, { target: { value: '今日の天気は？' } });
    
    const sendButton = screen.getByRole('button');
    fireEvent.click(sendButton);

    expect(screen.getByText('今日の天気は？')).toBeTruthy();
    
    // Verify aiCoreState dispatching
    expect(mockDispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'aiCoreStateChange' }));

    await waitFor(() => {
      expect(screen.getByText('今日の天気は晴れです。')).toBeTruthy();
    });
  });

  it('handles provider error (rate limit) and displays correct UI', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'PROVIDER_RATE_LIMITED',
        messageKey: 'errors.rate_limited',
        retryable: true,
        requestId: 'req-123'
      })
    });

    render(<UnifiedChat />);
    
    const input = screen.getByPlaceholderText('ACOSにメッセージを入力...');
    fireEvent.change(input, { target: { value: 'API上限ですか？' } });
    
    const sendButton = screen.getByRole('button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('レートリミット超過')).toBeTruthy();
      expect(screen.getByText('再試行')).toBeTruthy();
      expect(screen.getByText('Error Code: PROVIDER_RATE_LIMITED')).toBeTruthy();
    });
  });

  it('handles initialPrompt override', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ content: 'Initial prompt response.' })
    });

    render(<UnifiedChat initialPrompt="This is a test prompt" />);
    
    await waitFor(() => {
      expect(screen.getByText('This is a test prompt')).toBeTruthy();
      expect(screen.getByText('Initial prompt response.')).toBeTruthy();
    });
  });
});

