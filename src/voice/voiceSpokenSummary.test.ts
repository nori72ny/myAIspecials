import { describe, expect, it } from 'vitest';
import {
  buildSpokenSummary,
  SPOKEN_SUMMARY_MAX_CHARS,
  SPOKEN_SUMMARY_MAX_SENTENCES,
} from './voiceSpokenSummary';

describe('buildSpokenSummary', () => {
  it('keeps a short answer whole', () => {
    expect(buildSpokenSummary('こんにちは。お手伝いします。')).toBe('こんにちは。 お手伝いします。');
  });

  it('takes at most the configured number of lead sentences', () => {
    const text = '一文目です。二文目です。三文目です。四文目です。五文目です。';
    const summary = buildSpokenSummary(text);
    const sentences = summary.split(' ').filter(Boolean);
    expect(sentences).toHaveLength(SPOKEN_SUMMARY_MAX_SENTENCES);
    expect(summary).toContain('一文目です。');
    expect(summary).not.toContain('四文目です。');
  });

  it('stops before exceeding the character budget once it has a sentence', () => {
    const longSentence = `${'あ'.repeat(150)}です。`;
    const summary = buildSpokenSummary(`${longSentence}${longSentence}${longSentence}`);
    expect(summary.length).toBeLessThanOrEqual(SPOKEN_SUMMARY_MAX_CHARS + 1);
    expect(summary).toBe(longSentence);
  });

  it('never cuts a single over-long first sentence in the middle', () => {
    const longSentence = `${'い'.repeat(400)}です。`;
    expect(buildSpokenSummary(longSentence)).toBe(longSentence);
  });

  it('contains only sentences that appear verbatim in the source answer', () => {
    const answer = '東京の人口は約1400万人です。これは都道府県で最も多い数です。次に多いのは神奈川県です。';
    const summary = buildSpokenSummary(answer);
    for (const sentence of summary.split(' ').filter(Boolean)) {
      expect(answer).toContain(sentence);
    }
  });

  it('strips Markdown dressing instead of speaking it', () => {
    const summary = buildSpokenSummary('## 見出し\n**結論**は次のとおりです。詳しくは[資料](https://example.com)を見てください。');
    expect(summary).not.toContain('#');
    expect(summary).not.toContain('*');
    expect(summary).not.toContain('https://');
    expect(summary).toContain('結論は次のとおりです。');
  });

  it('honors tighter caps passed by the caller (conversation mode)', () => {
    const text = '一文目です。二文目です。三文目です。';
    expect(buildSpokenSummary(text, { maxSentences: 2 })).toBe('一文目です。 二文目です。');
    expect(buildSpokenSummary(text, { maxChars: 11 })).toBe('一文目です。');
  });

  it('returns an empty string when nothing is speakable', () => {
    expect(buildSpokenSummary('')).toBe('');
    expect(buildSpokenSummary('```\nconst x = 1;\n```')).toBe('');
  });
});
