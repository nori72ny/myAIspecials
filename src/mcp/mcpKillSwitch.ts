/**
 * Single source of truth for the MCP kill switch (PR-1c).
 *
 * This lives in its own leaf module on purpose: mcpProductionRuntime.ts
 * imports the agent router and the Node integration, so a helper placed
 * there would be circular for the consumption points that need it. Every
 * composition point (mcpProductionRuntime) and every consumption point
 * (the /api/mcp/chat handler, the agent session factory, and the
 * connection service's live-connection methods) consults this one
 * predicate, keeping exactly one definition of "MCP is enabled": the
 * exact string 'true'. Any other value — unset, 'false', different
 * casing, surrounding whitespace — is disabled, and disabled means the
 * external surface fails closed before credentials or transports are
 * touched.
 */
export function isMcpEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.ORIGIN_MCP_ENABLED === 'true';
}
