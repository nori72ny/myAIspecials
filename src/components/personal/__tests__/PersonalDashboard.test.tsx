import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import PersonalDashboard from '../PersonalDashboard';
import { useAppState } from '../../../hooks/useAppState';

vi.mock('../../../hooks/useAppState', () => ({
  useAppState: vi.fn(),
}));

describe('PersonalDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAppState as any).mockReturnValue({ settings: { language: 'ja' } });
  });

  it('presents one clear Japanese request entry point', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} />);

    expect(screen.getByText('何を手伝えばよいですか？')).toBeTruthy();
    expect(screen.getByLabelText('やりたいことを入力')).toBeTruthy();
    expect(screen.getByText(/無料と確認できるAIだけを使い/)).toBeTruthy();
    expect(screen.queryByText('提案資料作成')).toBeNull();
    expect(screen.queryByText('画像生成')).toBeNull();
    expect(screen.queryByText('SEO\/AIO分析')).toBeNull();
  });

  it('keeps example prompts editable instead of executing them immediately', () => {
    const onNavigateToChat = vi.fn();
    render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);

    fireEvent.click(screen.getByRole('button', { name: '候補を調べて、違いを比較したい' }));

    expect(onNavigateToChat).not.toHaveBeenCalled();
    const input = screen.getByLabelText('やりたいことを入力') as HTMLTextAreaElement;
    expect(input.value).toBe('候補を調べて、違いを比較したい');
  });

  it('sends a trimmed request from the button and Enter key', () => {
    const onNavigateToChat = vi.fn();
    const { rerender } = render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);
    const input = screen.getByLabelText('やりたいことを入力');

    fireEvent.change(input, { target: { value: '  新商品の計画を整理したい  ' } });
    fireEvent.click(screen.getByRole('button', { name: '依頼を送信' }));
    expect(onNavigateToChat).toHaveBeenLastCalledWith('新商品の計画を整理したい');

    onNavigateToChat.mockClear();
    rerender(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);
    fireEvent.change(screen.getByLabelText('やりたいことを入力'), {
      target: { value: '比較表を作りたい' },
    });
    fireEvent.keyDown(screen.getByLabelText('やりたいことを入力'), {
      key: 'Enter',
      shiftKey: false,
    });
    expect(onNavigateToChat).toHaveBeenCalledWith('比較表を作りたい');
  });

  it('does not submit an empty request and explains secret handling', () => {
    const onNavigateToChat = vi.fn();
    render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);

    const sendButton = screen.getByRole('button', { name: '依頼を送信' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    expect(screen.getByText('パスワード、APIキー、秘密鍵は入力しないでください。')).toBeTruthy();
  });

  it('renders the English variant when English is selected', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} language="en" />);

    expect(screen.getByText('What can I help you with?')).toBeTruthy();
    expect(screen.getByLabelText('Describe what you want help with')).toBeTruthy();
  });
});
