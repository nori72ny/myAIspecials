import { useMemo, useSyncExternalStore } from 'react';
import { Mic, Square, Volume2, X } from 'lucide-react';
import type { OriginLanguage } from '../i18n';
import {
  getVoiceOutputAvailability,
  subscribeVoiceOutputAvailability,
} from '../voice/voiceOutputAvailability';
import {
  voiceConversation,
  type VoiceConversationController,
} from '../voice/voiceConversation';

interface Props {
  language: OriginLanguage;
  /** Injectable for tests; the app uses the shared controller. */
  controller?: VoiceConversationController;
}

/**
 * The "conversation" surface (VC-2, VOICE_CONVERSATION_DESIGN
 * 2026-11-18; entry shape decided by the owner 2026-11-25). Sits
 * with the other composer bands and renders only when the server
 * switch proved on at startup AND this device can both hear and
 * speak — otherwise the composer looks exactly as it did before
 * (fail closed, same discipline as the read-aloud button).
 *
 * The entry is a single button — microphone icon + 「オリンと会話」 —
 * and pressing it starts conversation mode at once: Orin speaks an
 * opening line and the first listening turn follows. Inside the
 * mode the loop runs itself (owner, 2026-11-27): a finished
 * utterance is sent at once — never placed in the composer — the
 * answer's summary is spoken, and the next listening turn opens on
 * its own. No button press stands between turns; the main button
 * follows the floor (finish / barge in / listen again), the status
 * line names whose turn it is in plain words, the conversation
 * ends with the stop button or the owner's spoken 「バイバイ、
 * オリン」, and the wake toggle arms the 「ハイ、オリン」 waiting
 * for when the conversation rests.
 */
export default function VoiceConversationBar({ language, controller = voiceConversation }: Props) {
  const availability = useSyncExternalStore(
    subscribeVoiceOutputAvailability,
    getVoiceOutputAvailability,
    getVoiceOutputAvailability,
  );
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );
  const supported = useMemo(() => controller.supported(), [controller]);

  if (availability !== 'available' || !supported) return null;

  const ja = language === 'ja';
  const { mode, phase, wakeWaiting, interimText, notice } = state;

  const noticeText = notice === 'daily-limit'
    ? (ja ? '今日の会話の上限に達しました' : 'You have reached today’s conversation limit')
    : notice === 'unsupported'
      ? (ja ? 'このブラウザでは会話を使えません' : 'Conversation is not available in this browser')
      : notice === 'permission-denied'
        ? (ja ? 'マイクの使用が許可されませんでした。ブラウザの設定でマイクを許可してください' : 'Microphone access was not allowed. Please allow the microphone in your browser settings')
        : notice === 'failed'
          ? (ja ? 'うまくいきませんでした。もう一度お試しください' : 'Something did not work. Please try again')
          : null;

  const noticeRow = noticeText && (
    <div data-testid="voice-conversation-notice" role="alert" className="mt-1 flex items-center justify-between gap-2">
      <span className="min-w-0 font-semibold">{noticeText}</span>
      <button
        type="button"
        aria-label={ja ? '閉じる' : 'Dismiss'}
        onClick={() => controller.clearNotice()}
        className="origin-secondary-button inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-sm font-semibold"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );

  if (mode === 'off') {
    return (
      <div data-testid="voice-conversation-bar" className="origin-surface-muted mb-2 rounded-xl px-3 py-2 text-sm">
        <div className="flex min-h-11 items-center">
          <button
            type="button"
            data-testid="voice-conversation-start"
            onClick={() => controller.pressMainButton()}
            className="origin-primary-button inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-semibold"
          >
            <Mic aria-hidden="true" size={16} />
            {ja ? 'オリンと会話' : 'Talk with Orin'}
          </button>
        </div>
        {noticeRow}
      </div>
    );
  }

  const statusText = phase === 'listening'
    ? (ja ? '聞き取り中です。話してください' : 'Listening — go ahead')
    : phase === 'thinking'
        ? (ja ? '考え中です' : 'Thinking…')
        : phase === 'speaking'
          ? (ja ? 'オリンが話しています' : 'Orin is speaking')
          : wakeWaiting
            ? (ja ? '「ハイ、オリン」と呼びかけてください' : 'Say "Hi, Orin" to start')
            : (ja ? '待機中です' : 'Standing by');

  const mainLabel = phase === 'listening'
    ? (ja ? '話し終える' : 'Done speaking')
    : phase === 'speaking'
      ? (ja ? '割り込んで話す' : 'Interrupt and speak')
      : phase === 'idle'
        ? (ja ? '話す' : 'Speak')
        : (ja ? '会話中' : 'In conversation');

  return (
    <div data-testid="voice-conversation-bar" className="origin-surface-muted mb-2 rounded-xl px-3 py-2 text-sm">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-semibold" role="status" aria-live="polite">
          {phase === 'listening'
            ? <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[var(--danger)]" />
            : phase === 'speaking'
              ? <Volume2 aria-hidden="true" size={16} className="shrink-0" />
              : <Mic aria-hidden="true" size={16} className="shrink-0" />}
          <span className="min-w-0 truncate">{statusText}</span>
        </span>
        <span className="flex shrink-0 gap-2">
          <button
            type="button"
            data-testid="voice-conversation-wake-toggle"
            aria-pressed={wakeWaiting}
            onClick={() => controller.setWakeWaiting(!wakeWaiting)}
            className="origin-secondary-button min-h-11 shrink-0 px-3 text-sm font-semibold"
          >
            {ja ? '呼びかけ待受' : 'Wake phrase'}
          </button>
          <button
            type="button"
            data-testid="voice-conversation-main"
            disabled={phase === 'thinking'}
            onClick={() => controller.pressMainButton()}
            className="origin-primary-button min-h-11 shrink-0 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mainLabel}
          </button>
          <button
            type="button"
            data-testid="voice-conversation-stop"
            aria-label={ja ? '会話を終える' : 'End conversation'}
            onClick={() => controller.stopConversation()}
            className="origin-secondary-button inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-sm font-semibold"
          >
            <Square aria-hidden="true" size={16} />
          </button>
        </span>
      </div>
      {phase === 'listening' && interimText && (
        <p data-testid="voice-conversation-interim" className="origin-muted m-0 mt-1 truncate text-sm">{interimText}</p>
      )}
      {phase === 'listening' && !interimText && (
        <p className="origin-muted m-0 mt-1 text-sm">{ja ? '終わるときは「バイバイ、オリン」と言ってください' : 'Say "Bye-bye, Orin" to end'}</p>
      )}
      {noticeRow}
    </div>
  );
}
