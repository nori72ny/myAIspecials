import { describe, expect, it } from 'vitest';
import {
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
