import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

const okStreamingResponse = () => ({
  ok: true,
  body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }) },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PersonalEditionApp for ORIGIN Personal 2.0', () => {
  it('renders the Personal 2.0 core identity and all four starter cards', () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);

    expect(screen.getAllByText('ORIGIN', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText('Personal 2.0', { exact: true })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '何を実現したいですか？' })).toBeTruthy();
    expect(screen.getByTestId('origin-home-request')).toBeTruthy();
    expect(screen.getByTestId('starter-0').textContent).toContain('整理する');
    expect(screen.getByTestId('starter-1').textContent).toContain('比較する');
    expect(screen.getByTestId('starter-2').textContent).toContain('文章にする');
    expect(screen.getByTestId('starter-3').textContent).toContain('計画する');
  });

  it('preserves the production settings handoff and accessible target', () => {
    const onOpenSettings = vi.fn();
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByRole('button', { name: '設定を開く' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '新規対話を開始' })).toBeTruthy();
  });

  it('sends a starter-card prompt immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okStreamingResponse());
    vi.stubGlobal('fetch', fetchMock);
    const onMessagesChange = vi.fn();
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} messages={[]} onMessagesChange={onMessagesChange} resetSignal={0} />);

    fireEvent.click(screen.getByTestId('starter-1'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.messages[0].content).toContain('多角的な基準で比較分析');
    expect(onMessagesChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: 'user' }),
    ]));
  });

  it('clears controlled conversation state from the new-conversation control', () => {
    const onMessagesChange = vi.fn();
    render(
      <PersonalEditionApp
        settings={DEFAULT_PERSONAL_SETTINGS}
        messages={[{ id: 'u-1', role: 'user', content: '既存の相談' }]}
        onMessagesChange={onMessagesChange}
        resetSignal={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新規対話を開始' }));
    expect(onMessagesChange).toHaveBeenCalledWith([]);
  });
});
