import React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginCatState, {
  ORIGIN_CAT_IDLE_MOTION_MAX_SCALE,
  ORIGIN_CAT_IDLE_MOTION_MAX_SHIFT_PX,
  ORIGIN_CAT_IDLE_MOTION_PERIOD_MS,
  ORIGIN_CAT_STILL_SRC,
  ORIGIN_CAT_WORKING_VIDEO_SRC,
} from './OriginCatState';

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
    // pad = round(80 * 0.04) = 3, so the disc is 86px across.
    expect(pedestal.style.width).toBe('86px');
    expect(pedestal.style.height).toBe('86px');
    const visual = screen.getByTestId('origin-cat-state');
    expect(pedestal.contains(visual)).toBe(true);
    // 2026-11-12 見直し：絵は台座の内寸いっぱい（80px）に載せ、台座側は
    // 細いリング（片側3px、絵の約4%）だけにする。旧形状は絵64px＋円盤
    // 94pxで円盤/絵が約1.49倍あり、白い枠が太過ぎた（オーナー指摘）。
    expect(visual.style.width).toBe('80px');
    expect(visual.style.height).toBe('80px');
  });

  it('keeps the hero geometry: an 84px visual on a 90px pedestal with a thin 3px ring', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="idle" size={84} pedestal />);
    // pad = round(84 * 0.04) = 3, so the disc is 90px across. This
    // supersedes the #1170 geometry (100px disc, visual shrunk to 80%),
    // which the owner flagged on 2026-11-12 as a too-thick white frame.
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect(pedestal.style.width).toBe('90px');
    expect(pedestal.style.height).toBe('90px');
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.style.width).toBe('84px');
    expect(visual.style.height).toBe('84px');
  });

  it('keeps the working video (with its poster) on a pedestal at the same full occupancy', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="working" size={64} pedestal />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('VIDEO');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_WORKING_VIDEO_SRC);
    expect(visual.getAttribute('poster')).toBe(ORIGIN_CAT_STILL_SRC.working);
    const pedestal = screen.getByTestId('origin-cat-pedestal');
    expect(pedestal.contains(visual)).toBe(true);
    // pad = round(64 * 0.04) = 3, so the disc is 70px across; the video
    // (and its poster frame) fill the pedestal inner size like the stills.
    expect(pedestal.style.width).toBe('70px');
    expect(pedestal.style.height).toBe('70px');
    expect(visual.style.width).toBe('64px');
    expect(visual.style.height).toBe('64px');
  });

  it('falls back to the still image for the working state under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    render(<OriginCatState state="working" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC.working);
  });

  it('renders the dedicated searching state as a still (split from working, PR-β)', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="searching" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('data-state')).toBe('searching');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC.searching);
  });

  it('keeps the working state a still when stillOnly is set (quiet surfaces such as the header)', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="working" stillOnly />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC.working);
  });

  it('applies the quiet breathing motion only when motion is allowed', () => {
    stubReducedMotion(false);
    const { unmount } = render(<OriginCatState state="idle" breathing />);
    expect(screen.getByTestId('origin-cat-state').className).toContain('origin-cat-breathe');
    unmount();
    stubReducedMotion(true);
    render(<OriginCatState state="idle" breathing />);
    expect(screen.getByTestId('origin-cat-state').className).not.toContain('origin-cat-breathe');
  });

  it('keeps the resident motion inside the design caps and stops it for reduced motion', () => {
    // 設計正本 §7・D-5 の上限：周期3秒以上、スケール3%以内、上下動2px以内。
    expect(ORIGIN_CAT_IDLE_MOTION_PERIOD_MS).toBeGreaterThanOrEqual(3000);
    expect(ORIGIN_CAT_IDLE_MOTION_MAX_SCALE).toBeLessThanOrEqual(1.03);
    expect(ORIGIN_CAT_IDLE_MOTION_MAX_SHIFT_PX).toBeLessThanOrEqual(2);
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    expect(css).toContain('@keyframes origin-cat-breathe');
    expect(css).toContain(`origin-cat-breathe ${ORIGIN_CAT_IDLE_MOTION_PERIOD_MS}ms`);
    expect(css).toContain('@keyframes origin-cat-nod');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
