import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OriginBrandLockup, { ORIGIN_BRAND_MARK_DARK_SRC, ORIGIN_BRAND_MARK_SRC } from './OriginBrandLockup';

afterEach(() => {
  cleanup();
});

describe('OriginBrandLockup', () => {
  it('exposes the whole lockup as one image named ORIGIN', () => {
    render(<OriginBrandLockup />);
    const lockup = screen.getByRole('img', { name: 'ORIGIN' });
    expect(lockup.classList.contains('origin-brand-lockup--header')).toBe(true);
  });

  it('renders the approved versioned ribbon mark', () => {
    const { container } = render(<OriginBrandLockup />);
    const mark = container.querySelector('img.origin-ribbon-logo__mark') as HTMLImageElement;
    expect(mark).not.toBeNull();
    expect(mark.getAttribute('src')).toBe(ORIGIN_BRAND_MARK_SRC);
    expect(ORIGIN_BRAND_MARK_SRC).toBe('/brand/origin-ribbon-o.webp?v=ribbon-20261122');
  });

  it('honors an explicit mark source (the splash passes its own constant)', () => {
    const { container } = render(<OriginBrandLockup variant="splash" markSrc="/brand/custom.webp" />);
    const mark = container.querySelector('img.origin-ribbon-logo__mark') as HTMLImageElement;
    expect(mark.getAttribute('src')).toBe('/brand/custom.webp');
  });

  it('spells ORIGIN with navy ORI and slate GIN letters', () => {
    const { container } = render(<OriginBrandLockup />);
    const letters = Array.from(container.querySelectorAll('.origin-ribbon-wordmark__letter'));
    expect(letters.map((letter) => letter.textContent)).toEqual(['O', 'R', 'I', 'G', 'I', 'N']);
    expect(letters.slice(0, 3).every((letter) => letter.classList.contains('origin-ribbon-wordmark__letter--navy'))).toBe(true);
    expect(letters.slice(3).every((letter) => letter.classList.contains('origin-ribbon-wordmark__letter--slate'))).toBe(true);
  });

  it('puts the small bow only on the second I and draws the gold line', () => {
    const { container } = render(<OriginBrandLockup />);
    const letters = Array.from(container.querySelectorAll('.origin-ribbon-wordmark__letter'));
    expect(letters[4].querySelector('svg.origin-ribbon-wordmark__bow')).not.toBeNull();
    letters.forEach((letter, index) => {
      if (index !== 4) expect(letter.querySelector('svg')).toBeNull();
    });
    const line = container.querySelector('svg.origin-ribbon-wordmark__line');
    expect(line).not.toBeNull();
    expect(line?.querySelector('path')?.getAttribute('fill')).toContain('url(#origin-brand-gold-header)');
  });

  it('renders the halo only for the splash variant', () => {
    const { container: splashContainer } = render(<OriginBrandLockup variant="splash" />);
    expect(splashContainer.querySelector('.origin-ribbon-logo__halo')).not.toBeNull();
    cleanup();
    const { container: headerContainer } = render(<OriginBrandLockup />);
    expect(headerContainer.querySelector('.origin-ribbon-logo__halo')).toBeNull();
  });

  it('renders the paired dark-theme mark with the identical silhouette', () => {
    const { container } = render(<OriginBrandLockup />);
    const darkMark = container.querySelector('img.origin-ribbon-logo__mark--dark') as HTMLImageElement;
    expect(darkMark).not.toBeNull();
    expect(darkMark.getAttribute('src')).toBe(ORIGIN_BRAND_MARK_DARK_SRC);
    expect(ORIGIN_BRAND_MARK_DARK_SRC).toBe('/brand/origin-ribbon-o-dark.webp?v=ribbon-20261122');
  });

  it('pins the transparent dark treatment: no cream plate, token-colored wordmark, paired mark swap (2026-11-22)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/splash-brand.css'), 'utf8');
    // クリーム地チップ（#f0e2c6）は廃止。地は置かず、ワードマーク側が
    // ダークテーマの文字トークンを取る。
    expect(css).not.toContain('#f0e2c6');
    expect(css).not.toContain('#fdf0e0');
    expect(css).toContain(':root[data-theme="dark"] .origin-brand-lockup--header .origin-ribbon-wordmark__letter--navy');
    expect(css).toContain('color: var(--text-primary) !important;');
    expect(css).toContain('color: var(--text-secondary) !important;');
    // マークはライト／ダークの対をテーマで切り替える（片方だけが常に見える）。
    // 切替はヘッダー側だけ：スプラッシュの地は常時白なので紺のまま。
    expect(css).toContain('.origin-ribbon-logo__mark--dark');
    expect(css).toContain(':root[data-theme="dark"] .origin-brand-lockup--header .origin-ribbon-logo__mark--light');
    expect(css).toContain(':root[data-theme="dark"] .origin-brand-lockup--header .origin-ribbon-logo__mark--dark');
    // 焼き込み地を隠すための円形クリップも廃止。
    const markRule = css.match(/\.origin-ribbon-logo__mark \{[^}]*\}/)?.[0] ?? '';
    expect(markRule).not.toContain('border-radius');
  });
});
