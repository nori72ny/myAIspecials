export const AGENT_CODING_BRIDGE_FLAG_V3 = 'ORIGIN_AGENT_CODING_BRIDGE_ENABLED' as const;

/**
 * Production activation is explicit opt-in. Presence of Coding V1.4 stores or
 * credentials must never silently enable Agent-triggered coding.
 */
export function agentCodingBridgeEnabledV3(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AGENT_CODING_BRIDGE_FLAG_V3] === 'true';
}
