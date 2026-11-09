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

  it('renders the idle still used for the brand mark', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="idle" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('src')).toBe('/brand/origin-cat.webp');
    expect(visual.getAttribute('data-state')).toBe('idle');
  });

  it('wraps the visual on a pedestal, keeping the total size set by the pad ratio', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="idle" size={80} pedestal />);
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect(pedestal).toBeTruthy();
    // pad = round(80 * 0.09) = 7, so the disc is 94px across.
    expect(pedestal.style.width).toBe('94px');
    expect(pedestal.style.height).toBe('94px');
    const visual = screen.getByTestId('origin-cat-state');
    expect(pedestal.contains(visual)).toBe(true);
    // 暫定対処：絵は台座の内寸の 80%（= 64px）に縮小し、明るい台座面を
    // はっきり見せる。台座の総寸（94px）は従来どおり変えない。
    expect(visual.style.width).toBe('80%');
    expect(visual.style.height).toBe('80%');
  });

  it('keeps the hero geometry: an 84px inner size on a 100px pedestal with the visual at 80%', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="idle" size={84} pedestal />);
    // pad = round(84 * 0.09) = 8, so the disc stays 100px across (#1170).
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect(pedestal.style.width).toBe('100px');
    expect(pedestal.style.height).toBe('100px');
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.style.width).toBe('80%');
    expect(visual.style.height).toBe('80%');
  });

  it('keeps the working video (with its poster) on a pedestal at the same 80% occupancy', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="working" size={64} pedestal />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('VIDEO');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_WORKING_VIDEO_SRC);
    expect(visual.getAttribute('poster')).toBe(ORIGIN_CAT_STILL_SRC.working);
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect(pedestal.contains(visual)).toBe(true);
    // pad = round(64 * 0.09) = 6, so the disc is 76px across; the video
    // (and its poster frame) use the same 80% occupancy as the stills.
    expect(pedestal.style.width).toBe('76px');
    expect(pedestal.style.height).toBe('76px');
    expect(visual.style.width).toBe('80%');
    expect(visual.style.height).toBe('80%');
  });

  it('falls back to the still image for the working state under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    render(<OriginCatState state="working" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC.working);
  });
});
