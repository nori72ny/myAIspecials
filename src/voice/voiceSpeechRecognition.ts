/**
 * Browser-standard speech recognition (VC-2 input route,
 * VOICE_CONVERSATION_DESIGN 2026-11-18 stage 2).
 *
 * A thin, injectable wrapper over the Web Speech API's
 * SpeechRecognition (Chrome/Edge: webkitSpeechRecognition; Safari
 * ships it behind the same webkit name). Recognition runs through
 * the browser's own machinery: ORIGIN's servers never see the audio,
 * and nothing — audio or transcript — is stored by this module. The
 * transcript is handed to the caller, which places it in the
 * composer for the owner to review and send themselves.
 *
 * Honest platform note (also in the design's benchmark-gap section):
 * on desktop Chrome the browser's recognition is backed by the
 * browser vendor's servers, not by on-device models; that is the
 * browser's own processing, exactly like the desktop-Chrome caveat
 * the design records for speechSynthesis voices. ORIGIN adds no
 * retention of its own on either side.
 */

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionErrorEventLike {
  error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionFactory = () => SpeechRecognitionLike | null;

interface SpeechRecognitionWindow {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

/** The browser's recognition constructor, or null when the browser
 * has none (Firefox, older browsers). Never throws. */
export function createBrowserSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as unknown as SpeechRecognitionWindow;
  const ctor = candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
  if (typeof ctor !== 'function') return null;
  try {
    return new (ctor as new () => SpeechRecognitionLike)();
  } catch {
    return null;
  }
}

export function speechRecognitionSupported(factory: SpeechRecognitionFactory = createBrowserSpeechRecognition): boolean {
  try {
    return factory() !== null;
  } catch {
    return false;
  }
}

export interface ExtractedTranscripts {
  /** Finalized text from this event (may be several results). */
  finalText: string;
  /** The current interim (not yet finalized) text. */
  interimText: string;
}

/**
 * Splits one recognition event into its final and interim text.
 * Only results from `resultIndex` onward are new; earlier results in
 * the list were already delivered by previous events when continuous
 * recognition is used. Each result contributes its first (best)
 * alternative.
 */
export function extractTranscripts(event: SpeechRecognitionEventLike): ExtractedTranscripts {
  let finalText = '';
  let interimText = '';
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result) continue;
    const alternative = result[0];
    const transcript = alternative?.transcript ?? '';
    if (!transcript) continue;
    if (result.isFinal) finalText += transcript;
    else interimText += transcript;
  }
  return { finalText, interimText };
}

/** The owner's wake phrase (2026-11-23): 「ハイ、オリン」. */
export const WAKE_PHRASE = 'ハイ、オリン';

/**
 * Normalizes heard text for wake-phrase matching: full/half width
 * unified, katakana folded to hiragana, and every separator
 * (spaces, punctuation) removed, so 「はい、オリン」「ハイ オリン」
 * and 「はいおりん」 all read the same.
 */
export function normalizeHeardText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[\s、。,．・ー!！?？]/g, '')
    .toLowerCase();
}

const NORMALIZED_WAKE_PHRASE = normalizeHeardText(WAKE_PHRASE);

export interface WakePhraseMatch {
  matched: boolean;
  /** What was heard after the wake phrase (may be ''). When the
   * owner says 「ハイ、オリン、明日の天気は」 in one breath, the
   * remainder is the start of their request. */
  remainder: string;
}

/**
 * Detects the wake phrase anywhere in the heard text. Matching runs
 * on the normalized form; the remainder is recovered from the
 * original text by length so the caller can seed the listening turn
 * with it.
 */
export function matchWakePhrase(heard: string): WakePhraseMatch {
  const normalized = normalizeHeardText(heard);
  const at = normalized.indexOf(NORMALIZED_WAKE_PHRASE);
  if (at < 0) return { matched: false, remainder: '' };
  // Map the normalized end position back onto the original string:
  // normalization only removes or folds characters, so walking the
  // original while counting normalized characters finds the cut.
  const endNormalized = at + NORMALIZED_WAKE_PHRASE.length;
  let counted = 0;
  let cut = heard.length;
  for (let index = 0; index < heard.length; index += 1) {
    if (counted >= endNormalized) {
      cut = index;
      break;
    }
    if (normalizeHeardText(heard[index]!).length > 0) counted += 1;
    if (index === heard.length - 1 && counted < endNormalized) cut = heard.length;
  }
  const remainder = heard.slice(cut).replace(/^[\s、。,．・]+/, '').trim();
  return { matched: true, remainder };
}
