import { splitSpeakableSentences } from './voiceSpeech';
import type { VoiceConversationTone } from './voiceConversationTone';

/**
 * Tone phrasing for the spoken summary (owner's real-device
 * finding, 2026-11-28: the conversation tone changed the voice's
 * rate and pitch but the WORDS stayed the same, so the tone could
 * not be felt).
 *
 * The summary itself stays extractive (voiceSpokenSummary.ts):
 * whole sentences of the gated final answer, never paraphrased.
 * This pass adjusts ONLY the sentence-final form of each
 * declarative sentence — the copula / auxiliary ending that
 * carries politeness and softness in Japanese:
 *
 * - strong: polite finals become plain declarative finals
 *   (です→だ, でした→だった, ではありません→ではない) and
 *   softening particles (よ/ね after ます) are dropped — shorter,
 *   more assertive.
 * - gentle: a softening よ is added to polite finals
 *   (です→ですよ, ます→ますよ) and ください becomes くださいね.
 * - polite: plain finals become 丁寧体 (だ→です, だった→でした,
 *   ではない→ではありません).
 * - everyday: no change — the answer's own phrasing, as before.
 *
 * The body of every sentence — its facts, numbers and sources —
 * is byte-identical before and after: the replacements match
 * only at the very end of a sentence, only against the fixed
 * ending table below, and verb stems are never rewritten (a ます
 * ending is left as ます under 'strong' rather than guessing the
 * verb's plain form). Questions and exclamations keep the
 * answer's own force. A katakana guard keeps loanwords that
 * happen to end in マス (クリスマス) out of the ます rules.
 *
 * Priority (the controller enforces it): while alter-ego mode is
 * on, the answer text already speaks in the owner's alter-ego
 * voice, and this pass is NOT applied — the persona outranks the
 * tone's phrasing. The tone's prosody (rate / pitch) still
 * applies, as it never touches the words.
 */

const SENTENCE_ENDINGS: readonly string[] = [
  'ではありませんでした',
  'ではありません',
  'ないです',
  'じゃない',
  'ではない',
  'ください',
  'でした',
  'だった',
  'である',
  'ですよ',
  'ですね',
  'ますよ',
  'ますね',
  'です',
  'ます',
  'だよ',
  'だ',
];

const PHRASING_BY_TONE: Record<VoiceConversationTone, Readonly<Record<string, string>>> = {
  strong: {
    'ではありませんでした': 'ではなかった',
    'ではありません': 'ではない',
    'ないです': 'ない',
    'でした': 'だった',
    'ですよ': 'だ',
    'ですね': 'だ',
    'です': 'だ',
    'ますよ': 'ます',
    'ますね': 'ます',
  },
  gentle: {
    'ではありませんでした': 'ではありませんでしたよ',
    'ではありません': 'ではありませんよ',
    'ないです': 'ないですよ',
    'でした': 'でしたよ',
    'です': 'ですよ',
    'ます': 'ますよ',
    'だった': 'だったよ',
    'だ': 'だよ',
    'ください': 'くださいね',
  },
  polite: {
    'だよ': 'ですよ',
    'だ': 'です',
    'である': 'です',
    'だった': 'でした',
    'ではない': 'ではありません',
    'じゃない': 'ではありません',
  },
  everyday: {},
};

const MASU_ENDINGS = new Set(['ます', 'ますよ', 'ますね']);
const KATAKANA = /[ァ-ヶー]/;

function phraseSentence(sentence: string, tone: VoiceConversationTone): string {
  const replacements = PHRASING_BY_TONE[tone];
  if (Object.keys(replacements).length === 0) return sentence;
  // Questions and exclamations keep the answer's own force.
  if (/[！？!?]$/.test(sentence)) return sentence;
  const hasTerminator = sentence.endsWith('。');
  const body = hasTerminator ? sentence.slice(0, -1) : sentence;
  for (const ending of SENTENCE_ENDINGS) {
    const replacement = replacements[ending];
    if (replacement === undefined || !body.endsWith(ending)) continue;
    if (MASU_ENDINGS.has(ending)) {
      const before = body.charAt(body.length - ending.length - 1);
      if (KATAKANA.test(before)) return sentence;
    }
    return body.slice(0, body.length - ending.length) + replacement + (hasTerminator ? '。' : '');
  }
  return sentence;
}

/** Applies the tone's sentence-final phrasing to an extractive
 * spoken summary. 'everyday' (and any empty input) returns the
 * summary unchanged. */
export function applySpokenTonePhrasing(summary: string, tone: VoiceConversationTone): string {
  if (!summary || tone === 'everyday') return summary;
  return splitSpeakableSentences(summary)
    .map((sentence) => phraseSentence(sentence, tone))
    .join(' ');
}
