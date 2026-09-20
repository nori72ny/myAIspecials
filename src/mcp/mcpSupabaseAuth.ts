import type { Request } from 'express';

export const MCP_ACCESS_SESSION_COOKIE = '__Host-origin-session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_RESPONSE_BYTES = 32 * 1024;

export type McpSupabaseAuthFetch = (input: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>;
export interface McpSupabaseAuthOptions {
  supabaseUrl: string;
  publishableKey: string;
  allowedOwnerIds: readonly string[];
  fetchImpl?: McpSupabaseAuthFetch;
  timeoutMs?: number;
}
export interface McpSupabaseVerifiedSession {
  subjectId: string;
  sessionBinding: string;
}

type NormalizedAuth = {
  origin: string;
  key: string;
  owners: ReadonlySet<string>;
  fetchImpl: McpSupabaseAuthFetch;
  timeoutMs: number;
};

function exactProjectOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || url.pathname !== '/') return undefined;
    return url.origin;
  } catch { return undefined; }
}

function normalize(options: McpSupabaseAuthOptions): NormalizedAuth {
  const origin = exactProjectOrigin(options.supabaseUrl);
  const key = options.publishableKey;
  const owners = new Set(options.allowedOwnerIds.map(value => value.toLowerCase()));
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!origin || !key || key.length > 2_048 || /[\r\n]/.test(key) || owners.size < 1 || owners.size > 20
    || [...owners].some(value => !UUID.test(value)) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 10_000) {
    throw new Error('MCP_AUTH_CONFIG_INVALID');
  }
  return { origin, key, owners, timeoutMs, fetchImpl: options.fetchImpl ?? fetch };
}

function cookie(req: Request): string | undefined {
  const header = req.get('cookie');
  if (!header || header.length > 16_384) return undefined;
  const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(`${MCP_ACCESS_SESSION_COOKIE}=`));
  if (values.length !== 1) return undefined;
  const token = values[0].slice(MCP_ACCESS_SESSION_COOKIE.length + 1);
  return token.length <= 8_192 && JWT.test(token) ? token : undefined;
}

function verifiedJwtSession(token: string): { subjectId: string; sessionBinding: string } | undefined {
  try {
    const payloadPart = token.split('.')[1];
    const bytes = Buffer.from(payloadPart, 'base64url');
    if (!bytes.length || bytes.length > 8_192) return undefined;
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const claims = value as Record<string, unknown>;
    const subjectId = typeof claims.sub === 'string' ? claims.sub.toLowerCase() : '';
    const sessionBinding = typeof claims.session_id === 'string' ? claims.session_id.toLowerCase() : '';
    if (!UUID.test(subjectId) || !UUID.test(sessionBinding)) return undefined;
    return { subjectId, sessionBinding };
  } catch { return undefined; }
}

async function boundedJson(response: Response): Promise<Record<string, unknown> | undefined> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) return undefined;
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return undefined;
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        // Failure must not wait for an untrusted response stream to acknowledge
        // cancellation. The request-level AbortController closes the transport.
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(next.value);
    }
  } catch { return undefined; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

async function verifyWithConfig(config: NormalizedAuth, token: string): Promise<McpSupabaseVerifiedSession | null> {
  if (token.length > 8_192 || !JWT.test(token)) return null;
  const verifiedSession = verifiedJwtSession(token);
  if (!verifiedSession) return null;
  const endpoint = `${config.origin}/auth/v1/user`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.timeoutMs);
  try {
    const response = await config.fetchImpl(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json', apikey: config.key, authorization: `Bearer ${token}`, 'accept-encoding': 'identity' },
      cache: 'no-store', redirect: 'error', signal: abort.signal,
    });
    if (!response.ok || response.url && response.url !== endpoint) return null;
    const user = await boundedJson(response);
    const id = typeof user?.id === 'string' ? user.id.toLowerCase() : '';
    if (!UUID.test(id) || user?.role !== 'authenticated' || !config.owners.has(id) || verifiedSession.subjectId !== id) return null;
    return { subjectId: `supabase:${id}`, sessionBinding: verifiedSession.sessionBinding };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/**
 * Build a verifier for access tokens obtained only from the configured Supabase
 * project. It checks the exact token at /auth/v1/user on every call, then binds
 * the verified user id to the JWT session_id and the server-side owner allowlist.
 */
export function createSupabaseMcpAccessTokenVerifier(options: McpSupabaseAuthOptions) {
  const config = normalize(options);
  return (token: string): Promise<McpSupabaseVerifiedSession | null> => verifyWithConfig(config, token);
}

/**
 * Validate the browser's HttpOnly session against Supabase Auth on every MCP
 * management request. No user metadata or unsigned browser identity is trusted.
 * The JWT session_id/sub are parsed only after the exact bearer token has been
 * accepted by /auth/v1/user, then cross-checked against the returned user id.
 */
export function createSupabaseMcpAuthenticator(options: McpSupabaseAuthOptions) {
  const verify = createSupabaseMcpAccessTokenVerifier(options);
  return async (req: Request): Promise<McpSupabaseVerifiedSession | null> => {
    const token = cookie(req);
    return token ? verify(token) : null;
  };
}

export function readSupabaseMcpAuthOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: McpSupabaseAuthFetch,
): McpSupabaseAuthOptions | undefined {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const allowedOwnerIds = env.ORIGIN_OWNER_SUPABASE_USER_IDS?.split(',').map(value => value.trim()).filter(Boolean);
  if (!supabaseUrl || !publishableKey || !allowedOwnerIds?.length) return undefined;
  return { supabaseUrl, publishableKey, allowedOwnerIds, fetchImpl };
}

export function createSupabaseMcpAuthenticatorFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: McpSupabaseAuthFetch,
) {
  const options = readSupabaseMcpAuthOptionsFromEnv(env, fetchImpl);
  if (!options) return undefined;
  try { return createSupabaseMcpAuthenticator(options); }
  catch { return undefined; }
}
