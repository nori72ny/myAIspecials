import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_CATEGORY_COLOR_TOKEN_NAMES,
  PROPOSAL_CATEGORY_COLOR_TOKENS,
  PROPOSAL_COLOR_TOKEN_NAMES,
  PROPOSAL_COLOR_TOKENS,
  PROPOSAL_DESIGN_TOKENS,
  PROPOSAL_SECTION_ROLE_ORDER,
} from './proposalDeckV1.js';

describe('proposalDeckV1 design tokens', () => {
  it('uses the house colors of the existing artifact generator', () => {
    expect(PROPOSAL_COLOR_TOKENS).toEqual({
      paper: '#FFFFFF',
      ink: '#17324D',
      accent: '#0F6CBD',
      slate: '#334155',
    });
  });

  it('exports the color token name set', () => {
    expect([...PROPOSAL_COLOR_TOKEN_NAMES].sort()).toEqual([
      'accent',
      'ink',
      'paper',
      'slate',
    ]);
    expect(PROPOSAL_COLOR_TOKEN_NAMES.has('accent')).toBe(true);
    expect(PROPOSAL_COLOR_TOKEN_NAMES.has('red' as never)).toBe(false);
  });

  it('pins the slide typography scale from the design', () => {
    expect(PROPOSAL_DESIGN_TOKENS.typography.titlePt).toBe(40);
    expect(PROPOSAL_DESIGN_TOKENS.typography.headlinePt).toBe(28);
    expect(PROPOSAL_DESIGN_TOKENS.typography.bodyPt).toEqual({ min: 14, max: 18 });
    expect(PROPOSAL_DESIGN_TOKENS.typography.notePtMin).toBe(12);
    expect(PROPOSAL_DESIGN_TOKENS.typography.lineHeight).toEqual({ min: 1.2, max: 1.3 });
  });

  it('pins slide count and bullet limits', () => {
    expect(PROPOSAL_DESIGN_TOKENS.slideCount).toEqual({ min: 6, max: 12 });
    expect(PROPOSAL_DESIGN_TOKENS.bullets).toEqual({ maxPerSection: 4, maxChars: 60 });
  });

  it('fixes the section role order', () => {
    expect(PROPOSAL_SECTION_ROLE_ORDER).toEqual([
      'challenge',
      'solution',
      'value',
      'plan',
      'cost',
      'other',
    ]);
  });
});

/** WCAG 2.1 の相対輝度。 */
function relativeLuminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('proposalDeckV1 category color tokens', () => {
  it('defines at most 8 category colors in a separate frame from the theme colors', () => {
    const names = Object.keys(PROPOSAL_CATEGORY_COLOR_TOKENS);
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(8);
    expect(PROPOSAL_CATEGORY_COLOR_TOKEN_NAMES).toEqual(names);
    for (const name of names) {
      expect(PROPOSAL_COLOR_TOKEN_NAMES.has(name as never)).toBe(false);
    }
  });

  it('uses distinct #RRGGBB values', () => {
    const values = Object.values(PROPOSAL_CATEGORY_COLOR_TOKENS);
    for (const value of values) expect(value).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps every category color at 3:1 or more against the paper background', () => {
    for (const [name, value] of Object.entries(PROPOSAL_CATEGORY_COLOR_TOKENS)) {
      expect(contrastRatio(value, PROPOSAL_COLOR_TOKENS.paper), name).toBeGreaterThanOrEqual(3);
    }
  });
});
