import { describe, expect, it } from 'vitest';
import {
  createBrowserSpeechRecognition,
  END_PHRASE,
  extractTranscripts,
  matchEndPhrase,
  matchWakePhrase,
  normalizeHeardText,
  speechRecognitionSupported,
  type SpeechRecognitionEventLike,
} from './voiceSpeechRecognition';

function resultEvent(entries: Array<{ isFinal: boolean; transcript: string }>, resultIndex = 0): SpeechRecognitionEventLike {
  const results = entries.map((entry) => {
    const result: { isFinal: boolean; length: number; [index: number]: { transcript: string } } = {
      isFinal: entry.isFinal,
      length: 1,
    };
    result[0] = { transcript: entry.transcript };
    return result;
  });
  return { resultIndex, results };
}

describe('extractTranscripts', () => {
  it('splits final and interim results', () => {
    const extracted = extractTranscripts(resultEvent([
      { isFinal: true, transcript: '明日の天気は' },
      { isFinal: false, transcript: '晴れですか' },
    ]));
    expect(extracted.finalText).toBe('明日の天気は');
    expect(extracted.interimText).toBe('晴れですか');
  });

  it('only reads results from resultIndex onward', () => {
    const extracted = extractTranscripts(resultEvent([
      { isFinal: true, transcript: '前に届いた分' },
      { isFinal: true, transcript: '新しい分' },
    ], 1));
    expect(extracted.finalText).toBe('新しい分');
  });

  it('tolerates missing alternatives', () => {
    const event: SpeechRecognitionEventLike = {
      resultIndex: 0,
      results: [{ isFinal: true, length: 0 }],
    };
    expect(extractTranscripts(event)).toEqual({ finalText: '', interimText: '' });
  });
});

describe('normalizeHeardText', () => {
  it('folds katakana and strips separators', () => {
    expect(normalizeHeardText('ハイ、オリン')).toBe('はいおりん');
    expect(normalizeHeardText('はい オリン！')).toBe('はいおりん');
  });
});

describe('matchWakePhrase', () => {
  it('matches the plain phrase', () => {
    expect(matchWakePhrase('ハイ、オリン').matched).toBe(true);
    expect(matchWakePhrase('はいおりん').matched).toBe(true);
  });

  it('matches when the phrase leads a request and returns the remainder', () => {
    const match = matchWakePhrase('ハイ、オリン、明日の天気を教えて');
    expect(match.matched).toBe(true);
    expect(match.remainder).toBe('明日の天気を教えて');
  });

  it('does not match unrelated speech', () => {
    expect(matchWakePhrase('今日はいい天気ですね').matched).toBe(false);
    expect(matchWakePhrase('はい、お願いします').matched).toBe(false);
  });
});

describe('matchEndPhrase', () => {
  it('is the owner-corrected phrase 「バイバイ、オリン」', () => {
    expect(END_PHRASE).toBe('バイバイ、オリン');
  });

  it('matches the plain phrase and its spelling variants', () => {
    expect(matchEndPhrase('バイバイ、オリン')).toBe(true);
    expect(matchEndPhrase('バイバイ オリン')).toBe(true);
    expect(matchEndPhrase('ばいばいおりん')).toBe(true);
    expect(matchEndPhrase('バイバイ、オリン。')).toBe(true);
  });

  it('matches when one short farewell follows the phrase', () => {
    expect(matchEndPhrase('バイバイ、オリン、ありがとう')).toBe(true);
    expect(matchEndPhrase('バイバイ、オリン、またね')).toBe(true);
    expect(matchEndPhrase('バイバイ、オリン、おやすみ')).toBe(true);
  });

  it('does not match the shorter 「バイ、オリン」 on its own', () => {
    expect(matchEndPhrase('バイ、オリン')).toBe(false);
    expect(matchEndPhrase('ばいおりん')).toBe(false);
  });

  it('does not match the phrase mentioned inside a sentence', () => {
    expect(matchEndPhrase('バイバイ、オリンってどういう意味？')).toBe(false);
    expect(matchEndPhrase('バイバイ、オリン、今日の天気は？')).toBe(false);
    expect(matchEndPhrase('バイオリンの練習をした')).toBe(false);
  });

  it('does not match unrelated speech', () => {
    expect(matchEndPhrase('ありがとう')).toBe(false);
    expect(matchEndPhrase('またね')).toBe(false);
    expect(matchEndPhrase('')).toBe(false);
  });
});

describe('browser factory', () => {
  it('reports unsupported in an environment without the constructor', () => {
    expect(createBrowserSpeechRecognition()).toBeNull();
    expect(speechRecognitionSupported()).toBe(false);
  });

  it('reports supported when the factory yields an instance', () => {
    expect(speechRecognitionSupported(() => ({
      lang: '', continuous: false, interimResults: false,
      onresult: null, onend: null, onerror: null,
      start() {}, stop() {}, abort() {},
    }))).toBe(true);
  });
});
