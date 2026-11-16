/**
 * Client side of POST /api/voice/transcribe (PR-V3, design:
 * VOICE_INPUT_RECON_2026-11-12; the server endpoint is PR-V2).
 *
 * Two calls live here:
 *
 * - Availability probe. The kill switch (env ORIGIN_VOICE_TRANSCRIBE_ENABLED,
 *   default OFF) is the server's very first check, before any input
 *   validation, quota reservation, or provider call. An empty-body POST
 *   therefore answers VOICE_TRANSCRIBE_DISABLED while the feature is off
 *   and VOICE_AUDIO_EMPTY once it is on, and can never consume the daily
 *   cap or spend Neurons. The composer shows the microphone button only
 *   when the probe proves the feature is on; every other outcome (off,
 *   network failure, unexpected shape) resolves to "not available" so the
 *   button never becomes a broken path (fail closed).
 *
 * - Transcription. The recorded audio Blob is sent as the raw request
 *   body, exactly as recorded; it is never stored anywhere on the client
 *   (no localStorage, no IndexedDB, no cache) and the caller discards it
 *   as soon as this call settles. Only the returned text is used, and it
 *   is placed in the composer for the user to review — never auto-sent.
 */

export const VOICE_TRANSCRIBE_ENDPOINT = '/api/voice/transcribe';

/** Client-side failure kinds, mapped to plain-language notices by the UI. */
export type VoiceTranscriptionNoticeKind = 'daily-limit' | 'unavailable' | 'failed';

export type VoiceTranscriptionOutcome =
  | { ok: true; text: string; dailyUsed: number | null; dailyLimit: number | null }
  | { ok: false; notice: VoiceTranscriptionNoticeKind };

const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'VOICE_TRANSCRIBE_DISABLED',
  'VOICE_MODEL_EVIDENCE_STALE',
  'VOICE_MODEL_CATALOG_INVALID',
  'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED',
  'CLOUDFLARE_DAILY_USAGE_UNVERIFIED',
  'CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT',
]);

async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * True only when the server proves the voice endpoint is enabled. The
 * probe sends an empty audio body on purpose (see the header comment):
 * while the kill switch is OFF the server refuses before looking at the
 * body, and while it is ON the empty body is rejected as empty — neither
 * path reserves daily quota or calls the provider.
 */
export async function probeVoiceInputAvailability(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(VOICE_TRANSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: new Blob([], { type: 'audio/webm' }),
    });
    const body = await readJsonBody(response);
    return body?.code === 'VOICE_AUDIO_EMPTY';
  } catch {
    return false;
  }
}

export async function requestVoiceTranscription(
  audio: Blob,
  durationMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceTranscriptionOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(VOICE_TRANSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': audio.type || 'application/octet-stream',
        'x-origin-audio-duration-ms': String(Math.max(0, Math.floor(durationMs))),
      },
      body: audio,
    });
  } catch {
    return { ok: false, notice: 'failed' };
  }
  const body = await readJsonBody(response);
  if (response.ok && body?.ok === true && typeof body.text === 'string') {
    return {
      ok: true,
      text: body.text,
      dailyUsed: typeof body.dailyUsed === 'number' ? body.dailyUsed : null,
      dailyLimit: typeof body.dailyLimit === 'number' ? body.dailyLimit : null,
    };
  }
  const code = typeof body?.code === 'string' ? body.code : '';
  if (code === 'VOICE_DAILY_LIMIT_REACHED') return { ok: false, notice: 'daily-limit' };
  if (UNAVAILABLE_CODES.has(code)) return { ok: false, notice: 'unavailable' };
  return { ok: false, notice: 'failed' };
}

/**
 * Appends a transcription to the text already in the composer. The result
 * is only ever placed in the input for the user to review and send
 * themselves; this helper never triggers a send.
 */
export function appendVoiceTranscript(current: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return current;
  if (!current) return text;
  return /\s$/.test(current) ? `${current}${text}` : `${current} ${text}`;
}

/** Formats a recording duration as m:ss for the recording band. */
export function formatVoiceElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
