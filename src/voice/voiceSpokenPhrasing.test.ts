import { describe, expect, it } from 'vitest';
import { applySpokenTonePhrasing } from './voiceSpokenPhrasing';

describe('applySpokenTonePhrasing', () => {
  it('strong: polite finals become plain declarative finals, facts untouched', () => {
    expect(applySpokenTonePhrasing('明日は晴れです。 気温は20度です。', 'strong'))
      .toBe('明日は晴れだ。 気温は20度だ。');
    expect(applySpokenTonePhrasing('今日は雨ではありません。', 'strong'))
      .toBe('今日は雨ではない。');
    expect(applySpokenTonePhrasing('昨日は雪でした。', 'strong'))
      .toBe('昨日は雪だった。');
    // Sources and numbers ride through byte-identically.
    expect(applySpokenTonePhrasing('出典はFrankfurterです。 レートは1ドル150円です。', 'strong'))
      .toBe('出典はFrankfurterだ。 レートは1ドル150円だ。');
  });

  it('gentle: softening particles join the finals', () => {
    expect(applySpokenTonePhrasing('明日は晴れです。気温は20度になります。', 'gentle'))
      .toBe('明日は晴れですよ。 気温は20度になりますよ。');
    expect(applySpokenTonePhrasing('窓を開けてください。', 'gentle'))
      .toBe('窓を開けてくださいね。');
    expect(applySpokenTonePhrasing('昨日は雪だった。', 'gentle'))
      .toBe('昨日は雪だったよ。');
  });

  it('polite: plain finals become 丁寧体', () => {
    expect(applySpokenTonePhrasing('明日は晴れだ。気温は20度だった。', 'polite'))
      .toBe('明日は晴れです。 気温は20度でした。');
    expect(applySpokenTonePhrasing('今日は雨ではない。', 'polite'))
      .toBe('今日は雨ではありません。');
    // Already polite text is left exactly as it is.
    expect(applySpokenTonePhrasing('明日は晴れです。', 'polite'))
      .toBe('明日は晴れです。');
  });

  it('everyday: the summary is returned unchanged', () => {
    const summary = '明日は晴れです。 気温は20度です。';
    expect(applySpokenTonePhrasing(summary, 'everyday')).toBe(summary);
    expect(applySpokenTonePhrasing('', 'strong')).toBe('');
  });

  it('questions and exclamations keep the answer\u2019s own force', () => {
    expect(applySpokenTonePhrasing('明日は晴れですか？', 'strong')).toBe('明日は晴れですか？');
    expect(applySpokenTonePhrasing('明日は晴れですか？', 'polite')).toBe('明日は晴れですか？');
  });

  it('does not mistake a katakana loanword ending for a verb ending', () => {
    // クリスマス ends in マス but is a noun: the gentle ます rule
    // must not turn it into クリスマスよ.
    expect(applySpokenTonePhrasing('プレゼントはクリスマス', 'gentle'))
      .toBe('プレゼントはクリスマス');
    expect(applySpokenTonePhrasing('今日はクリスマスです。', 'gentle'))
      .toBe('今日はクリスマスですよ。');
  });

  it('handles a final sentence without a terminator', () => {
    expect(applySpokenTonePhrasing('明日は晴れです', 'strong')).toBe('明日は晴れだ');
    expect(applySpokenTonePhrasing('明日は晴れだ', 'polite')).toBe('明日は晴れです');
  });
});
