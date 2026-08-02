import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import PersonalDashboard from '../PersonalDashboard';

describe('PersonalDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presents one clear Japanese request entry point', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} />);

    expect(screen.getByText('考えがまとまる前から、始められます。')).toBeTruthy();
    expect(screen.getByLabelText('やりたいことを入力')).toBeTruthy();
    expect(screen.getByText('AI利用料 $0.00 · 無料モデル固定 · 自動切替なし')).toBeTruthy();
    expect(screen.queryByText('提案資料作成')).toBeNull();
    expect(screen.queryByText('画像生成')).toBeNull();
    expect(screen.queryByText('SEO\/AIO分析')).toBeNull();
  });

  it('keeps example prompts editable instead of executing them immediately', () => {
    const onNavigateToChat = vi.fn();
    render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);

    fireEvent.click(screen.getByRole('button', { name: '候補の情報を貼り付けて、違いを比較したい' }));

    expect(onNavigateToChat).not.toHaveBeenCalled();
    const input = screen.getByLabelText('やりたいことを入力') as HTMLTextAreaElement;
    expect(input.value).toBe('候補の情報を貼り付けて、違いを比較したい');
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
    const input = screen.getByLabelText('やりたいことを入力');
    expect(sendButton.disabled).toBe(true);
    expect(input.className).toContain('placeholder:text-origin-placeholder');
    expect(sendButton.className).toContain('disabled:bg-origin-placeholder');
    expect(screen.getByText('個人情報、社外秘、パスワード、APIキー、秘密鍵は入力しないでください。')).toBeTruthy();
  });

  it('renders the English variant when English is selected', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} language="en" />);

    expect(screen.getByText('Start before your thoughts are fully formed.')).toBeTruthy();
    expect(screen.getByLabelText('Describe what you want help with')).toBeTruthy();
  });
});
