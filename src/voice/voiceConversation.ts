import {
  createBrowserSpeechRecognition,
  extractTranscripts,
  matchEndPhrase,
  matchWakePhrase,
  type SpeechRecognitionFactory,
  type SpeechRecognitionLike,
} from './voiceSpeechRecognition';
import { buildSpokenSummary } from './voiceSpokenSummary';
import { applySpokenTonePhrasing } from './voiceSpokenPhrasing';
import {
  getStoredVoiceConversationTone,
  resolveStoredVoiceConversationStyle,
  type VoiceConversationTone,
} from './voiceConversationTone';
import {
  getStoredVoiceConversationStartStyle,
  type VoiceConversationStartStyle,
} from './voiceConversationStartStyle';
import {
  getStoredWakeWaitingPreference,
  setStoredWakeWaitingPreference,
} from './voiceWakeWaitingPreference';
import { voiceSpeech, type SpeechStyleOptions, type VoiceStorageLike } from './voiceSpeech';
import { readAlterEgoEnabled } from '../hooks/usePersonalSettings';

/**
 * Voice conversation controller (VC-2 + the reachable part of VC-3,
 * VOICE_CONVERSATION_DESIGN 2026-11-18; conversation design owned by
 * the voice specialist: turn-taking, barge-in, pacing).
 *
 * Persona premise (owner, corrected 2026-11-25 20:57): Orin is
 * the owner's proxy — close to an alter ego, but never the owner
 * himself and never claiming to be. In conversation with the owner
 * Orin stays the natural companion it has always been in this
 * design; answers about the owner's own information are phrased by
 * the answer layer in the owner's tone, as his representative.
 * This voice layer carries that phrasing unchanged, because it
 * only ever voices the gated final answer and never rewords
 * content.
 *
 * Owns the turn-taking state machine for talking with Orin:
 *
 *   listening → (final transcript) → sent at once → thinking →
 *   (final answer) → speaking → (playback ends) → listening → …
 *
 * The rules that shape it, all from the owner's standing orders:
 *
 * - Send at once (owner, 2026-11-27 20:58 / 21:00). When a
 *   listening turn ends with a transcript, the utterance is handed
 *   to the chat surface's send pipeline (via onUtterance) in the
 *   same tick — it never lands in the composer and no send tap
 *   stands anywhere in the loop. The floor then passes to the
 *   answer through the chat surface's own glue (notifyUserSent
 *   when the user message lands). What guards against mis-sends
 *   now: only a non-empty final transcript is ever handed over,
 *   empty / silent / failed turns are never sent (the microphone
 *   simply reopens, then rests), an offline handover is refused
 *   by the chat surface and drops the utterance with a notice,
 *   and every sent utterance is visible in the history as an
 *   ordinary user message. The composer dictation entry (the mic
 *   button, useVoiceInput) is a different door — text entry, not
 *   conversation — and keeps its review-then-send shape.
 * - Speak only the gated final answer's summary. Playback input is
 *   buildSpokenSummary(finalAnswer) — extractive, no new claims —
 *   kept short on purpose (two lead sentences; the detail stays in
 *   the text on screen). Speed is a first-class requirement (owner,
 *   2026-11-25): recognition is the browser's own (no server
 *   round-trip, interim results show as they arrive), the summary
 *   is built deterministically in the same tick the final answer
 *   lands, and playback starts with the first sentence immediately
 *   because the speech controller queues sentence by sentence
 *   instead of waiting for a whole script. No confirmation screens
 *   or extra steps sit anywhere in the loop.
 * - Barge-in by tap. While Orin is speaking, pressing the main
 *   button stops playback at once and opens the microphone for the
 *   owner's next turn. Voice-activity barge-in (listening while
 *   speaking) is NOT attempted: recognition and synthesis share the
 *   device audio path, Orin's own voice would be heard as input,
 *   and the free/on-device parts cannot do the full-duplex
 *   separation ChatGPT Voice does. That gap is recorded in the
 *   design document and stays open.
 * - Orin opens. Entering conversation mode never waits silently
 *   for the owner: Orin speaks a fixed opening line first ("the
 *   conversation" entry, owner decision 2026-11-25), and the first
 *   listening turn follows as soon as the opening ends. The opening
 *   is a greeting, not an answer — it makes no claims and is never
 *   derived from chat content.
 * - Wake phrase 「ハイ、オリン」. While wake waiting is on, short
 *   recognition sessions run only to hear the phrase (app open
 *   only — a web app cannot listen while locked or closed).
 *   Anything heard that is not the phrase is discarded on the spot:
 *   never placed in the composer, never stored, never sent anywhere.
 * - No single fragile signal owns a floor handover (hardened
 *   2026-11-27 after the first real-device run stalled). Playback
 *   completion is assured inside the speech controller on three
 *   paths (utterance events, speaking/pending poll, duration
 *   watchdog), because Android Chrome drops utterance end events.
 *   Opening a listening turn retries transient failures — a
 *   recognizer start() that throws right after playback, an
 *   'audio-capture'/'network' session error — with backoff before
 *   resting, because the audio path is briefly contended exactly
 *   at that moment; permission errors still fail closed at once.
 *   And every completed answer settles the floor through the chat
 *   glue: speakable answers via notifyAnswerReady, answers that
 *   will not be spoken (research, errors) via notifyAnswerSettled,
 *   so 'thinking' can never be left holding the floor silently.
 * - End phrase 「バイバイ、オリン」 (owner, 2026-11-27 21:42,
 *   phrase corrected 21:50). During
 *   a conversation, a listening turn whose whole utterance is the
 *   end phrase — a short farewell may follow it — is never sent
 *   and never counts toward the daily cap: the conversation
 *   closes through exactly the stop button's transition, with a
 *   fixed closing line spoken on the way out. Matching is strict
 *   on purpose (matchEndPhrase): the phrase mentioned inside a
 *   sentence is an ordinary utterance and is sent as usual, and
 *   outside a conversation the phrase does nothing at all.
 * - Caps: one listening turn ends at 60 seconds; at most 40
 *   transcript-producing turns per day (client-side counter storing
 *   only the date and the count — no content).
 * - Nothing is stored: no audio, no transcripts, no summaries. The
 *   only persisted value is the daily counter above.
 */

