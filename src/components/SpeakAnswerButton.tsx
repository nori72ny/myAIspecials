import { useSyncExternalStore } from 'react';
import { Square, Volume2 } from 'lucide-react';
import type { OriginLanguage } from '../i18n';
import {
  getVoiceOutputAvailability,
  subscribeVoiceOutputAvailability,
} from '../voice/voiceOutputAvailability';
import { voiceSpeech } from '../voice/voiceSpeech';

interface Props {
  /** The conversation message id; doubles as the playback id, so the
   * button of the answer being read is the one that shows "stop". */
  messageId: string;
  /** The answer text (Markdown). The speech controller flattens and
   * sentence-splits it before speaking. */
  text: string;
  language: OriginLanguage;
}

/**
 * "Listen" button on assistant answers (VC-1, VOICE_CONVERSATION_DESIGN
 * 2026-11-18). Renders only when the server switch proved on at startup
 * (availability store) and the device can actually speak — otherwise
 * the answer looks exactly as it did before VC-1 (fail closed). While
 * this answer is being read the button becomes "stop"; starting
 * another answer's playback replaces the current one.
 */
export default function SpeakAnswerButton({ messageId, text, language }: Props) {
  const availability = useSyncExternalStore(
    subscribeVoiceOutputAvailability,
    getVoiceOutputAvailability,
    getVoiceOutputAvailability,
  );
  const activeId = useSyncExternalStore(
    (listener) => voiceSpeech.subscribe(listener),
    () => voiceSpeech.getActiveId(),
    () => voiceSpeech.getActiveId(),
  );

  if (availability !== 'available' || !voiceSpeech.supported()) return null;

  const isActive = activeId === messageId;
  const label = isActive
    ? (language === 'ja' ? '停止' : 'Stop')
    : (language === 'ja' ? '読み上げ' : 'Listen');

  return (
    <button
      type="button"
      data-testid={`speak-answer-button-${messageId}`}
      aria-label={language === 'ja' ? (isActive ? '読み上げを止める' : 'この回答を読み上げる') : (isActive ? 'Stop reading' : 'Read this answer aloud')}
      aria-pressed={isActive}
      onClick={() => {
        if (isActive) voiceSpeech.stop();
        else voiceSpeech.speak(messageId, text);
      }}
      className="origin-secondary-button mt-3 inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-semibold"
    >
      {isActive
        ? <Square className="h-4 w-4" aria-hidden="true" />
        : <Volume2 className="h-4 w-4" aria-hidden="true" />}
      {label}
    </button>
  );
}
