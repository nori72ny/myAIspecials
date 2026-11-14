import { describe, expect, it } from 'vitest';
import {
  classifyProposalDeckParseFailureCode,
  summarizeProposalDeckAnswerShape,
} from './proposalDeckFailureShapeV1.js';

const MARKDOWN_SHAPE = `# 導入提案
## 要約
- 月40時間を削減
- 初期費用は50万円
## 課題
本文です。
| 項目 | 値 |
| --- | --- |
| 費用 | 50万円 |`;

const FREEFORM_SHAPE = `【提案の要点】
導入で月40時間を削減できます。
1. サービス概要
2. 課題と解決策
**料金プラン**
【前提・仮定】
- 費用は概算です`;

describe('summarizeProposalDeckAnswerShape', () => {
  it('counts markdown headings, bullets and table rows', () => {
    const shape = summarizeProposalDeckAnswerShape(MARKDOWN_SHAPE);
    expect(shape.markdownHeadingCount).toBe(3);
    expect(shape.numberedHeadingCount).toBe(0);
    expect(shape.bracketStandaloneLineCount).toBe(0);
    expect(shape.boldLabelLineCount).toBe(0);
    expect(shape.bulletLineCount).toBe(2);
    expect(shape.tableRowCount).toBe(3);
    expect(shape.totalChars).toBe([...MARKDOWN_SHAPE].length);
  });

  it('counts bracket standalone lines, numbered headings and bold labels', () => {
    const shape = summarizeProposalDeckAnswerShape(FREEFORM_SHAPE);
    expect(shape.markdownHeadingCount).toBe(0);
    expect(shape.numberedHeadingCount).toBe(2);
    expect(shape.bracketStandaloneLineCount).toBe(2);
    expect(shape.boldLabelLineCount).toBe(1);
    expect(shape.bulletLineCount).toBe(1);
    expect(shape.tableRowCount).toBe(0);
  });

  it('counts indented numbered lines and ・ lines as bullets, not headings', () => {
    const shape = summarizeProposalDeckAnswerShape(
      '本文です。\n  1. 手順の1つ目\n・箇条書きです',
    );
    expect(shape.numberedHeadingCount).toBe(0);
    expect(shape.bulletLineCount).toBe(2);
  });

  it('returns all-zero counts for plain prose', () => {
    const shape = summarizeProposalDeckAnswerShape('構成案だけの自由文の回答です。');
    expect(shape).toEqual({
      totalChars: 15,
      markdownHeadingCount: 0,
      numberedHeadingCount: 0,
      bracketStandaloneLineCount: 0,
      boldLabelLineCount: 0,
      bulletLineCount: 0,
      tableRowCount: 0,
      rejectedHeadingCount: 0,
      rejectedHeadingTooLongCount: 0,
      rejectedHeadingColonCount: 0,
      rejectedHeadingSequenceMismatchCount: 0,
    });
  });

  it('contains only numbers — no source text leaks into the log payload', () => {
    const shape = summarizeProposalDeckAnswerShape(
      '極秘の文言を含む回答です。\n## 見出し\n- 項目',
    );
    expect(Object.values(shape).every((value) => typeof value === 'number')).toBe(true);
    expect(JSON.stringify(shape)).not.toContain('極秘');
    expect(JSON.stringify(shape)).not.toContain('見出し');
  });
});

describe('summarizeProposalDeckAnswerShape rejected headings (fix-5)', () => {
  it('does not count annotated headings as rejected when their core is acceptable', () => {
    // 第5回失敗の形: 見出し文全体は57字＋コロンでも、本体は短く受理される。
    const shape = summarizeProposalDeckAnswerShape(
      [
        '1. サービス概要（Assumptions: 製品名は仮の「SmartLedger」、機能は一般的なクラウド会計に準拠）',
        '2. 主なメリット（3–5ポイント）',
        '3. 料金プラン例（Assumptions: 月額料金はサンプル）',
      ].join('\n'),
    );
    expect(shape.numberedHeadingCount).toBe(3);
    expect(shape.rejectedHeadingCount).toBe(0);
    expect(shape.rejectedHeadingTooLongCount).toBe(0);
    expect(shape.rejectedHeadingColonCount).toBe(0);
    expect(shape.rejectedHeadingSequenceMismatchCount).toBe(0);
  });

  it('counts colon cores and freezes the sequence after a rejection', () => {
    const shape = summarizeProposalDeckAnswerShape(
      ['1. サービス概要', '2. 導入手順：詳細の説明', '3. 次のステップ'].join('\n'),
    );
    // 2件目は本体のコロンで拒否され連番が進まないため、3件目は連番不一致になる。
    expect(shape.rejectedHeadingCount).toBe(2);
    expect(shape.rejectedHeadingColonCount).toBe(1);
    expect(shape.rejectedHeadingSequenceMismatchCount).toBe(1);
    expect(shape.rejectedHeadingTooLongCount).toBe(0);
  });

  it('counts cores longer than 40 characters as too long', () => {
    const shape = summarizeProposalDeckAnswerShape(
      '1. あらかじめ用意された長い見出し文のテキストがここに入りますこれは四十文字を超える見出しです',
    );
    expect(shape.rejectedHeadingCount).toBe(1);
    expect(shape.rejectedHeadingTooLongCount).toBe(1);
    expect(shape.rejectedHeadingColonCount).toBe(0);
    expect(shape.rejectedHeadingSequenceMismatchCount).toBe(0);
  });

  it('counts markdown H2 rejections judged on the stripped core', () => {
    const shape = summarizeProposalDeckAnswerShape(
      [
        '## 1. サービス概要（Assumptions: 製品名は仮の「SmartLedger」、機能は一般的なクラウド会計に準拠）',
        '## 2. 料金プラン：詳細',
      ].join('\n'),
    );
    expect(shape.markdownHeadingCount).toBe(2);
    expect(shape.rejectedHeadingCount).toBe(1);
    expect(shape.rejectedHeadingColonCount).toBe(1);
  });

  it('keeps rejected-heading fields numeric only', () => {
    const shape = summarizeProposalDeckAnswerShape('## 2. 料金プラン：詳細\n3. 次のステップ');
    expect(Object.values(shape).every((value) => typeof value === 'number')).toBe(true);
    expect(JSON.stringify(shape)).not.toContain('料金プラン');
  });
});

describe('classifyProposalDeckParseFailureCode', () => {
  it('separates the no-headings case from the generic unmatched case', () => {
    expect(classifyProposalDeckParseFailureCode('構成案だけの自由文の回答です。')).toBe(
      'PROPOSAL_DECK_PARSE_NO_HEADINGS',
    );
    expect(classifyProposalDeckParseFailureCode(FREEFORM_SHAPE)).toBe(
      'PROPOSAL_DECK_SKELETON_NOT_MATCHED',
    );
    expect(classifyProposalDeckParseFailureCode(MARKDOWN_SHAPE)).toBe(
      'PROPOSAL_DECK_SKELETON_NOT_MATCHED',
    );
  });
});
