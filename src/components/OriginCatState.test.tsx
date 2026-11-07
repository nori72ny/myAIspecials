import React from 'react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginCatState, { ORIGIN_CAT_STILL_SRC, ORIGIN_CAT_WORKING_VIDEO_SRC } from './OriginCatState';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('OriginCatState', () => {
  it('renders a still image for non-working states', () => {
    stubReducedMotion(false);
    for (const state of ['thinking', 'waiting', 'done', 'sorry', 'sleep'] as const) {
      const { unmount } = render(<OriginCatState state={state} />);
      const visual = screen.getByTestId('origin-cat-state');
      expect(visual.tagName).toBe('IMG');
      expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC[state]);
      expect(visual.getAttribute('data-state')).toBe(state);
      unmount();
    }
  });

  it('renders the working video only for the working state when motion is allowed', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="working" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('VIDEO');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_WORKING_VIDEO_SRC);
    expect(visual.getAttribute('poster')).toBe(ORIGIN_CAT_STILL_SRC.working);
  });

  it('ships every referenced cat asset under public/', () => {
    for (const src of [...Object.values(ORIGIN_CAT_STILL_SRC), ORIGIN_CAT_WORKING_VIDEO_SRC]) {
      expect(existsSync(resolve(process.cwd(), 'public', src.replace(/^\//, ''))), src).toBe(true);
    }
  });

  it('falls back to the still image for the working state under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    render(<OriginCatState state="working" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC.working);
  });
});
