import { describe, expect, it } from 'vitest';
import { normalizeAnswerMath } from '../answerMathNormalization';

describe('normalizeAnswerMath (3-A)', () => {
  it('converts the measured defect: inline math with \\times and \\frac', () => {
    expect(normalizeAnswerMath('$40 \\times \\frac{3}{4} = 30$'))
      .toBe('40 × 3/4 = 30');
  });

  it('converts \\times with a decimal operand', () => {
    expect(normalizeAnswerMath('$40 \\times 0.75 = 30$')).toBe('40 × 0.75 = 30');
  });

  it('keeps spaces around converted operators readable', () => {
    expect(normalizeAnswerMath('計算式は $40 \\times \\frac{3}{4} = 30$ です。'))
      .toBe('計算式は 40 × 3/4 = 30 です。');
  });

  it('parenthesizes complex fraction parts', () => {
    expect(normalizeAnswerMath('$\\frac{a + b}{2}$')).toBe('(a + b)/2');
  });

  it('converts square roots, comparisons and superscripts', () => {
    expect(normalizeAnswerMath('$\\sqrt{9} = 3$')).toBe('√9 = 3');
    expect(normalizeAnswerMath('$x \\le 5$')).toBe('x ≤ 5');
    expect(normalizeAnswerMath('$2^{10}$')).toBe('2¹⁰');
    expect(normalizeAnswerMath('$x^2$')).toBe('x²');
  });

  it('converts \\( \\) delimited math', () => {
    expect(normalizeAnswerMath('\\(40 \\times \\frac{1}{2} = 20\\)')).toBe('40 × 1/2 = 20');
  });

  it('converts bare \\frac and \\times outside math delimiters', () => {
    expect(normalizeAnswerMath('答えは \\frac{3}{4} で、40 \\times 0.75 = 30 です。'))
      .toBe('答えは 3/4 で、40 × 0.75 = 30 です。');
  });

  it('leaves dollar amounts without LaTeX commands untouched', () => {
    const text = '価格は $40 から $50 の間です。';
    expect(normalizeAnswerMath(text)).toBe(text);
  });

  it('does not touch fenced code blocks or inline code spans', () => {
    const fenced = '```\n$40 \\times \\frac{3}{4}$\n```';
    expect(normalizeAnswerMath(fenced)).toBe(fenced);
    const inline = 'コマンドは `$x \\times y$` と書きます。';
    expect(normalizeAnswerMath(inline)).toBe(inline);
  });

  it('returns text without math markers unchanged', () => {
    const text = '30人です。計算式：40人 × 0.75 = 30人';
    expect(normalizeAnswerMath(text)).toBe(text);
  });
});
