import type { CSSProperties } from 'react';
import './splash-brand.css';

/**
 * ORIGIN brand lockup: the approved ribbon-O mark beside the designed
 * "ORIGIN" wordmark (owner decision 2026-11-16, mixed B/C/D design).
 *
 * The wordmark is real text plus inline SVG — a small navy bow on the
 * second "I" and a gold ribbon line flowing under the word — so it stays
 * crisp at any size instead of shipping as a raster image. Colors were
 * sampled from the approved reference image and from the mark asset:
 * navy #182d5f (ORI), slate #4f6c9b (GIN), gold #d7b253.
 *
 * The mark assets are transparent (owner request 2026-11-22: the cream
 * plate baked into the artwork is gone, so the ribbon floats on the
 * surface itself). The navy artwork sinks into dark surfaces, so — the
 * same paired-asset pattern as Orin's idle still (OriginCatState) — a
 * white dark-theme variant with the identical silhouette is rendered
 * alongside and splash-brand.css shows exactly one of the pair per theme.
 */
export const ORIGIN_BRAND_MARK_SRC = '/brand/origin-ribbon-o.webp?v=ribbon-20261122';
export const ORIGIN_BRAND_MARK_DARK_SRC = '/brand/origin-ribbon-o-dark.webp?v=ribbon-20261122';

export interface OriginBrandLockupProps {
  variant?: 'header' | 'splash';
  markSrc?: string;
  markDarkSrc?: string;
}

const LETTERS: ReadonlyArray<{ char: string; tone: 'navy' | 'slate'; bow?: boolean }> = [
  { char: 'O', tone: 'navy' },
  { char: 'R', tone: 'navy' },
  { char: 'I', tone: 'navy' },
  { char: 'G', tone: 'slate' },
  { char: 'I', tone: 'slate', bow: true },
  { char: 'N', tone: 'slate' },
];

function WordmarkBow() {
  return (
    <svg className="origin-ribbon-wordmark__bow" viewBox="0 0 28 20" aria-hidden="true" focusable="false">
      <path d="M13.9 9.6C10.8 4.2 4.8 2.4 3.3 5.4 2.1 8 6.2 10.9 13.9 10.2Z" />
      <path d="M14.1 9.6C17.2 4.2 23.2 2.4 24.7 5.4 25.9 8 21.8 10.9 14.1 10.2Z" />
      <path d="M12.9 11.2 10.9 17.2 13.6 15.9Z" />
      <path d="M15.1 11.2 17.1 17.2 14.4 15.9Z" />
      <circle cx="14" cy="10" r="1.9" />
    </svg>
  );
}

function WordmarkRibbonLine({ gradientId }: { gradientId: string }) {
  return (
    <svg
      className="origin-ribbon-wordmark__line"
      viewBox="0 0 320 30"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e9cd7d" />
          <stop offset=".55" stopColor="#d7b253" />
          <stop offset="1" stopColor="#bd9136" />
        </linearGradient>
      </defs>
      <path
        d="M6 4C74 16 158 22 224 17 252 15 266 13 276 15 284 16.6 282 20.4 271 20.8 292 20.4 306 16 318 8.6L301.5 15.2C291 21.4 275 24.4 256 23.2 178 28.4 84 20.4 22 11.4 12 10 6 7.2 6 4Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}

export default function OriginBrandLockup({ variant = 'header', markSrc = ORIGIN_BRAND_MARK_SRC, markDarkSrc = ORIGIN_BRAND_MARK_DARK_SRC }: OriginBrandLockupProps) {
  return (
    <span className={`origin-brand-lockup origin-brand-lockup--${variant}`} role="img" aria-label="ORIGIN">
      <span className="origin-ribbon-logo" aria-hidden="true">
        {variant === 'splash' && <span className="origin-ribbon-logo__halo" />}
        <img className="origin-ribbon-logo__mark origin-ribbon-logo__mark--light" src={markSrc} alt="" draggable={false} />
        <img className="origin-ribbon-logo__mark origin-ribbon-logo__mark--dark" src={markDarkSrc} alt="" draggable={false} />
      </span>
      <span className="origin-ribbon-wordmark" aria-hidden="true">
        {LETTERS.map((letter, index) => (
          <span
            key={`${letter.char}-${index}`}
            className={`origin-ribbon-wordmark__letter origin-ribbon-wordmark__letter--${letter.tone}`}
            style={{ '--origin-letter-index': index } as CSSProperties}
          >
            {letter.char}
            {letter.bow && <WordmarkBow />}
          </span>
        ))}
        <WordmarkRibbonLine gradientId={`origin-brand-gold-${variant}`} />
      </span>
    </span>
  );
}
