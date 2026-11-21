import React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OriginCatState, {
  ORIGIN_CAT_IDLE_MOTION_MAX_SCALE,
  ORIGIN_CAT_IDLE_MOTION_MAX_SHIFT_PX,
  ORIGIN_CAT_IDLE_MOTION_PERIOD_MS,
  ORIGIN_CAT_DARK_IDLE_SRC,
  ORIGIN_CAT_JOY_DURATION_MS,
  ORIGIN_CAT_NEWYEAR_FULL_SRC,
  ORIGIN_CAT_NEWYEAR_IDLE_SRC,
  ORIGIN_CAT_SEARCHING_VIDEO_SRC,
  ORIGIN_CAT_SEASON_FULL_SRC,
  ORIGIN_CAT_STILL_SRC,
  ORIGIN_CAT_VIDEO_SRC,
  ORIGIN_CAT_WINTER_FULL_SRC,
  ORIGIN_CAT_WINTER_IDLE_SRC,
  ORIGIN_CAT_WORKING_VIDEO_SRC,
  resolveOriginCatIdleSrc,
  resolveOriginCatSeason,
} from './OriginCatState';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
  beforeEach(() => {
    // 待機姿には季節差し替え（冬／お正月）があるため、季節に左右される
    // 既存の表明が年間を通じて決定的になるよう、既定の日時を季節外
    // （6月）に固定する。季節そのもののテストは個別に日時を差し替える。
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
  });

  it('renders a still image for states without a motion video', () => {
    stubReducedMotion(false);
    for (const state of ['thinking', 'making', 'waiting', 'done', 'sorry', 'sleep'] as const) {
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
    // searching の動画（ORIGIN_CAT_SEARCHING_VIDEO_SRC）はバイナリ素材の
    // ため、この PR とは別に GitHub Web から配置する手順になっている。
    // そのため実在チェックの対象は、既に出荷済みの静止画一式と
    // working 動画に限る。searching 動画のパス自体は対応表のテスト
    // （下記）で文字列として固定し、配置先とずれないようにする。
    for (const src of [...Object.values(ORIGIN_CAT_STILL_SRC), ORIGIN_CAT_WINTER_IDLE_SRC, ORIGIN_CAT_NEWYEAR_IDLE_SRC, ORIGIN_CAT_DARK_IDLE_SRC, ORIGIN_CAT_WINTER_FULL_SRC, ORIGIN_CAT_NEWYEAR_FULL_SRC, ORIGIN_CAT_WORKING_VIDEO_SRC]) {
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

  it('renders the rim-lit dark variant alongside the normal idle still (2026-11-21 redesign)', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="idle" size={72} />);
    const light = screen.getByTestId('origin-cat-state');
    expect(light.className).toContain('origin-cat-still--light');
    const dark = screen.getByTestId('origin-cat-state-dark');
    expect(dark.tagName).toBe('IMG');
    expect(dark.getAttribute('src')).toBe(ORIGIN_CAT_DARK_IDLE_SRC);
    expect(ORIGIN_CAT_DARK_IDLE_SRC).toBe('/brand/origin-cat-dark.webp');
    expect(dark.getAttribute('data-state')).toBe('idle');
    expect(dark.className).toContain('origin-cat-still--dark');
    // 寸法は通常版と対で揃える（テーマで切り替わっても大きさは変わらない）。
    expect((dark as HTMLElement).style.width).toBe('72px');
    expect((dark as HTMLElement).style.height).toBe('72px');
  });

  it('does not render the dark variant for seasonal idle art or other states', () => {
    stubReducedMotion(false);
    vi.setSystemTime(new Date(2026, 11, 25, 12, 0));
    const winter = render(<OriginCatState state="idle" />);
    expect(screen.getByTestId('origin-cat-state').getAttribute('src')).toBe(ORIGIN_CAT_WINTER_IDLE_SRC);
    expect(screen.queryByTestId('origin-cat-state-dark')).toBeNull();
    winter.unmount();
    const thinking = render(<OriginCatState state="thinking" />);
    expect(screen.queryByTestId('origin-cat-state-dark')).toBeNull();
    thinking.unmount();
  });

  it('pins the still light/dark toggle to the theme selector in CSS', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/origin-top-ui.css'), 'utf8');
    // 既定はダーク版を隠し、ダークテーマでは通常版と入れ替える。
    const darkBase = css.match(/\.origin-cat-still--dark \{[^}]*\}/)?.[0] ?? '';
    expect(darkBase).toContain('display: none;');
    const darkShown = css.match(/:root\[data-theme="dark"\] \.origin-cat-still--dark \{[^}]*\}/)?.[0] ?? '';
    expect(darkShown).toContain('display: block;');
    const lightHidden = css.match(/:root\[data-theme="dark"\] \.origin-cat-still--light \{[^}]*\}/)?.[0] ?? '';
    expect(lightHidden).toContain('display: none;');
  });

  it('swaps the idle still to the winter artwork from December to February', () => {
    stubReducedMotion(false);
    for (const date of [new Date(2026, 11, 1, 0, 0), new Date(2027, 0, 20, 12, 0), new Date(2027, 1, 28, 23, 59)]) {
      vi.setSystemTime(date);
      const { unmount } = render(<OriginCatState state="idle" />);
      const visual = screen.getByTestId('origin-cat-state');
      expect(visual.tagName).toBe('IMG');
      expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_WINTER_IDLE_SRC);
      unmount();
    }
  });

  it('gives the New Year artwork priority over the winter one on January 1-10', () => {
    stubReducedMotion(false);
    vi.setSystemTime(new Date(2027, 0, 5, 12, 0));
    render(<OriginCatState state="idle" />);
    expect(screen.getByTestId('origin-cat-state').getAttribute('src')).toBe(ORIGIN_CAT_NEWYEAR_IDLE_SRC);
  });

  it('keeps the normal idle still outside the winter season', () => {
    stubReducedMotion(false);
    for (const date of [new Date(2026, 2, 1, 0, 0), new Date(2026, 10, 30, 23, 59)]) {
      vi.setSystemTime(date);
      const { unmount } = render(<OriginCatState state="idle" />);
      expect(screen.getByTestId('origin-cat-state').getAttribute('src')).toBe('/brand/origin-cat.webp');
      unmount();
    }
  });

  it('does not season-swap any state other than idle', () => {
    stubReducedMotion(false);
    vi.setSystemTime(new Date(2026, 11, 25, 12, 0));
    render(<OriginCatState state="thinking" />);
    expect(screen.getByTestId('origin-cat-state').getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC.thinking);
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

  it('maps exactly the working and searching states to motion videos (M2-3)', () => {
    expect(Object.keys(ORIGIN_CAT_VIDEO_SRC).sort()).toEqual(['searching', 'working']);
    expect(ORIGIN_CAT_VIDEO_SRC.working).toBe(ORIGIN_CAT_WORKING_VIDEO_SRC);
    // searching 動画の配置先パスはこの文字列で固定する（素材ファイルは
    // バイナリのため GitHub Web から別途このパスへ配置する手順）。
    expect(ORIGIN_CAT_SEARCHING_VIDEO_SRC).toBe('/brand/origin-cat-searching.mp4');
    expect(ORIGIN_CAT_VIDEO_SRC.searching).toBe(ORIGIN_CAT_SEARCHING_VIDEO_SRC);
  });

  it('renders the searching look-around video when motion is allowed (M2-3)', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="searching" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('VIDEO');
    expect(visual.getAttribute('data-state')).toBe('searching');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_SEARCHING_VIDEO_SRC);
    // poster は専用静止画が兼ねる（動画が再生できない環境ではこの姿になる）。
    expect(visual.getAttribute('poster')).toBe(ORIGIN_CAT_STILL_SRC.searching);
  });

  it('falls back to the dedicated searching still under prefers-reduced-motion (M2)', () => {
    stubReducedMotion(true);
    render(<OriginCatState state="searching" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('data-state')).toBe('searching');
    expect(visual.getAttribute('src')).toBe('/brand/origin-cat-searching.webp');
    // 専用静止画は thinking と共用しない（M2-2 で差し替え済み）。
    expect(ORIGIN_CAT_STILL_SRC.searching).not.toBe(ORIGIN_CAT_STILL_SRC.thinking);
  });

  it('keeps the searching state a still when stillOnly is set', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="searching" stillOnly />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('src')).toBe(ORIGIN_CAT_STILL_SRC.searching);
  });

  it('renders the making still for artifact creation (M2)', () => {
    stubReducedMotion(false);
    render(<OriginCatState state="making" />);
    const visual = screen.getByTestId('origin-cat-state');
    expect(visual.tagName).toBe('IMG');
    expect(visual.getAttribute('data-state')).toBe('making');
    expect(visual.getAttribute('src')).toBe('/brand/origin-cat-making.webp');
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
    // タップ時の動きは旧来の頷き（nod）から「喜ぶ」動き（joy）へ
    // 置き換えた（プロフィールカード表示、2026-11-15）。尺は従来と
    // 同じ 700ms 級に収める。
    expect(css).toContain('@keyframes origin-cat-joy');
    expect(css).toContain(`origin-cat-joy ${ORIGIN_CAT_JOY_DURATION_MS}ms`);
    expect(ORIGIN_CAT_JOY_DURATION_MS).toBe(700);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('resolveOriginCatIdleSrc', () => {
  it('returns the normal idle src outside December-February', () => {
    expect(resolveOriginCatIdleSrc(new Date(2026, 10, 30, 23, 59))).toBe('/brand/origin-cat.webp');
    expect(resolveOriginCatIdleSrc(new Date(2026, 2, 1, 0, 0))).toBe('/brand/origin-cat.webp');
    expect(resolveOriginCatIdleSrc(new Date(2026, 5, 15, 12, 0))).toBe('/brand/origin-cat.webp');
  });

  it('returns the winter src from December 1 to the end of February', () => {
    expect(resolveOriginCatIdleSrc(new Date(2026, 11, 1, 0, 0))).toBe(ORIGIN_CAT_WINTER_IDLE_SRC);
    expect(resolveOriginCatIdleSrc(new Date(2026, 11, 31, 23, 59))).toBe(ORIGIN_CAT_WINTER_IDLE_SRC);
    expect(resolveOriginCatIdleSrc(new Date(2027, 0, 11, 0, 0))).toBe(ORIGIN_CAT_WINTER_IDLE_SRC);
    expect(resolveOriginCatIdleSrc(new Date(2027, 1, 28, 23, 59))).toBe(ORIGIN_CAT_WINTER_IDLE_SRC);
    // うるう年の2月29日も冬に含む。
    expect(resolveOriginCatIdleSrc(new Date(2028, 1, 29, 23, 59))).toBe(ORIGIN_CAT_WINTER_IDLE_SRC);
    expect(ORIGIN_CAT_WINTER_IDLE_SRC).toBe('/brand/origin-cat-winter.webp');
  });

  it('returns the New Year src on January 1-10, ahead of the winter src', () => {
    expect(resolveOriginCatIdleSrc(new Date(2027, 0, 1, 0, 0))).toBe(ORIGIN_CAT_NEWYEAR_IDLE_SRC);
    expect(resolveOriginCatIdleSrc(new Date(2027, 0, 5, 12, 0))).toBe(ORIGIN_CAT_NEWYEAR_IDLE_SRC);
    expect(resolveOriginCatIdleSrc(new Date(2027, 0, 10, 23, 59))).toBe(ORIGIN_CAT_NEWYEAR_IDLE_SRC);
    expect(ORIGIN_CAT_NEWYEAR_IDLE_SRC).toBe('/brand/origin-cat-newyear.webp');
  });
});

describe('resolveOriginCatSeason', () => {
  it('returns null outside the seasons', () => {
    expect(resolveOriginCatSeason(new Date(2026, 5, 15, 12, 0))).toBeNull();
    expect(resolveOriginCatSeason(new Date(2026, 2, 1, 0, 0))).toBeNull();
    expect(resolveOriginCatSeason(new Date(2026, 10, 30, 23, 59))).toBeNull();
  });

  it('returns winter from December 1 to the end of February', () => {
    expect(resolveOriginCatSeason(new Date(2026, 11, 1, 0, 0))).toBe('winter');
    expect(resolveOriginCatSeason(new Date(2026, 11, 31, 23, 59))).toBe('winter');
    expect(resolveOriginCatSeason(new Date(2027, 0, 11, 0, 0))).toBe('winter');
    expect(resolveOriginCatSeason(new Date(2027, 1, 28, 23, 59))).toBe('winter');
    // うるう年の2月29日も冬に含む（待機姿の解決と判定を共有する）。
    expect(resolveOriginCatSeason(new Date(2028, 1, 29, 23, 59))).toBe('winter');
  });

  it('returns newyear on January 1-10, ahead of winter', () => {
    expect(resolveOriginCatSeason(new Date(2027, 0, 1, 0, 0))).toBe('newyear');
    expect(resolveOriginCatSeason(new Date(2027, 0, 5, 12, 0))).toBe('newyear');
    expect(resolveOriginCatSeason(new Date(2027, 0, 10, 23, 59))).toBe('newyear');
  });

  it('agrees with the resident idle src resolution on every boundary', () => {
    // 常駐の待機姿とプロフィール内の完成イラストは同じ季節判定を使う
    // ため、境界日で両者がずれないことを固定する。
    const cases: Array<[Date, 'winter' | 'newyear' | null, string]> = [
      [new Date(2026, 11, 15, 12, 0), 'winter', ORIGIN_CAT_WINTER_IDLE_SRC],
      [new Date(2027, 0, 5, 12, 0), 'newyear', ORIGIN_CAT_NEWYEAR_IDLE_SRC],
      [new Date(2027, 0, 20, 12, 0), 'winter', ORIGIN_CAT_WINTER_IDLE_SRC],
      [new Date(2026, 5, 15, 12, 0), null, ORIGIN_CAT_STILL_SRC.idle],
    ];
    for (const [date, season, idleSrc] of cases) {
      expect(resolveOriginCatSeason(date)).toBe(season);
      expect(resolveOriginCatIdleSrc(date)).toBe(idleSrc);
    }
  });

  it('maps each season to its profile-card full illustration', () => {
    expect(ORIGIN_CAT_SEASON_FULL_SRC.winter).toBe('/brand/origin-cat-winter-full.webp');
    expect(ORIGIN_CAT_SEASON_FULL_SRC.newyear).toBe('/brand/origin-cat-newyear-full.webp');
    expect(ORIGIN_CAT_WINTER_FULL_SRC).toBe(ORIGIN_CAT_SEASON_FULL_SRC.winter);
    expect(ORIGIN_CAT_NEWYEAR_FULL_SRC).toBe(ORIGIN_CAT_SEASON_FULL_SRC.newyear);
  });
});
