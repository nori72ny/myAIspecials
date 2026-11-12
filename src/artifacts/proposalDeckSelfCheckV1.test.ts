import { describe, expect, it } from 'vitest';
import type {
  ProposalDeck,
  ProposalDeckSection,
  ProposalDeckSectionRole,
} from './proposalDeckV1.js';
import {
  checkProposalDeck,
  type ProposalDeckViolationCode,
} from './proposalDeckSelfCheckV1.js';

function section(
  role: ProposalDeckSectionRole,
  message: string,
  overrides: Partial<ProposalDeckSection> = {},
): ProposalDeckSection {
  return {
    role,
    message,
    bullets: [{ lead: '転記作業', detail: '週10時間を占めます' }],
    ...overrides,
  };
}

/** 総スライド数6（表紙+要約+3+締め）で全ルールを満たす deck。 */
function validDeck(): ProposalDeck {
  return {
    title: '業務効率化ツールの導入提案',
    subtitle: '営業部の手作業を削減します',
    date: '2026-11-12',
    summary: {
      headline: '導入で営業部の月40時間を削減できます',
      points: ['月40時間の削減', '初期費用は3か月で回収', '来月から段階導入'],
    },
    sections: [
      section('challenge', '現状の手作業で月40時間が失われています'),
      section('solution', '導入で月40時間を削減できます'),
      section('value', '年間120万円のコストを削減できます'),
    ],
    closing: { ask: '導入の承認をお願いします', nextSteps: ['来週キックオフ'] },
    assumptions: ['利用人数は20名を前提とします'],
  };
}

function codes(deck: ProposalDeck): ProposalDeckViolationCode[] {
  return checkProposalDeck(deck).violations.map((violation) => violation.code);
}

function deckWithSectionCount(count: number): ProposalDeck {
  const deck = validDeck();
  deck.sections = Array.from({ length: count }, (_, index) =>
    section('other', `施策${index + 1}を実行します`, { bullets: [] }),
  );
  return deck;
}

describe('checkProposalDeck', () => {
  it('accepts a valid deck', () => {
    const result = checkProposalDeck(validDeck());
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('reports SUMMARY_MISSING when the summary is absent', () => {
    const deck = validDeck() as Partial<ProposalDeck>;
    delete deck.summary;
    expect(codes(deck as ProposalDeck)).toContain('SUMMARY_MISSING');
  });

  it('reports SUMMARY_POINTS when points are not exactly 3', () => {
    const deck = validDeck();
    (deck.summary as { points: string[] }).points = ['月40時間の削減', '初期費用は3か月で回収'];
    expect(codes(deck)).toContain('SUMMARY_POINTS');
  });

  it('reports HEADLINE_NOT_ASSERTION for label-style headings', () => {
    const deck = validDeck();
    deck.sections[0] = section('challenge', '現状の課題');
    expect(codes(deck)).toContain('HEADLINE_NOT_ASSERTION');
    const market = validDeck();
    market.sections[0] = section('challenge', '市場動向');
    expect(codes(market)).toContain('HEADLINE_NOT_ASSERTION');
  });

  it('accepts assertion headings, including the spec example and 。-ending', () => {
    const deck = validDeck();
    deck.sections[0] = section('challenge', '導入で月40時間を削減できます');
    deck.sections[1] = section('solution', '来月から段階的に導入します。');
    expect(codes(deck)).not.toContain('HEADLINE_NOT_ASSERTION');
  });

  it('reports TOO_MANY_BULLETS at 5 bullets in one section', () => {
    const deck = validDeck();
    deck.sections[0] = section('challenge', '現状の手作業で月40時間が失われています', {
      bullets: Array.from({ length: 5 }, (_, index) => ({
        lead: `項目${index + 1}`,
        detail: '補足',
      })),
    });
    expect(codes(deck)).toContain('TOO_MANY_BULLETS');
  });

  it('accepts a bullet of exactly 60 chars and rejects 61 chars (lead + detail)', () => {
    const exact = validDeck();
    exact.sections[0] = section('challenge', '現状の手作業で月40時間が失われています', {
      bullets: [{ lead: 'あ'.repeat(30), detail: 'あ'.repeat(30) }],
    });
    expect(codes(exact)).not.toContain('BULLET_TOO_LONG');

    const over = validDeck();
    over.sections[0] = section('challenge', '現状の手作業で月40時間が失われています', {
      bullets: [{ lead: 'あ'.repeat(31), detail: 'あ'.repeat(30) }],
    });
    expect(codes(over)).toContain('BULLET_TOO_LONG');
  });

  it('counts bullet length in code points, not UTF-16 units', () => {
    const deck = validDeck();
    deck.sections[0] = section('challenge', '現状の手作業で月40時間が失われています', {
      bullets: [{ lead: '😀'.repeat(60), detail: '' }],
    });
    expect(codes(deck)).not.toContain('BULLET_TOO_LONG');
    const over = validDeck();
    over.sections[0] = section('challenge', '現状の手作業で月40時間が失われています', {
      bullets: [{ lead: '😀'.repeat(61), detail: '' }],
    });
    expect(codes(over)).toContain('BULLET_TOO_LONG');
  });

  it('reports PLACEHOLDER_REMAINING for bracket, 〇, ×× and TBD placeholders', () => {
    const bracket = validDeck();
    bracket.title = '[ツール名]導入の提案';
    expect(codes(bracket)).toContain('PLACEHOLDER_REMAINING');

    const circle = validDeck();
    circle.sections[0].bullets = [{ lead: '効率化', detail: '工数が〇〇%減ります' }];
    expect(codes(circle)).toContain('PLACEHOLDER_REMAINING');

    const cross = validDeck();
    cross.sections[0].message = '××を導入します';
    expect(codes(cross)).toContain('PLACEHOLDER_REMAINING');

    const tbd = validDeck();
    tbd.closing = { ask: 'TBD', nextSteps: ['来週キックオフ'] };
    expect(codes(tbd)).toContain('PLACEHOLDER_REMAINING');
  });

  it('reports COLOR_OUT_OF_TOKENS only for unknown color tokens', () => {
    const unknown = validDeck();
    unknown.sections[0].visual = { kind: 'bar', colorToken: 'red' };
    expect(codes(unknown)).toContain('COLOR_OUT_OF_TOKENS');

    const known = validDeck();
    known.sections[0].visual = { kind: 'bar', colorToken: 'accent' };
    expect(codes(known)).not.toContain('COLOR_OUT_OF_TOKENS');
  });

  it('accepts slide counts 6 and 12 and rejects 5 and 13', () => {
    expect(codes(deckWithSectionCount(3))).not.toContain('SLIDE_COUNT_OUT_OF_RANGE');
    expect(codes(deckWithSectionCount(9))).not.toContain('SLIDE_COUNT_OUT_OF_RANGE');
    expect(codes(deckWithSectionCount(2))).toContain('SLIDE_COUNT_OUT_OF_RANGE');
    expect(codes(deckWithSectionCount(10))).toContain('SLIDE_COUNT_OUT_OF_RANGE');
  });

  it('never throws on a structurally broken deck', () => {
    const broken = { title: 'x' } as unknown as ProposalDeck;
    const result = checkProposalDeck(broken);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
