import { Router, type Request, type Response } from 'express';
import { createOriginChatRateLimiter } from '../server/originSecurity.js';
import {
  MCP_ACCESS_SESSION_COOKIE,
  createSupabaseMcpAccessTokenVerifier,
  readSupabaseMcpAuthOptionsFromEnv,
  type McpSupabaseAuthFetch,
  type McpSupabaseAuthOptions,
} from './mcpSupabaseAuth.js';

const REFRESH_COOKIE = '__Host-origin-refresh';
const ACCESS_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const REFRESH_TOKEN = /^[A-Za-z0-9._~+\-/=]+$/;
const MAX_TOKEN_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_EMAIL_BYTES = 320;
const MAX_PASSWORD_BYTES = 4_096;

class McpOwnerSessionError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

type TokenSet = { accessToken: string; refreshToken: string; expiresIn: number };
type TokenResult = { kind: 'ok'; tokens: TokenSet } | { kind: 'rejected' } | { kind: 'unavailable' };

function exactAppOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url.origin;
  } catch { return undefined; }
}

function cookieValue(req: Request, name: string, pattern: RegExp): string | undefined {
  const header = req.get('cookie');
  if (!header || header.length > 16_384) return undefined;
  const prefix = `${name}=`;
  const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(prefix));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(prefix.length);
  return value.length > 0 && value.length <= MAX_TOKEN_BYTES && pattern.test(value) ? value : undefined;
}

function authCookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
function expiredCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
function clearCookies(res: Response): void {
  res.append('Set-Cookie', expiredCookie(MCP_ACCESS_SESSION_COOKIE));
  res.append('Set-Cookie', expiredCookie(REFRESH_COOKIE));
}
function setCookies(res: Response, tokens: TokenSet): void {
  res.append('Set-Cookie', authCookie(MCP_ACCESS_SESSION_COOKIE, tokens.accessToken));
  res.append('Set-Cookie', authCookie(REFRESH_COOKIE, tokens.refreshToken));
}

async function boundedJson(response: Response): Promise<Record<string, unknown> | undefined> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) return undefined;
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
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

function tokenSet(value: Record<string, unknown> | undefined): TokenSet | undefined {
  const accessToken = typeof value?.access_token === 'string' ? value.access_token : '';
  const refreshToken = typeof value?.refresh_token === 'string' ? value.refresh_token : '';
  const expiresIn = value?.expires_in;
  const tokenType = typeof value?.token_type === 'string' ? value.token_type.toLowerCase() : '';
  if (!ACCESS_TOKEN.test(accessToken) || accessToken.length > MAX_TOKEN_BYTES
    || !REFRESH_TOKEN.test(refreshToken) || refreshToken.length > MAX_TOKEN_BYTES
    || !Number.isSafeInteger(expiresIn) || Number(expiresIn) < 1 || Number(expiresIn) > 86_400
    || tokenType !== 'bearer') return undefined;
  return { accessToken, refreshToken, expiresIn: Number(expiresIn) };
}

function exactBody(req: Request, keys: readonly string[]): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !keys.includes(key))) {
    throw new McpOwnerSessionError('MCP_SESSION_REQUEST_INVALID', 400);
  }
  return req.body as Record<string, unknown>;
}

export interface McpOwnerSessionRouterOptions extends McpSupabaseAuthOptions {
  appOrigin: string;
}

