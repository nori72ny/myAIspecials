import { probeVoiceInputAvailability } from './voiceTranscribeClient';

/**
 * Voice availability store (PR-V3).
 *
 * The availability probe runs exactly once, from the application
 * bootstrap in main.tsx — the same place the active-context chat bridge
 * is installed. Components only read this store; they never probe on
 * mount. That keeps the App free of mount-time network calls (the chat
 * test suite treats every fetch as an app API call, and a probe would
 * also spend chat rate-limit budget on every page load), while the
 * composer still shows the microphone button only after the server has
 * proven the voice endpoint is enabled. Until the probe resolves, and
 * whenever it resolves to "not available", the button stays hidden
 * (fail closed).
 */

export type VoiceAvailabilityState = 'checking' | 'available' | 'unavailable';

let state: VoiceAvailabilityState = 'checking';
let probeRunId = 0;
const listeners = new Set<() => void>();

function setState(next: VoiceAvailabilityState) {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeVoiceAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVoiceAvailability(): VoiceAvailabilityState {
  return state;
}

/**
 * Runs the availability probe and publishes the result. Called once by
 * the main.tsx bootstrap; tests call it with a stubbed fetch to drive
 * the store through the same code path. The latest call wins.
 */
export async function refreshVoiceAvailability(
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceAvailabilityState> {
  const runId = ++probeRunId;
  const available = await probeVoiceInputAvailability(fetchImpl);
  if (runId !== probeRunId) return state;
  setState(available ? 'available' : 'unavailable');
  return state;
}
