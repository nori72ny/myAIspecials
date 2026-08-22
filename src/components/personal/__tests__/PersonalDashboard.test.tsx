import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import PersonalDashboard from '../PersonalDashboard';

describe('PersonalDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presents one clear Japanese intent-first entry point', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} />);

    expect(screen.getByText('何を実現したいですか？')).toBeTruthy();
    expect(screen.getByLabelText('実現したいことを入力')).toBeTruthy();
    expect(screen.getByText('現在は無料AIのみを使用し、有料AIへ自動で切り替えません。')).toBeTruthy();
    expect(screen.getByText('始め方を選ぶ')).toBeTruthy();
    expect(screen.queryByText('提案資料作成')).toBeNull();
    expect(screen.queryByText('画像生成')).toBeNull();
    expect(screen.queryByText('SEO\/AIO分析')).toBeNull();
  });

  it('keeps starter prompts editable instead of executing them immediately', () => {
    const onNavigateToChat = vi.fn();
    render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);

    fireEvent.click(screen.getByRole('button', { name: '比較する' }));

    expect(onNavigateToChat).not.toHaveBeenCalled();
    const input = screen.getByLabelText('実現したいことを入力') as HTMLTextAreaElement;
    expect(input.value).toBe('候補の情報を貼り付けて、違いを比較したい');
  });

  it('offers only capabilities that the current product can truthfully support', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} />);

    expect(screen.getByRole('button', { name: '整理する' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '比較する' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '文章にする' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '計画する' })).toBeTruthy();
    expect(screen.queryByText('購入する')).toBeNull();
    expect(screen.queryByText('自動化する')).toBeNull();
    expect(screen.queryByText('最新情報を調べる')).toBeNull();
  });

  it('sends a trimmed request from the button and Enter key', () => {
    const onNavigateToChat = vi.fn();
    const { rerender } = render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);
    const input = screen.getByLabelText('実現したいことを入力');

    fireEvent.change(input, { target: { value: '  新商品の計画を整理したい  ' } });
    fireEvent.click(screen.getByRole('button', { name: '依頼を始める' }));
    expect(onNavigateToChat).toHaveBeenLastCalledWith('新商品の計画を整理したい');

    onNavigateToChat.mockClear();
    rerender(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);
    fireEvent.change(screen.getByLabelText('実現したいことを入力'), {
      target: { value: '比較表を作りたい' },
    });
    fireEvent.keyDown(screen.getByLabelText('実現したいことを入力'), {
      key: 'Enter',
      shiftKey: false,
    });
    expect(onNavigateToChat).toHaveBeenCalledWith('比較表を作りたい');
  });

  it('does not submit while Japanese IME composition is active', () => {
    const onNavigateToChat = vi.fn();
    render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);
    const input = screen.getByLabelText('実現したいことを入力');

    fireEvent.change(input, { target: { value: '変換中の入力' } });
    fireEvent.keyDown(input, {
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      keyCode: 229,
    });

    expect(onNavigateToChat).not.toHaveBeenCalled();
  });

  it('does not submit an empty request and explains secret handling', () => {
    const onNavigateToChat = vi.fn();
    render(<PersonalDashboard onNavigateToChat={onNavigateToChat} />);

    const sendButton = screen.getByRole('button', { name: '依頼を始める' }) as HTMLButtonElement;
    const input = screen.getByLabelText('実現したいことを入力');
    expect(sendButton.disabled).toBe(true);
    expect(input.className).toContain('placeholder:text-origin-placeholder');
    expect(sendButton.className).toContain('disabled:bg-origin-placeholder');
    expect(screen.getByText('個人情報、社外秘、パスワード、APIキー、秘密鍵は入力しないでください。')).toBeTruthy();
  });

  it('connects the home description and safety note to the request field', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} />);

    const input = screen.getByLabelText('実現したいことを入力');
    expect(input.getAttribute('aria-describedby')).toBe(
      'origin-home-description origin-home-safety',
    );
  });

  it('renders the English variant when English is selected', () => {
    render(<PersonalDashboard onNavigateToChat={vi.fn()} language="en" />);

    expect(screen.getByText('What would you like to accomplish?')).toBeTruthy();
    expect(screen.getByLabelText('Describe what you want to accomplish')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Evaluate' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect((screen.getByLabelText('Describe what you want to accomplish') as HTMLTextAreaElement).value).toContain('decision criteria');
    expect(screen.getByText('Start with an executive workflow')).toBeTruthy();
  });
});
