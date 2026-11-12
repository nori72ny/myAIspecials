import { describe, expect, it } from 'vitest';
import {
  buildProposalDeck,
  ProposalDeckBuildError,
  type ProposalDeckBuildErrorCode,
  type ProposalDeckInput,
} from './proposalDeckPlannerV1.js';

function validInput(): ProposalDeckInput {
  return {
    title: '業務効率化ツールの導入提案',
    subtitle: '営業部の手作業を削減します',
    presenter: '営業企画部',
    date: '2026-11-12',
    summary: {
      headline: '導入で営業部の月40時間を削減できます',
      points: ['月40時間の削減', '初期費用は3か月で回収', '来月から段階導入'],
    },
    sections: [
      {
        role: 'challenge',
        message: '現状の手作業で月40時間が失われています',
        bullets: [{ lead: '転記作業', detail: '週10時間を占めます' }],
      },
      {
        role: 'solution',
        message: '導入で月40時間を削減できます',
        bullets: [{ lead: '自動連携', detail: '転記をゼロにします' }],
      },
    ],
    closing: { ask: '導入の承認をお願いします', nextSteps: ['来週キックオフ'] },
    assumptions: ['利用人数は20名を前提とします'],
  };
}

function expectBuildError(
  input: ProposalDeckInput,
  code: ProposalDeckBuildErrorCode,
): void {
  try {
    buildProposalDeck(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ProposalDeckBuildError);
    expect((error as ProposalDeckBuildError).code).toBe(code);
    return;
  }
  throw new Error(`ProposalDeckBuildError(${code}) が投げられませんでした`);
}

describe('buildProposalDeck', () => {
  it('returns the expected deck for a valid input', () => {
    const deck = buildProposalDeck(validInput());
    expect(deck.title).toBe('業務効率化ツールの導入提案');
    expect(deck.subtitle).toBe('営業部の手作業を削減します');
    expect(deck.presenter).toBe('営業企画部');
    expect(deck.date).toBe('2026-11-12');
    expect(deck.summary.points).toEqual([
      '月40時間の削減',
      '初期費用は3か月で回収',
      '来月から段階導入',
    ]);
    expect(deck.sections.map((section) => section.role)).toEqual(['challenge', 'solution']);
    expect(deck.sections[0].bullets).toEqual([
      { lead: '転記作業', detail: '週10時間を占めます' },
    ]);
    expect(deck.closing).toEqual({
      ask: '導入の承認をお願いします',
      nextSteps: ['来週キックオフ'],
    });
    expect(deck.assumptions).toEqual(['利用人数は20名を前提とします']);
  });

  it('sorts sections into the fixed role order, stable within the same role', () => {
    const input = validInput();
    input.sections = [
      { role: 'cost', message: '費用は月額5万円に収まります', bullets: [] },
      { role: 'challenge', message: '課題Aが残っています', bullets: [] },
      { role: 'solution', message: '解決策を導入します', bullets: [] },
      { role: 'challenge', message: '課題Bも残っています', bullets: [] },
      { role: 'value', message: '価値が生まれます', bullets: [] },
      { role: 'plan', message: '来月から始めます', bullets: [] },
      { role: 'other', message: '補足を共有します', bullets: [] },
    ];
    const deck = buildProposalDeck(input);
    expect(deck.sections.map((section) => section.message)).toEqual([
      '課題Aが残っています',
      '課題Bも残っています',
      '解決策を導入します',
      '価値が生まれます',
      '来月から始めます',
      '費用は月額5万円に収まります',
      '補足を共有します',
    ]);
  });

  it('trims every string and drops empty list entries', () => {
    const input = validInput();
    input.title = '  業務効率化ツールの導入提案  ';
    input.sections![0].bullets = [{ lead: '  転記作業 ', detail: ' 週10時間 ' }];
    input.closing = { ask: ' 承認をお願いします ', nextSteps: [' ', ' 来週キックオフ '] };
    input.assumptions = [' ', ' 利用人数は20名 '];
    const deck = buildProposalDeck(input);
    expect(deck.title).toBe('業務効率化ツールの導入提案');
    expect(deck.sections[0].bullets[0]).toEqual({ lead: '転記作業', detail: '週10時間' });
    expect(deck.closing.nextSteps).toEqual(['来週キックオフ']);
    expect(deck.assumptions).toEqual(['利用人数は20名']);
  });

  it('omits presenter when it is blank after trimming', () => {
    const input = validInput();
    input.presenter = '   ';
    const deck = buildProposalDeck(input);
    expect(deck.presenter).toBeUndefined();
    expect('presenter' in deck).toBe(false);
  });

  it('keeps visual declarations and omits blank visual fields', () => {
    const input = validInput();
    input.sections![0].visual = { kind: 'bar', title: ' 工数内訳 ', colorToken: 'accent' };
    const deck = buildProposalDeck(input);
    expect(deck.sections[0].visual).toEqual({
      kind: 'bar',
      title: '工数内訳',
      colorToken: 'accent',
    });
  });

  it('fails with TITLE_EMPTY when the title is blank', () => {
    const input = validInput();
    input.title = '   ';
    expectBuildError(input, 'TITLE_EMPTY');
  });

  it('fails with SUMMARY_POINTS_INVALID when points are not exactly 3', () => {
    const two = validInput();
    two.summary = { headline: '見出し', points: ['a', 'b'] };
    expectBuildError(two, 'SUMMARY_POINTS_INVALID');
    const four = validInput();
    four.summary = { headline: '見出し', points: ['a', 'b', 'c', 'd'] };
    expectBuildError(four, 'SUMMARY_POINTS_INVALID');
  });

  it('fails with SECTIONS_EMPTY when there are no sections', () => {
    const input = validInput();
    input.sections = [];
    expectBuildError(input, 'SECTIONS_EMPTY');
  });

  it('fails with SECTION_MESSAGE_EMPTY when a message is blank', () => {
    const input = validInput();
    input.sections![1].message = '  ';
    expectBuildError(input, 'SECTION_MESSAGE_EMPTY');
  });

  it('fails with BULLET_LEAD_EMPTY when a bullet lead is blank', () => {
    const input = validInput();
    input.sections![0].bullets = [{ lead: ' ', detail: '補足' }];
    expectBuildError(input, 'BULLET_LEAD_EMPTY');
  });

  it('fails with NEXT_STEPS_EMPTY when next steps are empty', () => {
    const input = validInput();
    input.closing = { ask: '承認をお願いします', nextSteps: [] };
    expectBuildError(input, 'NEXT_STEPS_EMPTY');
    const blankOnly = validInput();
    blankOnly.closing = { ask: '承認をお願いします', nextSteps: ['  '] };
    expectBuildError(blankOnly, 'NEXT_STEPS_EMPTY');
  });

  it('fails with a typed error for an unknown role', () => {
    const input = validInput();
    input.sections![0].role = 'unknown-role';
    expectBuildError(input, 'SECTION_ROLE_INVALID');
  });
});
