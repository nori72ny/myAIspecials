import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

describe('PersonalEditionApp mobile navigation', () => {
  let viewportListener: ((event: MediaQueryListEvent) => void) | undefined;

  beforeEach(() => {
    viewportListener = undefined;
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 1023px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
        if (event === 'change') viewportListener = listener;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  it('keeps the compact navigation focused on home, chat, and settings', async () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);

    expect(screen.getAllByText('Personal')).toHaveLength(2);
    const navigation = document.querySelector<HTMLElement>(
      'aside[aria-label="メインナビゲーション"]',
    );
    expect(navigation).not.toBeNull();
    if (!navigation) throw new Error('Mobile navigation was not rendered.');
    expect(navigation.getAttribute('aria-hidden')).toBe('true');
    expect(navigation.hasAttribute('inert')).toBe(true);

    expect(screen.getByTestId('compact-home-button')).toBeTruthy();
    expect(screen.getByTestId('compact-chat-button')).toBeTruthy();
    expect(screen.getByRole('button', { name: '設定を開く' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'メニューを開く' }).className).toContain('hidden');

    fireEvent.click(screen.getByTestId('compact-chat-button'));
    await waitFor(() => expect(screen.getByLabelText('ORIGINへの依頼')).toBeTruthy());
  });

  it('keeps navigation aligned when the viewport crosses the tablet breakpoint', () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);
    const navigation = document.querySelector<HTMLElement>(
      'aside[aria-label="メインナビゲーション"]',
    );
    if (!navigation) throw new Error('Navigation was not rendered.');

    expect(navigation.getAttribute('aria-hidden')).toBe('true');

    act(() => viewportListener?.({ matches: false } as MediaQueryListEvent));
    expect(navigation.getAttribute('aria-hidden')).toBe('false');

    act(() => viewportListener?.({ matches: true } as MediaQueryListEvent));
    expect(navigation.getAttribute('aria-hidden')).toBe('true');
  });
});
