import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('ORIGIN brand regression boundary', () => {
  it('uses the approved versioned sunrise mark on the startup splash', () => {
    const splash = read('src/components/SplashScreen.tsx');
    const splashBrand = read('src/components/splash-brand.css');

    expect(splash).toContain("const STARTUP_BRAND_MARK_SRC = '/brand/origin-sunrise-mark.svg?v=sunrise-20261004';");
    expect(splash).toContain('src={STARTUP_BRAND_MARK_SRC}');
    expect(splash).toContain('origin-sunrise-logo');
    expect(splash).toContain('origin-sunrise-wordmark');
    expect(splashBrand).toContain('.origin-sunrise-logo__mark');
    expect(splashBrand).toContain('.origin-sunrise-wordmark');
  });

  it('does not ship retired startup logo selectors that could be reused accidentally', () => {
    const ultraOptics = read('src/ultra-optics.css');

    expect(ultraOptics).not.toContain('.origin-ultra-logo');
    expect(ultraOptics).not.toContain('.origin-ultra-logo__core');
    expect(ultraOptics).not.toContain('.origin-ultra-wordmark');
    expect(ultraOptics).not.toContain('.origin-ultra-caption');
  });
});
