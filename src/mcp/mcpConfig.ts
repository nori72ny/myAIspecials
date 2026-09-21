import { McpBoundaryError } from './mcpClient.js';

export interface McpConnectionConfig {
  id: string;
  url: string;
  enabled: boolean;
  tokenEnv?: string;
}
/** Server-only configuration. Tokens are resolved AFTER JSON parsing, never substituted into raw JSON. */
export function parseMcpConnections(raw: string, env: Record<string, string | undefined>): Array<McpConnectionConfig & { token?: string }> {
  const invalid = () => { throw new McpBoundaryError('MCP_CONFIG_INVALID'); };
  if (Buffer.byteLength(raw) > 64 * 1024) invalid();
  let values: unknown;
  try { values = JSON.parse(raw); } catch { invalid(); }
  if (!Array.isArray(values) || values.length > 20) return invalid();
  const ids = new Set<string>();
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(key => !['id', 'url', 'enabled', 'tokenEnv'].includes(key))) return invalid();
    if (typeof v.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(v.id) || ids.has(v.id) || typeof v.url !== 'string' || typeof v.enabled !== 'boolean') return invalid();
    ids.add(v.id);
    let url: URL;
    try { url = new URL(v.url); } catch { return invalid(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) return invalid();
    if (v.tokenEnv !== undefined && (typeof v.tokenEnv !== 'string' || !/^ORIGIN_MCP_[A-Z0-9_]+_TOKEN$/.test(v.tokenEnv))) return invalid();
    const tokenEnv = v.tokenEnv as string | undefined;
    const token = v.enabled && tokenEnv ? env[tokenEnv] : undefined;
    if (v.enabled && tokenEnv && (!token || /[\r\n]/.test(token))) throw new McpBoundaryError('MCP_CREDENTIAL_MISSING_OR_INVALID');
    return { id: v.id, url: url.href, enabled: v.enabled, ...(tokenEnv ? { tokenEnv } : {}), ...(token ? { token } : {}) };
  });
}
