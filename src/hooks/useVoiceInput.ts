import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  requestVoiceTranscription,
  type VoiceTranscriptionNoticeKind,
} from '../voice/voiceTranscribeClient';
import {
  getVoiceAvailability,
  subscribeVoiceAvailability,
  type VoiceAvailabilityState,
} from '../voice/voiceAvailability';

/**
 * Voice input for the composer (PR-V3, design: VOICE_INPUT_RECON_2026-11-12).
 *
 * Owns the client flow after availability: availability itself is read
 * from the bootstrap-owned store in voiceAvailability (the microphone
 * button is rendered only while the server has proven the feature is
 * on). This hook owns the first-use privacy notice, recording with
 * MediaRecorder (60-second cap, negotiated mime type), and the
 * transcription request. The recorded
 * audio lives only in memory while recording and is discarded as soon as
 * the transcription settles — it is never written to storage, and the
 * transcription text is handed to the caller to place in the composer
 * for the user to review. Nothing here can send a chat message.
 */

export const VOICE_MAX_RECORDING_SECONDS = 60;
export const VOICE_PRIVACY_NOTICE_STORAGE_KEY = 'origin.voice.privacyNoticeAcknowledged';

/** Mime negotiation order (design §5c): Android webm/opus first, then
 *  webm, then iOS mp4, then ogg. The server passes the bytes through
 *  unchanged, so the negotiated type is what goes on the wire. */
export const VOICE_AUDIO_MIME_CANDIDATES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

export type VoiceInputAvailability = VoiceAvailabilityState;
export type VoiceInputPhase = 'idle' | 'recording' | 'transcribing';
export type VoiceInputNotice =
  | VoiceTranscriptionNoticeKind
  | 'permission-denied'
  | 'unsupported';

