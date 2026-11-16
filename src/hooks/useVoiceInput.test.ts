import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useVoiceInput,
  VOICE_PRIVACY_NOTICE_STORAGE_KEY,
  type VoiceRecorderEnvironment,
} from './useVoiceInput';
import { refreshVoiceAvailability } from '../voice/voiceAvailability';

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported = new Set(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']);
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.has(type);
  }
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: unknown = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: this.mimeType }) });
    this.onstop?.();
  }
  pause(): void {}
  resume(): void {}
  requestData(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (values.has(key) ? values.get(key)! : null),
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

interface FetchBehavior {
  probeCode?: string;
  transcribe?: (call: number) => Response | Promise<Response>;
}

function makeFetch(behavior: FetchBehavior) {
  let transcribeCalls = 0;
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body as Blob | undefined;
    if (!body || body.size === 0) {
      return jsonResponse({ ok: false, code: behavior.probeCode ?? 'VOICE_AUDIO_EMPTY' }, 400);
    }
    transcribeCalls += 1;
    if (behavior.transcribe) return behavior.transcribe(transcribeCalls);
    return jsonResponse({ ok: true, code: 'VOICE_TRANSCRIPTION_READY', text: 'テストの文字起こし', dailyUsed: 1, dailyLimit: 20 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls: fetchImpl };
}

function makeEnvironment(overrides: Partial<VoiceRecorderEnvironment> = {}, behavior: FetchBehavior = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => stream);
  const { fetchImpl, calls } = makeFetch(behavior);
  const storage = makeStorage({ [VOICE_PRIVACY_NOTICE_STORAGE_KEY]: '1' });
  const environment: VoiceRecorderEnvironment = {
    mediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
    getUserMedia: getUserMedia as unknown as VoiceRecorderEnvironment['getUserMedia'],
    fetchImpl,
    storage,
    ...overrides,
  };
  return { environment, getUserMedia, track, fetchCalls: calls, storage };
}

describe('useVoiceInput', () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the feature hidden while the endpoint is disabled', async () => {
    const { environment, fetchCalls } = makeEnvironment({}, { probeCode: 'VOICE_TRANSCRIBE_DISABLED' });
    // Availability is probed by the app bootstrap, never by the hook;
    // drive the store through the same entry the bootstrap uses.
    await refreshVoiceAvailability(fetchCalls as unknown as typeof fetch);
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), environment }));
    expect(result.current.availability).toBe('unavailable');
  });

  it('becomes available when the probe proves the endpoint is enabled', async () => {
    const { environment, fetchCalls } = makeEnvironment();
    await refreshVoiceAvailability(fetchCalls as unknown as typeof fetch);
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), environment }));
    expect(result.current.availability).toBe('available');
  });

  it('shows the privacy notice before the first recording and remembers the acknowledgement', async () => {
    const { environment, getUserMedia, storage } = makeEnvironment();
    storage.values.clear();
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), environment }));
    act(() => result.current.pressMic());
    expect(result.current.privacyPromptVisible).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => result.current.confirmPrivacyNotice());
    expect(storage.values.get(VOICE_PRIVACY_NOTICE_STORAGE_KEY)).toBe('1');
    expect(result.current.privacyPromptVisible).toBe(false);
    expect(result.current.phase).toBe('recording');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    act(() => result.current.cancelRecording());
  });

  it('transcribes a finished recording and hands the text to the caller without sending anything', async () => {
    const onTranscript = vi.fn();
    const { environment, fetchCalls } = makeEnvironment();
    const { result } = renderHook(() => useVoiceInput({ onTranscript, environment }));
    await act(async () => result.current.pressMic());
    expect(result.current.phase).toBe('recording');
    await act(async () => result.current.finishRecording());
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith('テストの文字起こし');
    // The only request this flow makes is the transcription itself.
    // There is no chat/send call anywhere in the voice path.
    expect(fetchCalls).toHaveBeenCalledTimes(1);
    for (const call of fetchCalls.mock.calls) {
      expect(call[0]).toBe('/api/voice/transcribe');
    }
  });

  it('discards a cancelled recording without transcribing it', async () => {
    const onTranscript = vi.fn();
    const { environment, fetchCalls, track } = makeEnvironment();
    const { result } = renderHook(() => useVoiceInput({ onTranscript, environment }));
    await act(async () => result.current.pressMic());
    expect(result.current.phase).toBe('recording');
    act(() => result.current.cancelRecording());
    expect(result.current.phase).toBe('idle');
    expect(fetchCalls).not.toHaveBeenCalled(); // no transcription request
    expect(onTranscript).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops at the 60-second cap and transcribes automatically', async () => {
    vi.useFakeTimers();
    const onTranscript = vi.fn();
    const { environment } = makeEnvironment();
    const { result } = renderHook(() => useVoiceInput({ onTranscript, environment }));
    await act(async () => {});
    expect(result.current.availability).toBe('available');
    await act(async () => result.current.pressMic());
    expect(result.current.phase).toBe('recording');
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {});
    expect(result.current.phase).toBe('idle');
    expect(onTranscript).toHaveBeenCalledWith('テストの文字起こし');
  });

  it('reports a plain permission notice when microphone access is denied', async () => {
    const denied = vi.fn(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    const { environment } = makeEnvironment({
      getUserMedia: denied as unknown as VoiceRecorderEnvironment['getUserMedia'],
    });
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), environment }));
    await act(async () => result.current.pressMic());
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toBe('permission-denied');
  });

  it('reports unsupported when the browser cannot record', async () => {
    const { environment } = makeEnvironment({ mediaRecorder: undefined, getUserMedia: undefined });
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), environment }));
    act(() => result.current.pressMic());
    expect(result.current.notice).toBe('unsupported');
    expect(result.current.phase).toBe('idle');
  });

  it('surfaces the daily-limit notice and stops asking the microphone afterwards', async () => {
    const { environment, getUserMedia } = makeEnvironment({}, {
      transcribe: () => jsonResponse({ ok: false, code: 'VOICE_DAILY_LIMIT_REACHED' }, 429),
    });
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), environment }));
    await act(async () => result.current.pressMic());
    await act(async () => result.current.finishRecording());
    await waitFor(() => expect(result.current.notice).toBe('daily-limit'));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    act(() => result.current.pressMic());
    expect(result.current.notice).toBe('daily-limit');
    expect(result.current.phase).toBe('idle');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('treats a success that reaches the daily limit as the end of the day', async () => {
    const { environment, getUserMedia } = makeEnvironment({}, {
      transcribe: () => jsonResponse({ ok: true, code: 'VOICE_TRANSCRIPTION_READY', text: '最後の一回', dailyUsed: 20, dailyLimit: 20 }),
    });
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), environment }));
    await act(async () => result.current.pressMic());
    await act(async () => result.current.finishRecording());
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.pressMic());
    expect(result.current.notice).toBe('daily-limit');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('stops the microphone tracks when unmounted mid-recording', async () => {
    const { environment, track } = makeEnvironment();
    const { result, unmount } = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), environment }));
    await act(async () => result.current.pressMic());
    expect(result.current.phase).toBe('recording');
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });
});
