import React from 'react';
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

  it('presents one clear Japanese request entry point without the former six feature cards', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} />);

    expect(screen.getByText('何を実現したいですか？')).toBeTruthy();
    expect(screen.getByLabelText('ORIGINに実現してほしいことを入力')).toBeTruthy();
    expect(screen.getByText(/安全・無料限定の条件内で判断します/)).toBeTruthy();
    expect(screen.queryByText('提案資料作成')).toBeNull();
    expect(screen.queryByText('画像生成')).toBeNull();
    expect(screen.queryByText('SEO/AIO分析')).toBeNull();
  });

  it('keeps example prompts editable instead of immediately executing them', () => {
    const onNavigateToChat = vi.fn();
    render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);

    fireEvent.click(screen.getByRole('button', { name: '候補を調べて、分かりやすく比較したい' }));

    expect(onNavigateToChat).not.toHaveBeenCalled();
    expect(screen.getByLabelText('ORIGINに実現してほしいことを入力')).toHaveValue(
      '候補を調べて、分かりやすく比較したい',
    );
  });

  it('sends the typed request from both the send button and Enter key', () => {
    const onNavigateToChat = vi.fn();
    const { rerender } = render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);
    const input = screen.getByLabelText('ORIGINに実現してほしいことを入力');

    fireEvent.change(input, { target: { value: '新商品の計画を整理したい' } });
    fireEvent.click(screen.getByRole('button', { name: 'ORIGINに依頼を送信' }));
    expect(onNavigateToChat).toHaveBeenLastCalledWith('新商品の計画を整理したい');

    onNavigateToChat.mockClear();
    rerender(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);
    fireEvent.change(screen.getByLabelText('ORIGINに実現してほしいことを入力'), {
      target: { value: '比較表を作りたい' },
    });
    fireEvent.keyDown(screen.getByLabelText('ORIGINに実現してほしいことを入力'), {
      key: 'Enter',
      shiftKey: false,
    });
    expect(onNavigateToChat).toHaveBeenCalledWith('比較表を作りたい');
  });

  it('does not submit an empty request and explains secret handling', () => {
    const onNavigateToChat = vi.fn();
    render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);

    const sendButton = screen.getByRole('button', { name: 'ORIGINに依頼を送信' });
    expect(sendButton).toBeDisabled();
    expect(screen.getByText('パスワードやAPIキーなどの秘密情報は入力しないでください。')).toBeTruthy();
  });

  it('renders the English variant when English is selected', () => {
    (useAppState as any).mockReturnValue({ settings: { language: 'en' } });
    render(<PersonalDashboard onNavigateToChat={vi.fn()} />);

    expect(screen.getByText('What would you like to achieve?')).toBeTruthy();
    expect(screen.getByLabelText('Describe what you want ORIGIN to help you achieve')).toBeTruthy();
  });
});