export interface VoiceRecorderEnvironment {
  mediaRecorder?: typeof MediaRecorder;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface UseVoiceInputOptions {
  /** Receives the transcription text. The caller places it in the
   *  composer; it is never sent from here. */
  onTranscript: (text: string) => void;
  environment?: VoiceRecorderEnvironment;
}

export interface VoiceInputController {
  availability: VoiceInputAvailability;
  phase: VoiceInputPhase;
  elapsedSeconds: number;
  notice: VoiceInputNotice | null;
  privacyPromptVisible: boolean;
  /** The one entry point for the microphone button: starts recording,
   *  finishes it while recording, and is inert while transcribing. */
  pressMic: () => void;
  /** Stops recording and sends the audio for transcription. */
  finishRecording: () => void;
  /** Stops recording and discards the audio without transcribing. */
  cancelRecording: () => void;
  confirmPrivacyNotice: () => void;
  dismissPrivacyNotice: () => void;
  clearNotice: () => void;
}

function defaultEnvironment(): VoiceRecorderEnvironment {
  const env: VoiceRecorderEnvironment = {};
  try {
    const ctor = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    if (typeof ctor === 'function') env.mediaRecorder = ctor as typeof MediaRecorder;
  } catch {
    // No MediaRecorder in this environment; startRecording reports it.
  }
  try {
    const mediaDevices = (globalThis.navigator as Navigator | undefined)?.mediaDevices;
    if (mediaDevices && typeof mediaDevices.getUserMedia === 'function') {
      env.getUserMedia = (constraints) => mediaDevices.getUserMedia(constraints);
    }
  } catch {
    // Same as above.
  }
  try {
    env.storage = globalThis.localStorage ?? null;
  } catch {
    env.storage = null;
  }
  return env;
}

function readPrivacyAcknowledged(storage: VoiceRecorderEnvironment['storage']): boolean {
  try {
    return storage?.getItem(VOICE_PRIVACY_NOTICE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useVoiceInput(options: UseVoiceInputOptions): VoiceInputController {
  // Availability is owned by the bootstrap probe (see voiceAvailability):
  // this hook only reads the store and never fetches on mount.
  const availability = useSyncExternalStore(
    subscribeVoiceAvailability,
    getVoiceAvailability,
    getVoiceAvailability,
  );
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [notice, setNotice] = useState<VoiceInputNotice | null>(null);
  const [privacyPromptVisible, setPrivacyPromptVisible] = useState(false);
  const [dailyLimitReached, setDailyLimitReached] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const environmentRef = useRef<VoiceRecorderEnvironment | null>(null);
  const resolveEnvironment = useCallback((): VoiceRecorderEnvironment => {
    if (!environmentRef.current) {
      environmentRef.current = { ...defaultEnvironment(), ...optionsRef.current.environment };
    }
    return environmentRef.current;
  }, []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const mimeTypeRef = useRef('');
  const discardRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  const stopTracks = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    } catch {
      // Stopping tracks is best-effort cleanup.
    }
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finishRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      // Already stopped; onstop (if any) owns the rest.
    }
  }, []);

  const cancelRecording = useCallback(() => {
    discardRef.current = true;
    finishRecording();
  }, [finishRecording]);

  const startRecording = useCallback(async () => {
    const env = resolveEnvironment();
    setNotice(null);
    if (dailyLimitReached) {
      setNotice('daily-limit');
      return;
    }
    const MediaRecorderCtor = env.mediaRecorder;
    const getUserMedia = env.getUserMedia;
    if (!MediaRecorderCtor || typeof MediaRecorderCtor.isTypeSupported !== 'function' || !getUserMedia) {
      setNotice('unsupported');
      return;
    }
    let mimeType = '';
    for (const candidate of VOICE_AUDIO_MIME_CANDIDATES) {
      try {
        if (MediaRecorderCtor.isTypeSupported(candidate)) {
          mimeType = candidate;
          break;
        }
      } catch {
        // A throwing isTypeSupported is treated as "not supported".
      }
    }
    if (!mimeType) {
      setNotice('unsupported');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await getUserMedia({ audio: true });
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      if (name === 'NotAllowedError') setNotice('permission-denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setNotice('unsupported');
      else setNotice('failed');
      return;
    }
    if (!mountedRef.current) {
      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // Best-effort.
      }
      return;
    }
    streamRef.current = stream;
    mimeTypeRef.current = mimeType;
    chunksRef.current = [];
    discardRef.current = false;
    const runId = ++runIdRef.current;

    const recorder = new MediaRecorderCtor(stream, { mimeType });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      clearTimer();
      stopTracks();
      recorderRef.current = null;
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (!mountedRef.current) return;
      if (discardRef.current) {
        discardRef.current = false;
        setPhase('idle');
        setElapsedSeconds(0);
        return;
      }
      const durationMs = Math.min(Date.now() - startedAtRef.current, VOICE_MAX_RECORDING_SECONDS * 1000);
      const audio = new Blob(chunks, { type: mimeTypeRef.current || undefined });
      if (audio.size === 0) {
        setPhase('idle');
        setElapsedSeconds(0);
        setNotice('failed');
        return;
      }
      setPhase('transcribing');
      void (async () => {
        const outcome = await requestVoiceTranscription(audio, durationMs, env.fetchImpl ?? fetch);
        if (!mountedRef.current || runIdRef.current !== runId) return;
        setPhase('idle');
        setElapsedSeconds(0);
        if (outcome.ok === false) {
          if (outcome.notice === 'daily-limit') setDailyLimitReached(true);
          setNotice(outcome.notice);
        } else {
          if (
            outcome.dailyUsed !== null
            && outcome.dailyLimit !== null
            && outcome.dailyUsed >= outcome.dailyLimit
          ) {
            setDailyLimitReached(true);
          }
          if (outcome.text.trim()) optionsRef.current.onTranscript(outcome.text);
        }
      })();
    };
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setPhase('recording');
    try {
      recorder.start();
    } catch {
      recorderRef.current = null;
      stopTracks();
      setPhase('idle');
      setNotice('failed');
      return;
    }
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSeconds(Math.min(elapsed, VOICE_MAX_RECORDING_SECONDS));
      if (elapsed >= VOICE_MAX_RECORDING_SECONDS) finishRecording();
    }, 250);
  }, [clearTimer, dailyLimitReached, finishRecording, resolveEnvironment, stopTracks]);

  const pressMic = useCallback(() => {
    if (phase === 'recording') {
      finishRecording();
      return;
    }
    if (phase !== 'idle') return;
    if (dailyLimitReached) {
      setNotice('daily-limit');
      return;
    }
    const env = resolveEnvironment();
    if (!readPrivacyAcknowledged(env.storage)) {
      setPrivacyPromptVisible(true);
      return;
    }
    void startRecording();
  }, [dailyLimitReached, finishRecording, phase, resolveEnvironment, startRecording]);

  const confirmPrivacyNotice = useCallback(() => {
    const env = resolveEnvironment();
    try {
      env.storage?.setItem(VOICE_PRIVACY_NOTICE_STORAGE_KEY, '1');
    } catch {
      // Storage can be unavailable (private mode); the notice then
      // simply shows again next time.
    }
    setPrivacyPromptVisible(false);
    void startRecording();
  }, [resolveEnvironment, startRecording]);

  const dismissPrivacyNotice = useCallback(() => {
    setPrivacyPromptVisible(false);
  }, []);

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  // Unmount: stop the microphone and drop any in-flight recording. The
  // audio is discarded, never transcribed or stored.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRef.current = true;
      runIdRef.current += 1;
      clearTimer();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          // Best-effort.
        }
      }
      stopTracks();
    };
  }, [clearTimer, stopTracks]);

  return {
    availability,
    phase,
    elapsedSeconds,
    notice,
    privacyPromptVisible,
    pressMic,
    finishRecording,
    cancelRecording,
    confirmPrivacyNotice,
    dismissPrivacyNotice,
    clearNotice,
  };
}