export function createSupabaseMcpOwnerSessionRouter(options: McpOwnerSessionRouterOptions) {
  const appOrigin = exactAppOrigin(options.appOrigin);
  if (!appOrigin) throw new Error('MCP_SESSION_CONFIG_INVALID');
  const verifyAccessToken = createSupabaseMcpAccessTokenVerifier(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const supabaseOrigin = new URL(options.supabaseUrl).origin;
  const key = options.publishableKey;
  const passwordEndpoint = `${supabaseOrigin}/auth/v1/token?grant_type=password`;
  const refreshEndpoint = `${supabaseOrigin}/auth/v1/token?grant_type=refresh_token`;
  const logoutEndpoint = `${supabaseOrigin}/auth/v1/logout?scope=local`;
  const router = Router();

  router.use('/api/mcp/session', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use('/api/mcp/session', createOriginChatRateLimiter(Date.now, ['POST']));

  function mutation(req: Request): void {
    if (req.get('origin') !== appOrigin || req.get('x-origin-mcp-intent') !== 'manage') throw new McpOwnerSessionError('MCP_CROSS_ORIGIN_BLOCKED', 403);
    if (!req.is('application/json')) throw new McpOwnerSessionError('MCP_JSON_REQUIRED', 415);
  }

  async function exchange(endpoint: string, payload: Record<string, string>): Promise<TokenResult> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', apikey: key, 'content-type': 'application/json', 'accept-encoding': 'identity' },
        body: JSON.stringify(payload), cache: 'no-store', redirect: 'error', signal: abort.signal,
      });
      if (response.url && response.url !== endpoint) return { kind: 'unavailable' };
      if (!response.ok) return { kind: response.status >= 400 && response.status < 500 ? 'rejected' : 'unavailable' };
      const tokens = tokenSet(await boundedJson(response));
      return tokens ? { kind: 'ok', tokens } : { kind: 'unavailable' };
    } catch { return { kind: 'unavailable' }; }
    finally { clearTimeout(timer); }
  }

  function failure(res: Response, error: unknown) {
    if (error instanceof McpOwnerSessionError) return res.status(error.status).json({ ok: false, code: error.code });
    return res.status(503).json({ ok: false, code: 'MCP_SESSION_UNAVAILABLE' });
  }

  router.post('/api/mcp/session/login', async (req, res) => {
    try {
      mutation(req);
      const value = exactBody(req, ['email', 'password']);
      const email = typeof value.email === 'string' ? value.email.trim() : '';
      const password = typeof value.password === 'string' ? value.password : '';
      if (!email || Buffer.byteLength(email) > MAX_EMAIL_BYTES || /[\x00-\x20\x7f]/.test(email)
        || !password || Buffer.byteLength(password) > MAX_PASSWORD_BYTES || password.includes('\0')) {
        throw new McpOwnerSessionError('MCP_SESSION_REQUEST_INVALID', 400);
      }
      const result = await exchange(passwordEndpoint, { email, password });
      if (result.kind === 'rejected') { clearCookies(res); throw new McpOwnerSessionError('MCP_LOGIN_FAILED', 401); }
      if (result.kind === 'unavailable') throw new McpOwnerSessionError('MCP_SESSION_UNAVAILABLE', 503);
      const verified = await verifyAccessToken(result.tokens.accessToken);
      if (!verified) { clearCookies(res); throw new McpOwnerSessionError('MCP_LOGIN_FAILED', 401); }
      setCookies(res, result.tokens);
      return res.json({ ok: true, authenticated: true });
    } catch (error) { return failure(res, error); }
  });

  router.post('/api/mcp/session/refresh', async (req, res) => {
    try {
      mutation(req); exactBody(req, []);
      const refreshToken = cookieValue(req, REFRESH_COOKIE, REFRESH_TOKEN);
      if (!refreshToken) { clearCookies(res); throw new McpOwnerSessionError('MCP_SESSION_EXPIRED', 401); }
      const result = await exchange(refreshEndpoint, { refresh_token: refreshToken });
      if (result.kind === 'rejected') { clearCookies(res); throw new McpOwnerSessionError('MCP_SESSION_EXPIRED', 401); }
      if (result.kind === 'unavailable') throw new McpOwnerSessionError('MCP_SESSION_UNAVAILABLE', 503);
      const verified = await verifyAccessToken(result.tokens.accessToken);
      if (!verified) { clearCookies(res); throw new McpOwnerSessionError('MCP_SESSION_EXPIRED', 401); }
      setCookies(res, result.tokens);
      return res.json({ ok: true, authenticated: true });
    } catch (error) { return failure(res, error); }
  });

  router.post('/api/mcp/session/logout', async (req, res) => {
    try {
      mutation(req); exactBody(req, []);
      const accessToken = cookieValue(req, MCP_ACCESS_SESSION_COOKIE, ACCESS_TOKEN);
      clearCookies(res);
      if (accessToken) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        try {
          await fetchImpl(logoutEndpoint, {
            method: 'POST',
            headers: { accept: 'application/json', apikey: key, authorization: `Bearer ${accessToken}`, 'accept-encoding': 'identity' },
            cache: 'no-store', redirect: 'error', signal: abort.signal,
          });
        } catch { /* Local logout is authoritative even if remote revocation is unavailable. */ }
        finally { clearTimeout(timer); }
      }
      return res.json({ ok: true, authenticated: false });
    } catch (error) { return failure(res, error); }
  });

  return router;
}

export function createSupabaseMcpOwnerSessionRouterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: McpSupabaseAuthFetch,
) {
  const appOrigin = env.APP_URL?.trim();
  const auth = readSupabaseMcpAuthOptionsFromEnv(env, fetchImpl);
  if (!appOrigin || !auth) return undefined;
  try { return createSupabaseMcpOwnerSessionRouter({ appOrigin, ...auth }); }
  catch { return undefined; }
}