/** Playback id for the opening greeting, so it never looks like an
 * answer is being read. */
export const VOICE_CONVERSATION_OPENING_ID = 'orin-conversation-opening';
/** The fixed opening line Orin speaks when conversation mode
 * starts. A greeting only — no claims, no chat content. */
export const ORIN_CONVERSATION_OPENING_TEXT = 'こんにちは、オリンです。何をお手伝いしましょうか？';

/** Playback id for the closing line, mirroring the opening's, so
 * it never looks like an answer is being read. */
export const VOICE_CONVERSATION_CLOSING_ID = 'orin-conversation-closing';
/** The fixed closing line Orin speaks when the owner ends the
 * conversation with the end phrase. A farewell only — no claims,
 * no chat content. */
export const ORIN_CONVERSATION_CLOSING_TEXT = 'はい、またいつでも呼んでください。';

/** Playback id for the immediate acknowledgment, mirroring the
 * opening's, so it never looks like an answer is being read. */
export const VOICE_CONVERSATION_ACK_ID = 'orin-conversation-ack';
/** Fixed acknowledgment lines spoken the moment a spoken turn has
 * been accepted for sending (speed program, 2026-11-28: the owner
 * asked for replies "as fast as actually talking"). A backchannel
 * only — no claims, no chat content, nothing generated — so it
 * stands outside the answer gate exactly like the opening greeting:
 * the answer itself is still spoken only after the verified final
 * answer completes. The lines rotate so consecutive turns do not
 * repeat the same word. An empty list (via deps) disables the
 * acknowledgment entirely. */
export const ORIN_CONVERSATION_ACK_PHRASES: readonly string[] = ['はい。', 'うん。', 'なるほど。', '分かりました。'];

/** Alter-ego variants of the two fixed lines (owner's real-device
 * finding, 2026-11-28: with alter-ego mode on, the greeting and
 * the farewell still sounded like the default Orin). The wording
 * follows the alter-ego persona (alterEgoPersona.ts): first person
 * 「僕」, casual with the owner (タメ口), frank and brief. A
 * greeting / farewell only — no claims, no chat content, exactly
 * like the default lines. With the mode off, the default lines
 * above are spoken, unchanged. */
export const ORIN_CONVERSATION_OPENING_TEXT_ALTER_EGO = 'やあ、僕だよ。何か話したいことある？';
export const ORIN_CONVERSATION_CLOSING_TEXT_ALTER_EGO = 'じゃあ、またいつでも呼んで。';

export const VOICE_CONVERSATION_MAX_TURN_SECONDS = 60;
export const VOICE_CONVERSATION_DAILY_LIMIT = 40;
export const VOICE_CONVERSATION_DAILY_STORAGE_KEY = 'origin_voice_conversation_daily_v1';
/** Beat between one side finishing and the other starting. Kept as
 * short as safely possible (owner, 2026-11-25: speed first, no
 * unnecessary gaps) — just enough for the device audio path to
 * settle so the microphone does not catch the tail of Orin's own
 * voice. */
export const VOICE_CONVERSATION_NEXT_TURN_DELAY_MS = 150;
/** Conversation answers stay short when spoken (design: the detail
 * remains in the text on screen): at most two lead sentences of the
 * final answer, and a tighter character budget than read-aloud. */
export const VOICE_CONVERSATION_SUMMARY_MAX_SENTENCES = 2;
export const VOICE_CONVERSATION_SUMMARY_MAX_CHARS = 160;
const WAKE_RESTART_DELAY_MS = 300;
/** Backoff for reopening a WAKE session after a transient failure
 * (a recognizer 'network'/'audio-capture' error, or start()
 * throwing). Wake sessions are short and cycle constantly, so a
 * transient error is routine — the previous behaviour (one error
 * permanently disarmed standby, silently) is why the wake phrase
 * stopped answering on the owner's device (2026-11-28). Retries
 * widen to a 10-second cap, so a genuinely broken recognizer is
 * retried at most six times a minute, never in a hot loop; a
 * session that ends normally (or hears anything) resets the
 * count. Permission errors still disarm at once. */
const WAKE_RETRY_DELAYS_MS = [1000, 3000, 10000];
/** After this many consecutive wake failures the failure is
 * surfaced as a notice — standby keeps retrying at the cap. */
const WAKE_FAILURE_NOTICE_THRESHOLD = 3;
/** Consecutive silent listening sessions tolerated before the
 * controller rests at idle instead of reopening the microphone
 * forever. Any heard turn resets the count. */
const MAX_EMPTY_RESTARTS = 5;
/** Backoff for reopening a listening turn after a transient
 * start failure (start() throwing, or a session error such as
 * 'audio-capture'/'network' right after playback). Three retries
 * ride out the audio-path contention that follows speech on
 * Android; after that the conversation rests with a notice
 * instead of looping against a broken recognizer. */
export const VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS: readonly number[] = [400, 1000, 2000];

export type VoiceConversationPhase = 'idle' | 'listening' | 'thinking' | 'speaking';
export type VoiceConversationNotice = 'daily-limit' | 'unsupported' | 'permission-denied' | 'failed';

export interface VoiceConversationState {
  mode: 'off' | 'on';
  phase: VoiceConversationPhase;
  wakeWaiting: boolean;
  interimText: string;
  notice: VoiceConversationNotice | null;
  turnsUsedToday: number;
  dailyLimitReached: boolean;
}

