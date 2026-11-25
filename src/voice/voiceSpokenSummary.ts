import { splitSpeakableSentences, toSpeechText } from './voiceSpeech';

/**
 * Spoken summary script builder (VC-2, VOICE_CONVERSATION_DESIGN
 * 2026-11-18: "声で返すときは、テキストをそのまま読み上げるのでは
 * ない。内容を分かりやすく要約した話し言葉を話す。要約は最終文から
 * のみ作り、新しい主張を足さない").
 *
 * The summary is EXTRACTIVE by construction: it is assembled only
 * from whole sentences of the final, gate-passed answer text, in
 * their original order, after the same Markdown flattening the
 * read-aloud path uses. Nothing is paraphrased, merged, or invented,
 * so the spoken script can never carry a claim the final answer did
 * not make. Sentences are never cut in the middle — a cut could
 * change a claim's meaning — so a single over-long first sentence is
 * kept whole rather than truncated.
 *
 * A generative spoken-style rewrite (a model rewording the answer
 * into conversational Japanese) is deliberately NOT done here: it
 * would need its own no-new-claims gate before anything it produced
 * could be spoken, and that gate does not exist yet.
 */

export const SPOKEN_SUMMARY_MAX_SENTENCES = 3;
export const SPOKEN_SUMMARY_MAX_CHARS = 240;

export interface SpokenSummaryOptions {
  maxSentences?: number;
  maxChars?: number;
}

/**
 * Builds the spoken summary for a final answer. Returns '' when the
 * answer has nothing speakable (the caller then stays silent).
 *
 * Playback of the result starts with its first sentence the moment
 * speak() is called — the speech controller queues sentence by
 * sentence — so the summary never waits on anything beyond the
 * final answer itself. Callers that need a shorter spoken form
 * (conversation mode keeps answers short and leaves the detail in
 * the text on screen) pass tighter caps.
 */
export function buildSpokenSummary(finalAnswerText: string, options: SpokenSummaryOptions = {}): string {
  const maxSentences = options.maxSentences ?? SPOKEN_SUMMARY_MAX_SENTENCES;
  const maxChars = options.maxChars ?? SPOKEN_SUMMARY_MAX_CHARS;
  const sentences = splitSpeakableSentences(toSpeechText(finalAnswerText));
  const picked: string[] = [];
  let totalChars = 0;
  for (const sentence of sentences) {
    if (picked.length >= maxSentences) break;
    if (picked.length > 0 && totalChars + sentence.length > maxChars) break;
    picked.push(sentence);
    totalChars += sentence.length;
  }
  return picked.join(' ');
}
