import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('keeps closed navigation inert until the user opens the menu', () => {
    render(<PersonalEditionApp settings={DEFAULT_PERSONAL_SETTINGS} />);

    const navigation = document.querySelector<HTMLElement>(
      'aside[aria-label="メインナビゲーション"]',
    );
    expect(navigation).not.toBeNull();
    if (!navigation) throw new Error('Mobile navigation was not rendered.');
    expect(navigation.getAttribute('aria-hidden')).toBe('true');
    expect(navigation.hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'メニューを開く' }));

    expect(navigation.getAttribute('aria-hidden')).toBe('false');
    expect(navigation.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('complementary', { name: 'メインナビゲーション' })).toBe(navigation);
    expect(screen.getByTestId('new-chat-button')).toBeTruthy();
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