export interface VoiceConversationSpeech {
  speak(id: string, text: string, style?: SpeechStyleOptions): boolean;
  stop(): void;
  getActiveId(): string | null;
  subscribe(listener: () => void): () => void;
  supported(): boolean;
}

/**
 * How Orin sounds in conversation: speech rate / pitch overrides
 * handed to the speech controller per playback. The app-wide
 * controller resolves this from the owner's chosen tone pattern
 * (強い／優しい／丁寧／日常 — voiceConversationTone.ts, owner
 * decision 2026-11-25: presets to switch between, not an imitation
 * of the owner's own voice). The resolver shape is also the
 * connection point for any future profile source. The default
 * below — ordinary, natural Japanese delivery with a slight pitch
 * lift that takes the flat, mechanical edge off device voices —
 * applies when nothing is resolved. Real-device tuning of these
 * numbers is part of the activation checks.
 */
export interface VoiceConversationStyleProfile {
  rate?: number;
  pitch?: number;
}

export const DEFAULT_VOICE_CONVERSATION_STYLE: VoiceConversationStyleProfile = {
  pitch: 1.05,
};

export interface VoiceConversationDeps {
  createRecognition?: SpeechRecognitionFactory;
  speech?: VoiceConversationSpeech;
  buildSummary?: (finalAnswerText: string) => string;
  storage?: () => VoiceStorageLike | null;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
  /** Receives each finalized utterance for immediate sending
   * through the chat surface's normal send pipeline. Returns true
   * when the surface accepted the utterance; false (or no handler
   * at all) drops the utterance — the conversation rests instead
   * of waiting for an answer that will never come. */
  onUtterance?: (text: string) => boolean;
  /** Overrides the opening line (tests, future localization). */
  openingText?: string;
  /** Overrides the acknowledgment lines (tests, future settings).
   * An empty list disables the immediate acknowledgment. */
  ackPhrases?: readonly string[];
  /** Whether the owner's alter-ego mode is on, consulted at each
   * playback of the fixed lines (opening / closing) — the same
   * resolver discipline as styleProfile below, so flipping the
   * settings toggle takes effect from the next fixed line without
   * rebuilding the controller. Absent, or false, keeps the default
   * Orin's lines exactly as before. */
  alterEgoActive?: () => boolean;
  /** The speaking-style profile, or a resolver consulted at each
   * playback (so a profile that appears later — e.g. the owner's
   * saved speaking style — is picked up without rebuilding the
   * controller). Null from a resolver means the default profile. */
  styleProfile?: VoiceConversationStyleProfile | (() => VoiceConversationStyleProfile | null);
  /** The stored conversation tone, consulted when a spoken
   * summary is built: the tone shapes the summary's
   * sentence-final phrasing (voiceSpokenPhrasing.ts), on top of
   * the prosody the styleProfile already carries. Null (or no
   * resolver) means the everyday tone — no phrasing change. While
   * alter-ego mode is on the phrasing pass is skipped entirely:
   * the persona's own voice outranks the tone's wording. */
  conversationTone?: () => VoiceConversationTone | null;
  /** How the conversation starts (owner choice, 2026-11-28):
   * 'greeting' speaks the opening line first (the default, and
   * the behaviour the conversation has always had); 'listen'
   * skips the greeting and opens the microphone at once. A
   * resolver is consulted at each start, mirroring styleProfile,
   * so the settings choice applies from the next conversation
   * without rebuilding the controller. Null means 'greeting'. */
  startStyle?: VoiceConversationStartStyle | (() => VoiceConversationStartStyle | null);
  /** The owner's stored wake-waiting preference (the 呼びかけ待受
   * toggle), consulted when a conversation ends: while the
   * preference is on, ending a conversation rests back into
   * standby instead of switching the mode fully off, so the wake
   * phrase can start the next conversation. Absent means the
   * preference is off and endings behave exactly as before. */
  wakeWaitingPreferred?: () => boolean;
  /** Persists the wake-waiting toggle whenever it changes,
   * including the forced disarm on a microphone-permission
   * failure (standby stays off until the owner re-enables it
   * after fixing the permission, instead of re-arming into the
   * same failure on every load). */
  onWakeWaitingChange?: (enabled: boolean) => void;
}

const INITIAL_STATE: VoiceConversationState = {
  mode: 'off',
  phase: 'idle',
  wakeWaiting: false,
  interimText: '',
  notice: null,
  turnsUsedToday: 0,
  dailyLimitReached: false,
};

