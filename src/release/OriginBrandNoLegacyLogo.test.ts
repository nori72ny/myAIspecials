import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('ORIGIN brand regression boundary', () => {
  it('uses the approved versioned ribbon mark on the startup splash', () => {
    const splash = read('src/components/SplashScreen.tsx');
    // The mark/wordmark markup lives in the shared brand lockup component
    // (header + splash) since 2026-11-16; the splash passes it the
    // approved versioned mark source.
    const lockup = read('src/components/OriginBrandLockup.tsx');
    const splashBrand = read('src/components/splash-brand.css');

    expect(splash).toContain("const STARTUP_BRAND_MARK_SRC = '/brand/origin-ribbon-o.webp?v=ribbon-20261108';");
    expect(splash).toContain('markSrc={STARTUP_BRAND_MARK_SRC}');
    expect(lockup).toContain('src={markSrc}');
    expect(lockup).toContain('origin-ribbon-logo');
    expect(lockup).toContain('origin-ribbon-wordmark');
    expect(lockup).toContain('aria-label="ORIGIN"');
    expect(splashBrand).toContain('.origin-ribbon-logo__mark');
    expect(splashBrand).toContain('.origin-ribbon-wordmark');
    expect(splash).not.toContain('origin-sunrise');
    expect(lockup).not.toContain('origin-sunrise');
    expect(splashBrand).not.toContain('origin-sunrise');
  });

  it('does not ship retired startup logo selectors that could be reused accidentally', () => {
    const ultraOptics = read('src/ultra-optics.css');

    expect(ultraOptics).not.toContain('.origin-ultra-logo');
    expect(ultraOptics).not.toContain('.origin-ultra-logo__core');
    expect(ultraOptics).not.toContain('.origin-ultra-wordmark');
    expect(ultraOptics).not.toContain('.origin-ultra-caption');
  });
});
