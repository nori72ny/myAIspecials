import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SplashScreen, {
  SPLASH_FAILSAFE_MS,
  SPLASH_FADE_MS,
  SPLASH_MIN_DISPLAY_MS,
  SPLASH_REDUCED_MIN_DISPLAY_MS,
} from './SplashScreen';

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  stubReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SplashScreen', () => {
  it('shows the startup status with the brand lockup', () => {
    render(<SplashScreen ready={false} />);
    const status = screen.getByRole('status', { name: 'ORIGIN を起動しています' });
    expect(status).toBeTruthy();
    expect(screen.getByRole('img', { name: 'ORIGIN' })).toBeTruthy();
  });

  it('stays for the entrance sequence once ready, then fades out', () => {
    render(<SplashScreen ready />);
    advance(SPLASH_MIN_DISPLAY_MS - 1);
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeTruthy();
    advance(1);
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' }).classList.contains('is-leaving')).toBe(true);
    advance(SPLASH_FADE_MS);
    expect(screen.queryByRole('status', { name: 'ORIGIN を起動しています' })).toBeNull();
  });

  it('waits for readiness but always closes at the fail-safe', () => {
    render(<SplashScreen ready={false} />);
    advance(SPLASH_MIN_DISPLAY_MS + 500);
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeTruthy();
    advance(SPLASH_FAILSAFE_MS - (SPLASH_MIN_DISPLAY_MS + 500));
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' }).classList.contains('is-leaving')).toBe(true);
    advance(SPLASH_FADE_MS);
    expect(screen.queryByRole('status', { name: 'ORIGIN を起動しています' })).toBeNull();
  });

  it('closes once readiness arrives after the minimum display', () => {
    const { rerender } = render(<SplashScreen ready={false} />);
    advance(SPLASH_MIN_DISPLAY_MS + 200);
    rerender(<SplashScreen ready />);
    advance(1);
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' }).classList.contains('is-leaving')).toBe(true);
  });

  it('skips immediately on pointer down', () => {
    render(<SplashScreen ready={false} />);
    fireEvent.pointerDown(screen.getByRole('status', { name: 'ORIGIN を起動しています' }));
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' }).classList.contains('is-leaving')).toBe(true);
    advance(SPLASH_FADE_MS);
    expect(screen.queryByRole('status', { name: 'ORIGIN を起動しています' })).toBeNull();
  });

  it('shows only once per session by default', () => {
    const first = render(<SplashScreen ready={false} />);
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeTruthy();
    first.unmount();
    render(<SplashScreen ready={false} />);
    expect(screen.queryByRole('status', { name: 'ORIGIN を起動しています' })).toBeNull();
  });

  it('uses the short static display under reduced motion', () => {
    stubReducedMotion(true);
    render(<SplashScreen ready />);
    advance(SPLASH_REDUCED_MIN_DISPLAY_MS - 1);
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeTruthy();
    advance(1);
    expect(screen.getByRole('status', { name: 'ORIGIN を起動しています' }).classList.contains('is-leaving')).toBe(true);
    advance(SPLASH_FADE_MS);
    expect(screen.queryByRole('status', { name: 'ORIGIN を起動しています' })).toBeNull();
  });
});