function localDateKey(nowMs: number): string {
  const date = new Date(nowMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

type SessionKind = 'turn' | 'wake';

export class VoiceConversationController {
  private readonly deps: VoiceConversationDeps;
  private readonly listeners = new Set<() => void>();
  private state: VoiceConversationState = { ...INITIAL_STATE };
  private recognition: SpeechRecognitionLike | null = null;
  /** The support-probe instance created when the conversation
   * starts; the first session (whichever kind runs first) consumes
   * it instead of creating another. */
  private preparedFirstRecognition: SpeechRecognitionLike | null = null;
  private sessionId = 0;
  private sessionKind: SessionKind | null = null;
  private accumulatedFinal = '';
  private seedText = '';
  private emptyRestarts = 0;
  /** True once the current speaking phase has actually been observed
   * with a live playback id. speak() passes through a momentary
   * "no active id" state while it replaces the previous playback;
   * only an observed-then-finished playback counts as finished. */
  private speakingObservedActive = false;
  /** Rotation counter for the acknowledgment lines, so consecutive
   * turns do not repeat the same word. */
  private ackCount = 0;
  /** True while an acknowledgment playback is in flight. The floor
   * must not reopen the microphone over its tail (the recognizer
   * would hear Orin's own backchannel), so a floor return that
   * lands during an acknowledgment is deferred until it ends. */
  private ackActive = false;
  /** True once the acknowledgment has actually been observed with
   * its playback id. speak() passes through a momentary "no active
   * id" state while it sets up (the same trap speakingObservedActive
   * guards for answers); only an observed-then-finished
   * acknowledgment counts as finished. */
  private ackObservedActive = false;
  /** A floor return was requested while the acknowledgment was
   * still playing; performed when the acknowledgment ends. */
  private floorReturnPending = false;
  /** Consecutive failed attempts to open the current listening
   * turn; reset whenever a fresh floor opens a turn and whenever
   * a session actually hears something. */
  private turnStartRetries = 0;
  /** Consecutive failed wake-session openings; drives the
   * WAKE_RETRY_DELAYS_MS backoff and resets whenever a wake
   * session ends normally or hears anything. */
  private wakeRetryCount = 0;
  private pendingTimer: unknown = null;
  private turnCapTimer: unknown = null;
  private unsubscribeSpeech: (() => void) | null = null;
  private disposed = false;

  constructor(deps: VoiceConversationDeps = {}) {
    this.deps = deps;
    this.state.turnsUsedToday = this.readDailyCount();
    this.state.dailyLimitReached = this.state.turnsUsedToday >= VOICE_CONVERSATION_DAILY_LIMIT;
    this.unsubscribeSpeech = this.speech().subscribe(() => this.handleSpeechActivityChange());
  }

  // -- Dependencies ---------------------------------------------------

  private speech(): VoiceConversationSpeech {
    return this.deps.speech ?? voiceSpeech;
  }

  private resolveStyle(): SpeechStyleOptions {
    const profile = typeof this.deps.styleProfile === 'function'
      ? this.deps.styleProfile()
      : this.deps.styleProfile;
    return profile ?? DEFAULT_VOICE_CONVERSATION_STYLE;
  }

  private createRecognition(): SpeechRecognitionLike | null {
    try {
      return (this.deps.createRecognition ?? createBrowserSpeechRecognition)();
    } catch {
      return null;
    }
  }

  private storage(): VoiceStorageLike | null {
    try {
      if (this.deps.storage) return this.deps.storage();
      if (typeof window === 'undefined') return null;
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private schedule(fn: () => void, ms: number): void {
    this.clearPendingTimer();
    const run = () => {
      this.pendingTimer = null;
      fn();
    };
    this.pendingTimer = this.deps.schedule ? this.deps.schedule(run, ms) : setTimeout(run, ms);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer === null) return;
    if (this.deps.cancelSchedule) this.deps.cancelSchedule(this.pendingTimer);
    else clearTimeout(this.pendingTimer as ReturnType<typeof setTimeout>);
    this.pendingTimer = null;
  }

  private clearTurnCapTimer(): void {
    if (this.turnCapTimer === null) return;
    if (this.deps.cancelSchedule) this.deps.cancelSchedule(this.turnCapTimer);
    else clearTimeout(this.turnCapTimer as ReturnType<typeof setTimeout>);
    this.turnCapTimer = null;
  }

  // -- State store ------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): VoiceConversationState {
    return this.state;
  }

  private setState(patch: Partial<VoiceConversationState>): void {
    const next = { ...this.state, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  /** True when this device/browser can hold a voice conversation at
   * all (recognition exists and speech synthesis exists). */
  supported(): boolean {
    return this.createRecognition() !== null && this.speech().supported();
  }

  // -- Daily cap ----------------------------------------------------------

  private readDailyCount(): number {
    try {
      const raw = this.storage()?.getItem(VOICE_CONVERSATION_DAILY_STORAGE_KEY);
      if (!raw) return 0;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return 0;
      const record = parsed as { date?: unknown; count?: unknown };
      if (record.date !== localDateKey(this.now())) return 0;
      return typeof record.count === 'number' && record.count > 0 ? Math.floor(record.count) : 0;
    } catch {
      return 0;
    }
  }

  private recordTurn(): void {
    const next = this.readDailyCount() + 1;
    try {
      this.storage()?.setItem(
        VOICE_CONVERSATION_DAILY_STORAGE_KEY,
        JSON.stringify({ date: localDateKey(this.now()), count: next }),
      );
    } catch { /* storage is best-effort; the in-memory count still applies */ }
    this.setState({
      turnsUsedToday: next,
      dailyLimitReached: next >= VOICE_CONVERSATION_DAILY_LIMIT,
    });
  }

  // -- Recognition sessions ---------------------------------------------

  private stopSession(invalidateOnly = false): void {
    this.sessionId += 1;
    const recognition = this.recognition;
    this.recognition = null;
    this.sessionKind = null;
    this.clearTurnCapTimer();
    if (recognition && !invalidateOnly) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.abort();
      } catch { /* already stopped */ }
    }
  }

  /**
   * Opens one recognition session. 'unavailable' means the device
   * has no recognizer at all (retrying is pointless); 'failed'
   * means start() itself threw — for turn sessions the caller
   * decides about retries, for wake sessions the failure is
   * surfaced exactly as before.
   */
  private beginSession(kind: SessionKind): 'started' | 'unavailable' | 'failed' {
    const recognition = this.preparedFirstRecognition ?? this.createRecognition();
    this.preparedFirstRecognition = null;
    if (!recognition) {
      this.setState({ notice: 'unsupported' });
      return 'unavailable';
    }
    this.stopSession();
    const session = ++this.sessionId;
    this.recognition = recognition;
    this.sessionKind = kind;
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      if (this.disposed || session !== this.sessionId) return;
      const { finalText, interimText } = extractTranscripts(event);
      if (kind === 'wake') this.handleWakeResult(finalText + interimText);
      else this.handleTurnResult(finalText, interimText);
    };
    recognition.onerror = (event) => {
      if (this.disposed || session !== this.sessionId) return;
      this.handleRecognitionError(event.error, kind);
    };
    recognition.onend = () => {
      if (this.disposed || session !== this.sessionId) return;
      this.recognition = null;
      this.sessionKind = null;
      this.clearTurnCapTimer();
      if (kind === 'wake') this.handleWakeEnd();
      else this.finalizeTurn();
    };
    try {
      recognition.start();
    } catch {
      this.recognition = null;
      this.sessionKind = null;
      if (kind === 'wake') {
        // No onend follows a throwing start, so without a
        // scheduled retry standby would sit armed but dead
        // (the toggle on, nothing listening). Retry with the
        // same wake backoff as a session error.
        if (this.state.wakeWaiting) this.scheduleWakeRetry();
        else this.setState({ phase: 'idle' });
      }
      return 'failed';
    }
    if (kind === 'turn') {
      // The 60-second cap: stop() ends the session and onend
      // finalizes whatever was heard, exactly like a manual finish.
      this.turnCapTimer = this.deps.schedule
        ? this.deps.schedule(() => this.finishListening(), VOICE_CONVERSATION_MAX_TURN_SECONDS * 1000)
        : setTimeout(() => this.finishListening(), VOICE_CONVERSATION_MAX_TURN_SECONDS * 1000);
    }
    return 'started';
  }

  /**
   * Opens a listening turn, riding out transient start failures
   * with backoff. The post-playback handover lands here at the
   * exact moment the device audio path is most contended (the
   * recognizer and the speech synthesizer share it), so a single
   * failed start must not end the conversation the way it used
   * to — fail closed, no retry, floor never returned.
   */
  private beginTurnSession(): void {
    const result = this.beginSession('turn');
    if (result === 'failed') {
      this.scheduleTurnStartRetry();
    } else if (result === 'unavailable') {
      // No recognizer at all: do not leave the phase claiming to
      // listen with no session behind it.
      this.enterIdleOrWake();
    }
  }

  private scheduleTurnStartRetry(): void {
    if (this.state.mode !== 'on') return;
    const delay = VOICE_CONVERSATION_TURN_START_RETRY_DELAYS_MS[this.turnStartRetries];
    if (delay === undefined) {
      // Budget spent: rest like any other exhausted loop, with
      // the failure on the status line instead of a silent stall.
      this.turnStartRetries = 0;
      this.setState({ notice: 'failed' });
      this.enterIdleOrWake();
      return;
    }
    this.turnStartRetries += 1;
    this.schedule(() => {
      if (this.state.mode === 'on' && this.state.phase === 'listening' && !this.recognition) {
        this.beginTurnSession();
      }
    }, delay);
  }

  private handleRecognitionError(error: string, kind: SessionKind): void {
    if (error === 'aborted') return; // we stopped it ourselves
    if (error === 'no-speech') return; // onend drives what happens next
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      this.stopSession();
      this.setState({ mode: 'off', wakeWaiting: false, phase: 'idle', notice: 'permission-denied' });
      // The stored preference is cleared too: standby stays off
      // until the owner re-enables it after fixing the permission,
      // instead of re-arming into the same failure on every load.
      this.deps.onWakeWaitingChange?.(false);
      return;
    }
    // Network / audio-capture / anything else. A wake session
    // retries with the widening wake backoff (scheduleWakeRetry):
    // wake sessions cycle constantly, so one transient error is
    // routine — the former fail-closed disarm is what silently
    // killed standby on the owner's device (2026-11-28). The
    // capped backoff keeps a broken recognizer from looping.
    // A turn session the owner is actively waiting on instead
    // retries with backoff (scheduleTurnStartRetry): these errors
    // are exactly what a contended audio path produces right
    // after playback, and one transient failure must not end the
    // conversation. Text already heard in this turn is kept —
    // the retried session continues accumulating it.
    this.stopSession();
    if (kind === 'wake') {
      if (this.state.wakeWaiting) this.scheduleWakeRetry();
    } else if (this.state.mode === 'on' && this.state.phase === 'listening') {
      this.scheduleTurnStartRetry();
    } else {
      this.setState({ phase: 'idle', notice: 'failed' });
    }
  }

  // -- Turn sessions ------------------------------------------------------

  private handleTurnResult(finalText: string, interimText: string): void {
    // A session that hears anything proves the audio path works;
    // the start-retry budget starts fresh from here.
    this.turnStartRetries = 0;
    if (finalText) this.accumulatedFinal += finalText;
    const heard = `${this.seedText}${this.accumulatedFinal}`;
    this.setState({ interimText: interimText ? `${heard}${interimText}` : heard });
  }

  private finalizeTurn(): void {
    const text = `${this.seedText}${this.accumulatedFinal}`.trim();
    this.accumulatedFinal = '';
    this.seedText = '';
    this.setState({ interimText: '' });
    if (this.state.mode !== 'on') return;
    if (text && matchEndPhrase(text)) {
      // End phrase: never sent, never counted toward the daily
      // cap — the conversation closes instead (see the header).
      this.endConversationWithClosing();
      return;
    }
    if (text) {
      this.emptyRestarts = 0;
      this.recordTurn();
      // Send at once (owner, 2026-11-27): the utterance goes
      // straight to the chat surface's send pipeline — never to
      // the composer, never waiting for a tap. The controller
      // rests at idle; the floor passes to the answer when the
      // user message lands and the chat surface calls
      // notifyUserSent. Resting (instead of assuming 'thinking')
      // is what keeps the loop unwedged when the pipeline refuses
      // the utterance (e.g. its sensitive-content check): no
      // message lands, no answer is expected, and the owner can
      // simply speak again.
      const accepted = this.deps.onUtterance ? this.deps.onUtterance(text) : false;
      if (accepted) {
        this.setState({ phase: 'idle' });
        // Immediate fixed acknowledgment: the owner hears at once
        // that the turn landed, while the answer is still being
        // prepared. Content-free and fixed, like the greeting —
        // the gated answer path below is untouched.
        this.speakAcknowledgment();
      } else {
        this.setState({ phase: 'idle', notice: 'failed' });
      }
      return;
    }
    // Silence: reopen the microphone a few times so a pause in the
    // owner's speech does not end the conversation, then rest.
    this.emptyRestarts += 1;
    if (this.emptyRestarts <= MAX_EMPTY_RESTARTS && !this.state.dailyLimitReached) {
      this.schedule(() => {
        if (this.state.mode === 'on' && this.state.phase === 'listening') {
          this.turnStartRetries = 0;
          this.beginTurnSession();
        }
      }, VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
      return;
    }
    this.enterIdleOrWake();
  }

  private startTurnListening(seed = ''): void {
    if (this.state.dailyLimitReached) {
      this.setState({ notice: 'daily-limit', phase: 'idle' });
      return;
    }
    this.clearPendingTimer();
    this.turnStartRetries = 0;
    this.accumulatedFinal = '';
    this.seedText = seed;
    this.setState({ phase: 'listening', interimText: seed, notice: null });
    this.beginTurnSession();
  }

  /** Ends the current listening turn; the transcript (if any) is
   * delivered through the normal onend path. */
  finishListening(): void {
    if (this.sessionKind !== 'turn' || !this.recognition) return;
    try {
      this.recognition.stop();
    } catch { /* onend may not follow; nothing else to do */ }
  }

  // -- Wake sessions -------------------------------------------------------

  private handleWakeResult(heard: string): void {
    if (!heard) return;
    this.wakeRetryCount = 0; // a live session proves the path works
    const match = matchWakePhrase(heard);
    if (!match.matched) return; // discarded on the spot, by design
    this.stopSession();
    this.startTurnListening(match.remainder);
  }

  private handleWakeEnd(): void {
    this.wakeRetryCount = 0; // a session that ends normally is healthy
    if (this.state.mode !== 'on' || !this.state.wakeWaiting) return;
    if (this.state.phase !== 'idle') return;
    this.schedule(() => {
      if (this.state.mode === 'on' && this.state.wakeWaiting && this.state.phase === 'idle' && !this.recognition) {
        this.beginSession('wake');
      }
    }, WAKE_RESTART_DELAY_MS);
  }

  /** Reopens a wake session after a transient failure, with the
   * widening WAKE_RETRY_DELAYS_MS backoff. Standby stays armed —
   * the failure is only surfaced (as a notice) once it repeats;
   * the retry itself continues at the capped delay so a
   * recognizer that recovers (network back, audio path free) is
   * picked up without the owner touching anything. */
  private scheduleWakeRetry(): void {
    this.wakeRetryCount += 1;
    if (this.wakeRetryCount >= WAKE_FAILURE_NOTICE_THRESHOLD) {
      this.setState({ notice: 'failed', phase: 'idle' });
    } else {
      this.setState({ phase: 'idle' });
    }
    const delay = WAKE_RETRY_DELAYS_MS[Math.min(this.wakeRetryCount - 1, WAKE_RETRY_DELAYS_MS.length - 1)]!;
    this.schedule(() => {
      if (this.state.mode === 'on' && this.state.wakeWaiting && this.state.phase === 'idle' && !this.recognition) {
        this.beginSession('wake');
      }
    }, delay);
  }

  private enterIdleOrWake(): void {
    this.setState({ phase: 'idle' });
    if (this.state.mode === 'on' && this.state.wakeWaiting && !this.recognition) {
      this.beginSession('wake');
    }
  }

  // -- Playback ------------------------------------------------------------

  /** Speaks one fixed acknowledgment line for an accepted turn.
   * Skipped when disabled (empty phrase list) or when something is
   * already playing — the acknowledgment never talks over speech. */
  private speakAcknowledgment(): void {
    const phrases = this.deps.ackPhrases ?? ORIN_CONVERSATION_ACK_PHRASES;
    if (phrases.length === 0) return;
    if (this.speech().getActiveId() !== null) return;
    const phrase = phrases[this.ackCount % phrases.length]!;
    this.ackCount += 1;
    this.ackActive = true;
    this.ackObservedActive = false;
    const started = this.speech().speak(VOICE_CONVERSATION_ACK_ID, phrase, this.resolveStyle());
    if (!started) this.ackActive = false;
  }

  /** Returns the floor to the owner (opens the next listening
   * turn), deferring while an acknowledgment is still playing so
   * the microphone never opens over Orin's own voice. */
  private returnFloor(): void {
    if (this.ackActive) {
      this.floorReturnPending = true;
      return;
    }
    this.startTurnListening();
  }

  private handleSpeechActivityChange(): void {
    if (this.disposed) return;
    if (this.ackActive) {
      const activeId = this.speech().getActiveId();
      if (activeId === VOICE_CONVERSATION_ACK_ID) {
        this.ackObservedActive = true;
      } else if (activeId === null && this.ackObservedActive) {
        // The acknowledgment finished. The answer (if any is
        // coming) owns the floor while the phase is 'thinking';
        // only a floor return that was deferred for the
        // acknowledgment runs here.
        this.ackActive = false;
        this.ackObservedActive = false;
        if (this.floorReturnPending) {
          this.floorReturnPending = false;
          if (this.state.mode === 'on' && this.state.phase === 'thinking') {
            this.startTurnListening();
          }
        }
      } else if (activeId !== null) {
        // Another playback (the answer) replaced the
        // acknowledgment: it owns the floor now, and any deferred
        // return is moot.
        this.ackActive = false;
        this.ackObservedActive = false;
        this.floorReturnPending = false;
      }
    }
    if (this.state.mode !== 'on' || this.state.phase !== 'speaking') return;
    if (this.speech().getActiveId() !== null) {
      this.speakingObservedActive = true;
      return;
    }
    if (!this.speakingObservedActive) return; // speak() still setting up
    this.speakingObservedActive = false;
    // Playback finished: hand the floor back after a short beat.
    this.schedule(() => {
      if (this.state.mode === 'on' && this.state.phase === 'speaking') {
        this.startTurnListening();
      }
    }, VOICE_CONVERSATION_NEXT_TURN_DELAY_MS);
  }

  // -- Public conversation flow --------------------------------------------

  startConversation(): void {
    if (this.state.mode === 'on') return;
    // The support probe instance is not thrown away: it becomes the
    // first session's recognizer.
    const probe = this.createRecognition();
    if (probe === null || !this.speech().supported()) {
      this.setState({ notice: 'unsupported' });
      return;
    }
    if (this.state.dailyLimitReached) {
      this.setState({ notice: 'daily-limit' });
      return;
    }
    this.emptyRestarts = 0;
    this.preparedFirstRecognition = probe;
    this.setState({ mode: 'on', notice: null });
    if (this.resolveStartStyle() === 'listen') {
      // No greeting (owner's choice): the floor is the owner's at
      // once — or, when wake waiting brought the mode up, the
      // conversation simply rests into wake sessions, exactly as
      // it does after the greeting.
      if (this.state.wakeWaiting) this.enterIdleOrWake();
      else this.startTurnListening();
      return;
    }
    this.speakOpening();
  }

  private resolveStartStyle(): VoiceConversationStartStyle {
    const style = typeof this.deps.startStyle === 'function'
      ? this.deps.startStyle()
      : this.deps.startStyle;
    return style ?? 'greeting';
  }

  /** Orin takes the first turn: a fixed greeting, then the floor
   * passes to the owner through the normal playback-end path. When
   * the greeting cannot be spoken at all, the conversation falls
   * back to listening (or wake waiting) immediately. */
  /** The opening line for this playback: an explicit override
   * wins; otherwise the alter-ego variant while the owner's
   * alter-ego mode is on, and the default line while it is off. */
  private resolveOpeningText(): string {
    if (this.deps.openingText !== undefined) return this.deps.openingText;
    return this.deps.alterEgoActive?.() === true
      ? ORIN_CONVERSATION_OPENING_TEXT_ALTER_EGO
      : ORIN_CONVERSATION_OPENING_TEXT;
  }

  /** The closing line for this playback, resolved the same way. */
  private resolveClosingText(): string {
    return this.deps.alterEgoActive?.() === true
      ? ORIN_CONVERSATION_CLOSING_TEXT_ALTER_EGO
      : ORIN_CONVERSATION_CLOSING_TEXT;
  }

  private speakOpening(): void {
    this.speakingObservedActive = false;
    this.setState({ phase: 'speaking' });
    const started = this.speech().speak(
      VOICE_CONVERSATION_OPENING_ID,
      this.resolveOpeningText(),
      this.resolveStyle(),
    );
    if (started) return;
    if (this.state.wakeWaiting) this.enterIdleOrWake();
    else this.startTurnListening();
  }

  /** Ends the conversation on the owner's end phrase: exactly the
   * stopConversation() transition, plus the fixed closing line
   * spoken on the ordinary playback path. The line is spoken after
   * the state has fully closed, so its playback end can never
   * reopen the microphone — the playback-end path only runs while
   * the mode is on. When the line cannot be spoken at all, the
   * conversation simply ends silently. */
  private endConversationWithClosing(): void {
    this.stopConversation();
    this.speech().speak(
      VOICE_CONVERSATION_CLOSING_ID,
      this.resolveClosingText(),
      this.resolveStyle(),
    );
  }

  stopConversation(): void {
    this.clearPendingTimer();
    this.preparedFirstRecognition = null;
    this.ackActive = false;
    this.ackObservedActive = false;
    this.floorReturnPending = false;
    this.stopSession();
    this.speech().stop();
    this.accumulatedFinal = '';
    this.seedText = '';
    this.setState({ mode: 'off', wakeWaiting: false, phase: 'idle', interimText: '', notice: null });
    // While the owner's wake-waiting preference is on, ending a
    // conversation is not the end of standby: the surface rests
    // back into wake sessions so 「ハイ、オリン」 can start the
    // next conversation (the owner's model of the feature; the
    // toggle is what turns standby off). Without the preference
    // this is exactly the full stop it has always been.
    if (this.deps.wakeWaitingPreferred?.() === true && !this.state.dailyLimitReached) {
      this.setState({ mode: 'on', wakeWaiting: true, phase: 'idle' });
      this.beginSession('wake');
    }
  }

  /** Re-arms standby from the stored preference (called by the
   * conversation surface when it appears and voice output is
   * available). Silent: no greeting, no turn — the mode rests at
   * idle running wake sessions. A no-op when standby is already
   * armed or a conversation is live. */
  restoreWakeWaiting(): void {
    if (this.state.wakeWaiting && this.state.mode === 'on') return;
    if (this.state.mode === 'on' && this.state.phase !== 'idle') return;
    if (this.state.dailyLimitReached) {
      this.setState({ notice: 'daily-limit' });
      return;
    }
    this.wakeRetryCount = 0;
    this.setState({ mode: 'on', wakeWaiting: true, phase: 'idle', notice: null });
    if (!this.recognition) this.beginSession('wake');
  }

  /** The one main button of the conversation surface. Its meaning
   * follows the floor: start when off, finish when listening,
   * barge in when Orin is speaking, listen again when resting. */
  pressMainButton(): void {
    const { mode, phase } = this.state;
    if (mode === 'off') {
      this.startConversation();
      return;
    }
    if (phase === 'speaking') {
      // Barge-in: stop Orin immediately and take the floor.
      this.clearPendingTimer();
      this.speech().stop();
      this.startTurnListening();
      return;
    }
    if (phase === 'listening') {
      this.finishListening();
      return;
    }
    if (phase === 'idle') {
      this.startTurnListening();
    }
    // 'thinking': the floor is the answer's; the main button does
    // nothing.
  }

  setWakeWaiting(enabled: boolean): void {
    if (!enabled) {
      this.deps.onWakeWaitingChange?.(false);
      this.wakeRetryCount = 0;
      this.setState({ wakeWaiting: false });
      if (this.sessionKind === 'wake') {
        this.stopSession();
        this.setState({ phase: 'idle' });
      }
      return;
    }
    if (this.state.dailyLimitReached) {
      this.setState({ notice: 'daily-limit' });
      return;
    }
    this.deps.onWakeWaitingChange?.(true);
    this.wakeRetryCount = 0;
    this.setState({ wakeWaiting: true, notice: null });
    if (this.state.mode !== 'on') {
      // Wake waiting implies conversation mode: starting the mode
      // with the flag set rests at idle and runs wake sessions.
      this.startConversation();
      return;
    }
    if (this.state.phase === 'idle' && !this.recognition) {
      this.beginSession('wake');
    }
  }

  /** Called by the chat surface when the owner sends a message
   * while conversation mode is on: the floor passes to the answer. */
  notifyUserSent(): void {
    if (this.state.mode !== 'on') return;
    if (this.sessionKind === 'turn') this.stopSession();
    this.accumulatedFinal = '';
    this.seedText = '';
    this.setState({ phase: 'thinking', interimText: '' });
  }

  /** Called by the chat surface when a final (gate-passed) assistant
   * answer has completed while conversation mode is on. Speaks the
   * answer's (short) summary — playback begins with the first
   * sentence immediately, the speech controller queues the rest —
   * and when there is nothing speakable, the floor returns to the
   * owner straight away. */
  notifyAnswerReady(messageId: string, finalAnswerText: string): void {
    if (this.state.mode !== 'on' || this.state.phase !== 'thinking') return;
    const built = (this.deps.buildSummary ?? ((text: string) => buildSpokenSummary(text, {
      maxSentences: VOICE_CONVERSATION_SUMMARY_MAX_SENTENCES,
      maxChars: VOICE_CONVERSATION_SUMMARY_MAX_CHARS,
    })))(finalAnswerText);
    // The conversation tone shapes how the summary sounds AND
    // how its sentences end — except while alter-ego mode is on:
    // the answer already speaks in the persona's voice there, and
    // the persona outranks the tone's phrasing (the tone's
    // prosody still applies through the style profile).
    const summary = this.deps.alterEgoActive?.() === true
      ? built
      : applySpokenTonePhrasing(built, this.deps.conversationTone?.() ?? 'everyday');
    if (!summary) {
      this.returnFloor();
      return;
    }
    this.speakingObservedActive = false;
    this.setState({ phase: 'speaking' });
    const started = this.speech().speak(messageId, summary, this.resolveStyle());
    if (!started) {
      this.setState({ notice: 'failed' });
      this.returnFloor();
    }
  }

  /** Called by the chat surface when an answer completed but will
   * not be spoken — a research result, an error, an empty answer:
   * the categories the glue deliberately keeps away from
   * notifyAnswerReady. Without this settle, those answers left
   * the phase at 'thinking' forever and the conversation silently
   * stopped after exactly one turn. The floor simply returns to
   * the owner, as it does when there is nothing speakable. */
  notifyAnswerSettled(): void {
    if (this.state.mode !== 'on' || this.state.phase !== 'thinking') return;
    this.returnFloor();
  }

  clearNotice(): void {
    this.setState({ notice: null });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeSpeech?.();
    this.unsubscribeSpeech = null;
    this.clearPendingTimer();
    this.stopSession();
  }
}

// -- App-wide singleton -----------------------------------------------------

let utteranceHandler: ((text: string) => boolean) | null = null;

/** The chat surface registers its send pipeline here: a finalized
 * utterance is sent at once through the same path as the owner's
 * own send action. The handler returns false when it cannot
 * accept the utterance (e.g. offline), which drops it. */
export function setVoiceConversationUtteranceHandler(handler: ((text: string) => boolean) | null): void {
  utteranceHandler = handler;
}

export const voiceConversation = new VoiceConversationController({
  onUtterance: (text) => (utteranceHandler ? utteranceHandler(text) : false),
  // How Orin sounds follows the tone pattern the owner picked in
  // settings (強い／優しい／丁寧／日常), read at each playback.
  styleProfile: () => resolveStoredVoiceConversationStyle(),
  // The fixed lines follow the owner's alter-ego mode toggle,
  // read from the persisted settings at each playback.
  alterEgoActive: () => readAlterEgoEnabled(),
  // The start style follows the owner's stored choice, read at
  // each conversation start.
  startStyle: () => getStoredVoiceConversationStartStyle(),
  // The tone for the spoken summary's phrasing, read from the
  // same stored choice the prosody resolver reads.
  conversationTone: () => getStoredVoiceConversationTone(),
  // The wake-waiting toggle is a stored device preference: it
  // survives conversation endings and app reloads, and the
  // conversation surface re-arms standby from it.
  wakeWaitingPreferred: () => getStoredWakeWaitingPreference(),
  onWakeWaitingChange: (enabled) => setStoredWakeWaitingPreference(enabled),
});
