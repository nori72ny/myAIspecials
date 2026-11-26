import { describe, expect, it } from 'vitest';
import { isSourcesOnlyPartialLead, reshapeReconstructionLanding, splitReconstructionLanding } from '../sourcesOnlyLanding';

const JA_RECONSTRUCTION = [
  '取得した出典の記述から、ご質問に関係する内容をそのままお伝えします。',
  '',
  '「8月の有効求人倍率は1.18倍でした。」 [S1](https://www.nikkei.com/example)',
  '「最新の公表は9月分です。」 [S2](https://www.mhlw.go.jp/example)',
  '',
  '## 出典',
  '- S1: 有効求人倍率（www.nikkei.com）',
  '  https://www.nikkei.com/example',
  '- S2: 一般職業紹介状況（www.mhlw.go.jp）',
  '  https://www.mhlw.go.jp/example',
].join('\n');

describe('isSourcesOnlyPartialLead (4-A)', () => {
  it('recognizes the Japanese partial-answer lead', () => {
    expect(isSourcesOnlyPartialLead('公開情報を2件取得しましたが、要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします。内容の詳細は各出典でご確認ください。')).toBe(true);
  });

  it('recognizes the English partial-answer lead', () => {
    expect(isSourcesOnlyPartialLead('I retrieved 2 public source(s), but a summarized answer could not be produced, so the confirmed scope and the source list follow.')).toBe(true);
  });

  it('rejects ordinary answer text', () => {
    expect(isSourcesOnlyPartialLead('参勤交代は、諸大名が江戸と領地を往復する制度です。')).toBe(false);
    expect(isSourcesOnlyPartialLead('')).toBe(false);
  });
});

describe('splitReconstructionLanding / reshapeReconstructionLanding (4-A)', () => {
  it('splits the packet-sentences landing into quotes and sources', () => {
    const split = splitReconstructionLanding(JA_RECONSTRUCTION);
    expect(split).not.toBeNull();
    expect(split!.quotesMarkdown).toContain('1.18倍');
    expect(split!.sourcesMarkdown).toContain('## 出典');
  });

  it('reshapes into status line, found heading, quotes, then sources', () => {
    const reshaped = reshapeReconstructionLanding(JA_RECONSTRUCTION, 'ja');
    expect(reshaped).not.toBeNull();
    const statusIndex = reshaped!.indexOf('要約した答えは作れませんでした');
    const headingIndex = reshaped!.indexOf('## 分かったこと（出典の記述）');
    const quoteIndex = reshaped!.indexOf('1.18倍');
    const sourcesIndex = reshaped!.indexOf('## 出典');
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(headingIndex).toBeGreaterThan(statusIndex);
    expect(quoteIndex).toBeGreaterThan(headingIndex);
    expect(sourcesIndex).toBeGreaterThan(quoteIndex);
    // 引用と出典は原文のまま（新しい事実を作らない）。
    expect(reshaped).toContain('「8月の有効求人倍率は1.18倍でした。」 [S1](https://www.nikkei.com/example)');
  });

  it('does not reshape a value-vote landing (starts with the answer line)', () => {
    const voteLanding = [
      '有効求人倍率の最新値は1.19倍です（複数の出典で一致）。',
      '',
      '「8月の有効求人倍率は1.18倍でした。」 [S1](https://www.nikkei.com/example)',
      '',
      '## 出典',
      '- S1: 有効求人倍率（www.nikkei.com）',
      '  https://www.nikkei.com/example',
    ].join('\n');
    expect(splitReconstructionLanding(voteLanding)).toBeNull();
  });

  it('does not reshape ordinary markdown or a lead without a sources section', () => {
    expect(splitReconstructionLanding('## 見出し\n\n本文です。')).toBeNull();
    expect(splitReconstructionLanding([
      '取得した出典の記述から、ご質問に関係する内容をそのままお伝えします。',
      '',
      '「引用です。」 [S1](https://example.com/a)',
    ].join('\n'))).toBeNull();
  });

  it('does not reshape when the middle block is not quote lines', () => {
    const notQuotes = [
      '取得した出典の記述から、ご質問に関係する内容をそのままお伝えします。',
      '',
      'これは引用ではない段落です。',
      '',
      '## 出典',
      '- S1: 例（example.com）',
      '  https://example.com/a',
    ].join('\n');
    expect(splitReconstructionLanding(notQuotes)).toBeNull();
  });
});
