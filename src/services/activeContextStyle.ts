import {
  classifyStyleScope,
  recordStyleEvidence,
  type StyleTurnDelta,
} from './activeContextGraph';

// ---------------------------------------------------------------------------
// Speaking-style analysis (owner persona follow-up, 2026-11-25).
//
// The owner's request: ORIGIN should pick up how he talks — his phrasing,
// sentence endings, sentence length, politeness, and whether he leads
// with the conclusion — from his actual use, and keep improving it, so
// that proxy answers and spoken answers feel like talking with him.
// Correcting the result by hand is his last resort, and then only a word
// or two; the accumulation therefore has to work on its own.
//
// This module is the deterministic, on-device analyzer for one user
// turn. Chat input and voice-conversation transcripts arrive through the
// same path — a voice turn is confirmed in the input field and sent as a
// chat message (VOICE_CONVERSATION_DESIGN 2026-11-18), so its transcript
// text is a user turn here, fillers and all — and both feed the same
// evidence. The analyzer emits COUNTS ONLY (see StyleTurnDelta): no
// sentence of the owner's is ever copied into a trait, so nothing he
// said — and in particular no tier-③ value (card number, PIN, password)
// — can be stored as "style". Accumulation, thresholds and storage live
// in activeContextGraph.ts (recordStyleEvidence).
//
// The analysis is deliberately a heuristic of surface patterns, in the
// spirit of the §8 matching: it notices tendencies over many turns and
// asserts nothing from a single utterance.
// ---------------------------------------------------------------------------

const MAX_STYLE_TEXT_CHARS = 4_000;

function splitSentences(text: string): string[] {
  return text
    .replace(/([。．.!！?？])\s*/g, '$1\n')
    .split(/\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 2);
}

// Sentence-final form classification. Polite is checked first: the plain
// list contains forms (ない, した) that also appear inside polite
// sentences, while a です/ます ending is unambiguous. Questions count by
// their inner form (ですか is polite; a bare か is neither).
const POLITE_ENDING = /(?:です|ます|でした|ました|ません|ましょう|でしょう|ください|なさい)[。．]?\s*$/;
const PLAIN_ENDING = /(?:だ|である|だった|した|する|なる|ある|いる|ない|たい|ようだ|そうだ|はずだ|べきだ|のか|だよ|だね|よね|よな)[。．]?\s*$/;

// Conclusion / reason markers for the order vote. One vote per turn at
// most: the FIRST conclusion marker and the FIRST reason marker decide,
// so a long message cannot outvote several short ones.
const CONCLUSION_MARKERS: readonly RegExp[] = [
  /(?:結論(?:は|から|を先に)|まず結論|先に結論|要するに|つまり|したがって|結局のところ)/,
];
const REASON_MARKERS: readonly RegExp[] = [
  /(?:理由は|なぜなら|おかげで|せいで)/,
  /(?:ので|から)[、,。．]\s*[^。．]{0,40}(?:結論|要するに|つまり)/,
];

// Characteristic phrases, from a curated list only. Openers and fillers
// are matched at a sentence start (voice transcripts carry the owner's
// えー/あー/うーん, which are part of how he talks); closers and set
// phrases are matched anywhere in a sentence. A phrase counts once per
// turn however often it appears — frequency across turns is the signal,
// not repetition inside one message.
const OPENER_PHRASES: readonly string[] = [
  'えー', 'あー', 'うーん', 'まあ', 'まず', '実は', '正直', '結局', '要は', 'ちなみに', 'それで', 'あと',
];
const SET_PHRASES: readonly string[] = [
  'ですね', 'ですよね', 'だよね', 'だね', 'よね', 'と思います', 'と思う',
  'してほしい', 'お願いします', 'という感じ', 'みたいな', '感じで', 'ということで',
];
// かな is matched at a sentence end only: as a bare substring it also
// fires inside unrelated words (なかなか).
const KANA_ENDING = /かな[。．]?\s*$/;

function classifyEnding(sentence: string): 'polite' | 'plain' | 'other' {
  if (POLITE_ENDING.test(sentence)) return 'polite';
  if (PLAIN_ENDING.test(sentence)) return 'plain';
  return 'other';
}

function observedPhrases(sentences: string[]): string[] {
  const found = new Set<string>();
  for (const sentence of sentences) {
    const head = sentence.replace(/^[、,・：:\s]+/u, '');
    for (const phrase of OPENER_PHRASES) {
      if (head === phrase || head.startsWith(`${phrase}、`) || head.startsWith(`${phrase}、`)) found.add(phrase);
    }
    for (const phrase of SET_PHRASES) {
      if (sentence.includes(phrase)) found.add(phrase);
    }
    if (KANA_ENDING.test(sentence)) found.add('かな');
  }
  return [...found];
}

/**
 * Analyzes one user turn into style evidence (counts only). Returns null
 * when the turn carries no usable sentence at all.
 */
export function analyzeSpeakingStyleTurn(userText: string): StyleTurnDelta | null {
  const text = typeof userText === 'string' ? userText.slice(0, MAX_STYLE_TEXT_CHARS) : '';
  const sentences = splitSentences(text);
  if (!sentences.length) return null;

  const politeness = { polite: 0, plain: 0, other: 0 };
  let lengthChars = 0;
  for (const sentence of sentences) {
    politeness[classifyEnding(sentence)] += 1;
    lengthChars += sentence.replace(/[。．.!！?？\s]/g, '').length;
  }

  let order: StyleTurnDelta['order'];
  if (sentences.length >= 2) {
    const conclusionAt = sentences.findIndex((sentence) => CONCLUSION_MARKERS.some((pattern) => pattern.test(sentence)));
    const reasonAt = sentences.findIndex((sentence) => REASON_MARKERS.some((pattern) => pattern.test(sentence)));
    if (conclusionAt >= 0 && reasonAt >= 0 && conclusionAt !== reasonAt) {
      order = conclusionAt < reasonAt
        ? { conclusionFirst: 1, reasonFirst: 0 }
        : { conclusionFirst: 0, reasonFirst: 1 };
    }
  }

  return {
    scope: classifyStyleScope(text),
    politeness,
    length: { sentences: sentences.length, chars: lengthChars },
    ...(order ? { order } : {}),
    phrases: observedPhrases(sentences),
  };
}

/**
 * Ingestion entry point: analyze the turn and accumulate the evidence
 * into the on-device store. Fail-safe like the rest of the ingestion
 * path — style observation must never affect the chat turn — and adds no
 * network requests.
 */
export async function observeSpeakingStyle(userId: string, userText: string): Promise<void> {
  try {
    const delta = analyzeSpeakingStyleTurn(userText);
    if (!delta) return;
    await recordStyleEvidence(userId, delta);
  } catch {
    // Ignored by design (see above).
  }
}
