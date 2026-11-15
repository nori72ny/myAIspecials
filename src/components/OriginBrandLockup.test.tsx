import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OriginBrandLockup, { ORIGIN_BRAND_MARK_SRC } from './OriginBrandLockup';

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
    expect(ORIGIN_BRAND_MARK_SRC).toBe('/brand/origin-ribbon-o.webp?v=ribbon-20261108');
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
});
