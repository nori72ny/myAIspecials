import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONAL_SETTINGS } from '../../../hooks/usePersonalSettings';
import PersonalEditionApp from '../PersonalEditionApp';

describe('PersonalEditionApp mobile navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
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
});
