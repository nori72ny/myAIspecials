/**
 * Voice-output availability store (VC-1, VOICE_CONVERSATION_DESIGN
 * 2026-11-18).
 *
 * Mirrors the voice-input availability store (voiceAvailability.ts):
 * the probe runs exactly once, from the application bootstrap in
 * main.tsx, and components only read this store — they never probe on
 * mount. The read-aloud button and the "Orin's voice" settings section
 * render only after the server has proven the voice-output switch is
 * on (the /api/health status carries `voiceOutputEnabled`, the same
 * shape as the agent status' `attachmentsEnabled`). Until the probe
 * resolves, and whenever it resolves to "not available", the surface
 * stays hidden (fail closed).
 */

export type VoiceOutputAvailabilityState = 'checking' | 'available' | 'unavailable';

export const VOICE_OUTPUT_STATUS_ENDPOINT = '/api/health' as const;

let state: VoiceOutputAvailabilityState = 'checking';
let probeRunId = 0;
const listeners = new Set<() => void>();

function setState(next: VoiceOutputAvailabilityState) {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeVoiceOutputAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVoiceOutputAvailability(): VoiceOutputAvailabilityState {
  return state;
}

/**
 * Reads the app health status and reports whether the server-side
 * voice-output switch is on. Any failure — network, non-200, malformed
 * body, or a missing/false field — means "not available".
 */
export async function probeVoiceOutputAvailability(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(VOICE_OUTPUT_STATUS_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return Boolean(
      body
      && typeof body === 'object'
      && (body as { voiceOutputEnabled?: unknown }).voiceOutputEnabled === true,
    );
  } catch {
    return false;
  }
}

/**
 * Runs the availability probe and publishes the result. Called once by
 * the main.tsx bootstrap; tests call it with a stubbed fetch to drive
 * the store through the same code path. The latest call wins.
 */
export async function refreshVoiceOutputAvailability(
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceOutputAvailabilityState> {
  const runId = ++probeRunId;
  const available = await probeVoiceOutputAvailability(fetchImpl);
  if (runId !== probeRunId) return state;
  setState(available ? 'available' : 'unavailable');
  return state;
}
