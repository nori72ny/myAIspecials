import { agentOperatorAuthorizationModeV3 } from './agentOperatorAuthV3.js';

export const AGENT_CODING_BRIDGE_FLAG_V3 = 'ORIGIN_AGENT_CODING_BRIDGE_ENABLED' as const;

/**
 * Production activation is explicit opt-in. Presence of Coding V1.4 stores or
 * credentials must never silently enable Agent-triggered coding.
 */
export function agentCodingBridgeEnabledV3(env: NodeJS.ProcessEnv = process.env): boolean {
  // The bridge can mutate source code. Unlike the legacy read-only Agent
  // routes it must never ask the browser to present the signing/HMAC secret.
  // A separated server-side signing key and operator credential is mandatory.
  return env[AGENT_CODING_BRIDGE_FLAG_V3] === 'true'
    && agentOperatorAuthorizationModeV3(env) === 'agent-operator';
}
