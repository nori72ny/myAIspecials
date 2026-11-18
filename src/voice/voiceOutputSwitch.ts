export const ORIGIN_VOICE_OUTPUT_ENABLED_ENV = 'ORIGIN_VOICE_OUTPUT_ENABLED' as const;

/** The voice-output feature switch (VC-1, VOICE_CONVERSATION_DESIGN
 * 2026-11-18), in the same style as ORIGIN_AGENT_ATTACHMENTS_ENABLED:
 * only the exact string "true" enables it; anything else is OFF. The
 * switch gates the whole read-aloud surface — the /api/health status
 * field below is the only thing a disabled deployment reveals. */
export function voiceOutputEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_VOICE_OUTPUT_ENABLED_ENV] === 'true';
}
