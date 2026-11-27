import {
  createBrowserSpeechRecognition,
  extractTranscripts,
  matchWakePhrase,
  type SpeechRecognitionFactory,
  type SpeechRecognitionLike,
} from './voiceSpeechRecognition';
import { buildSpokenSummary } from './voiceSpokenSummary';
import { resolveStoredVoiceConversationStyle } from './voiceConversationTone';
import { voiceSpeech, type SpeechStyleOptions, type VoiceStorageLike } from './voiceSpeech';

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
 * - Caps: one listening turn ends at 60 seconds; at most 20
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

export const VOICE_CONVERSATION_MAX_TURN_SECONDS = 60;
export const VOICE_CONVERSATION_DAILY_LIMIT = 20;
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
/** Consecutive silent listening sessions tolerated before the
 * controller rests at idle instead of reopening the microphone
 * forever. Any heard turn resets the count. */
const MAX_EMPTY_RESTARTS = 5;

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
  /** The speaking-style profile, or a resolver consulted at each
   * playback (so a profile that appears later — e.g. the owner's
   * saved speaking style — is picked up without rebuilding the
   * controller). Null from a resolver means the default profile. */
  styleProfile?: VoiceConversationStyleProfile | (() => VoiceConversationStyleProfile | null);
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

  private beginSession(kind: SessionKind): boolean {
    const recognition = this.preparedFirstRecognition ?? this.createRecognition();
    this.preparedFirstRecognition = null;
    if (!recognition) {
      this.setState({ notice: 'unsupported' });
      return false;
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
      this.setState({ notice: 'failed', phase: 'idle' });
      return false;
    }
    if (kind === 'turn') {
      // The 60-second cap: stop() ends the session and onend
      // finalizes whatever was heard, exactly like a manual finish.
      this.turnCapTimer = this.deps.schedule
        ? this.deps.schedule(() => this.finishListening(), VOICE_CONVERSATION_MAX_TURN_SECONDS * 1000)
        : setTimeout(() => this.finishListening(), VOICE_CONVERSATION_MAX_TURN_SECONDS * 1000);
    }
    return true;
  }

  private handleRecognitionError(error: string, kind: SessionKind): void {
    if (error === 'aborted') return; // we stopped it ourselves
    if (error === 'no-speech') return; // onend drives what happens next
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      this.stopSession();
      this.setState({ mode: 'off', wakeWaiting: false, phase: 'idle', notice: 'permission-denied' });
      return;
    }
    // Network / audio-capture / anything else: fail closed. Wake
    // waiting in particular must not retry in a loop against a
    // failing recognizer.
    this.stopSession();
    if (kind === 'wake') {
      this.setState({ wakeWaiting: false, phase: 'idle', notice: 'failed' });
    } else {
      this.setState({ phase: 'idle', notice: 'failed' });
    }
  }

  // -- Turn sessions ------------------------------------------------------

  private handleTurnResult(finalText: string, interimText: string): void {
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
        if (this.state.mode === 'on' && this.state.phase === 'listening') this.beginSession('turn');
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
    this.accumulatedFinal = '';
    this.seedText = seed;
    this.setState({ phase: 'listening', interimText: seed, notice: null });
    this.beginSession('turn');
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
    const match = matchWakePhrase(heard);
    if (!match.matched) return; // discarded on the spot, by design
    this.stopSession();
    this.startTurnListening(match.remainder);
  }

  private handleWakeEnd(): void {
    if (this.state.mode !== 'on' || !this.state.wakeWaiting) return;
    if (this.state.phase !== 'idle') return;
    this.schedule(() => {
      if (this.state.mode === 'on' && this.state.wakeWaiting && this.state.phase === 'idle' && !this.recognition) {
        this.beginSession('wake');
      }
    }, WAKE_RESTART_DELAY_MS);
  }

  private enterIdleOrWake(): void {
    this.setState({ phase: 'idle' });
    if (this.state.mode === 'on' && this.state.wakeWaiting && !this.recognition) {
      this.beginSession('wake');
    }
  }

  // -- Playback ------------------------------------------------------------

  private handleSpeechActivityChange(): void {
    if (this.disposed) return;
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
    this.speakOpening();
  }

  /** Orin takes the first turn: a fixed greeting, then the floor
   * passes to the owner through the normal playback-end path. When
   * the greeting cannot be spoken at all, the conversation falls
   * back to listening (or wake waiting) immediately. */
  private speakOpening(): void {
    this.speakingObservedActive = false;
    this.setState({ phase: 'speaking' });
    const started = this.speech().speak(
      VOICE_CONVERSATION_OPENING_ID,
      this.deps.openingText ?? ORIN_CONVERSATION_OPENING_TEXT,
      this.resolveStyle(),
    );
    if (started) return;
    if (this.state.wakeWaiting) this.enterIdleOrWake();
    else this.startTurnListening();
  }

  stopConversation(): void {
    this.clearPendingTimer();
    this.preparedFirstRecognition = null;
    this.stopSession();
    this.speech().stop();
    this.accumulatedFinal = '';
    this.seedText = '';
    this.setState({ mode: 'off', wakeWaiting: false, phase: 'idle', interimText: '', notice: null });
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
    const summary = (this.deps.buildSummary ?? ((text: string) => buildSpokenSummary(text, {
      maxSentences: VOICE_CONVERSATION_SUMMARY_MAX_SENTENCES,
      maxChars: VOICE_CONVERSATION_SUMMARY_MAX_CHARS,
    })))(finalAnswerText);
    if (!summary) {
      this.startTurnListening();
      return;
    }
    this.speakingObservedActive = false;
    this.setState({ phase: 'speaking' });
    const started = this.speech().speak(messageId, summary, this.resolveStyle());
    if (!started) {
      this.setState({ notice: 'failed' });
      this.startTurnListening();
    }
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
});
