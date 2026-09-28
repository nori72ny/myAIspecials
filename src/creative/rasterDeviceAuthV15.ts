import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { Request, Response as ExpressResponse } from 'express';

const AUTH_ORIGIN = 'https://enter.pollinations.ai';
const CLIENT_ID_ENV = 'ORIGIN_POLLINATIONS_CLIENT_ID';
const SHARED_SDK_CLIENT_ID = 'pk_NgBAArhUeGvSRFba';
const DATA_KEY_ENV = 'ORIGIN_CODING_JOB_DATA_KEY';
const APP_URL_ENV = 'APP_URL';
const DEVICE_SCOPE = 'usage';
const REQUIRED_DEVICE_SCOPES = ['usage'] as const;
const AUDITED_MODEL = 'tomdacatto/sana';
const ZERO_POLLEN_BUDGET = '0';
const AUTH_EXPIRY_DAYS = '7';
const PENDING_COOKIE = '__Host-origin-image-device';
const TOKEN_COOKIE = '__Host-origin-image-token';
const MAX_COOKIE_BYTES = 3800;
const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

type PendingStateV15 = {
  state: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  expiresAt: number;
};

type TokenStateV15 = {
  accessToken: string;
  expiresAt: number;
  scope: string;
};

function dataKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env[DATA_KEY_ENV]?.trim();
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error('IMAGE_AUTH_KEY_UNAVAILABLE');
  const source = Buffer.from(raw, 'base64');
  if (source.length !== 32 || source.toString('base64') !== raw) throw new Error('IMAGE_AUTH_KEY_UNAVAILABLE');
  return Buffer.from(hkdfSync('sha256', source, Buffer.from('origin-image-auth-v15'), Buffer.from('pollinations-device-cookie'), 32));
}

function deviceClientId(env: NodeJS.ProcessEnv): string {
  const raw = env[CLIENT_ID_ENV]?.trim();
  if (!raw || !/^pk_[A-Za-z0-9]{8,128}$/.test(raw) || raw === SHARED_SDK_CLIENT_ID) {
    throw new Error('IMAGE_AUTH_CLIENT_ID_UNAVAILABLE');
  }
  return raw;
}

function appOrigin(env: NodeJS.ProcessEnv): string {
  const raw = env[APP_URL_ENV]?.trim();
  if (!raw) throw new Error('IMAGE_AUTH_APP_URL_UNAVAILABLE');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.origin !== raw || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('IMAGE_AUTH_APP_URL_UNAVAILABLE');
  }
  return url.origin;
}

function callbackUri(env: NodeJS.ProcessEnv): string {
  return `${appOrigin(env)}/api/creative/v1.5/raster/connect/callback`;
}

function hasRequiredDeviceScopes(scope: string): boolean {
  const granted = new Set(scope.trim().split(/[\s,]+/).filter(Boolean));
  return REQUIRED_DEVICE_SCOPES.every((required) => granted.has(required));
}

function seal(kind: 'pending' | 'token', value: object, env: NodeJS.ProcessEnv): string {
  const key = dataKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`origin-image-auth-v15:${kind}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const result = ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  if (Buffer.byteLength(result) > MAX_COOKIE_BYTES) throw new Error('IMAGE_AUTH_COOKIE_TOO_LARGE');
  return result;
}

function open<T>(kind: 'pending' | 'token', raw: string | undefined, env: NodeJS.ProcessEnv): T | null {
  if (!raw || raw.length > MAX_COOKIE_BYTES || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const [, ivText, tagText, payloadText] = raw.split('.');
    const key = dataKey(env);
    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    const payload = Buffer.from(payloadText, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || payload.length > 8192) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`origin-image-auth-v15:${kind}`));
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}

function cookies(req: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const pair of (req.headers.cookie ?? '').split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name) result.set(name, value);
  }
  return result;
}

function setCookie(res: ExpressResponse, name: string, value: string, maxAgeSeconds: number): void {
  const seconds = Math.max(0, Math.min(DEFAULT_TOKEN_TTL_SECONDS, Math.floor(maxAgeSeconds)));
  res.append('Set-Cookie', `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Strict`);
}

function clearCookie(res: ExpressResponse, name: string): void {
  res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

function exactText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 10_000): Promise<{ response: globalThis.Response; body: Record<string, unknown> }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: abort.signal, redirect: 'error', cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function safeReturnUrl(env: NodeJS.ProcessEnv, status: 'approved' | 'denied' | 'invalid'): string {
  const url = new URL(appOrigin(env));
  url.searchParams.set('image_connect', status);
  return url.href;
}

export function rasterDeviceAuthConfiguredV15(env: NodeJS.ProcessEnv = process.env): boolean {
  try { dataKey(env); deviceClientId(env); callbackUri(env); return true; } catch { return false; }
}

export function resolveRasterDeviceApiKeyV15(req: Request, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const state = open<TokenStateV15>('token', cookies(req).get(TOKEN_COOKIE), env);
  if (!state || !exactText(state.accessToken, 8192) || !state.accessToken.startsWith('sk_')
    || !Number.isSafeInteger(state.expiresAt) || state.expiresAt <= Date.now()
    || typeof state.scope !== 'string' || !hasRequiredDeviceScopes(state.scope)) return undefined;
  return state.accessToken;
}

export async function startRasterDeviceAuthV15(_req: Request, res: ExpressResponse, env: NodeJS.ProcessEnv = process.env) {
  let clientId: string;
  let redirectUri: string;
  try {
    dataKey(env);
    clientId = deviceClientId(env);
    redirectUri = callbackUri(env);
  } catch {
    return res.status(503).json({ ok: false, code: 'IMAGE_AUTH_CONFIGURATION_UNAVAILABLE' });
  }

  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const expiresIn = 10 * 60;
  const expiresAt = Date.now() + expiresIn * 1000;
  setCookie(res, PENDING_COOKIE, seal('pending', {
    state,
    codeVerifier,
    clientId,
    redirectUri,
    expiresAt,
  } satisfies PendingStateV15, env), expiresIn);

  const authorization = new URL('/authorize', AUTH_ORIGIN);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('client_id', clientId);
  authorization.searchParams.set('redirect_uri', redirectUri);
  authorization.searchParams.set('scope', DEVICE_SCOPE);
  authorization.searchParams.set('models', AUDITED_MODEL);
  authorization.searchParams.set('budget', ZERO_POLLEN_BUDGET);
  authorization.searchParams.set('expiry', AUTH_EXPIRY_DAYS);
  authorization.searchParams.set('state', state);
  authorization.searchParams.set('code_challenge', codeChallenge);
  authorization.searchParams.set('code_challenge_method', 'S256');

  return res.status(200).json({
    ok: true,
    authorizationUri: authorization.href,
    expiresIn,
    scope: DEVICE_SCOPE,
    model: AUDITED_MODEL,
    budgetPollen: 0,
    secretDelivery: 'server-only',
  });
}

export async function completeRasterOAuthCallbackV15(req: Request, res: ExpressResponse, env: NodeJS.ProcessEnv = process.env) {
  let clientId: string;
  let expectedRedirect: string;
  try {
    dataKey(env);
    clientId = deviceClientId(env);
    expectedRedirect = callbackUri(env);
  } catch {
    clearCookie(res, PENDING_COOKIE);
    return res.redirect(303, safeReturnUrl(env, 'invalid'));
  }

  const pending = open<PendingStateV15>('pending', cookies(req).get(PENDING_COOKIE), env);
  const code = exactText(req.query.code, 4096);
  const state = exactText(req.query.state, 256);
  const error = exactText(req.query.error, 256);
  if (error) {
    clearCookie(res, PENDING_COOKIE);
    return res.redirect(303, safeReturnUrl(env, 'denied'));
  }
  if (!pending || !code || !state || state !== pending.state || pending.clientId !== clientId
    || pending.redirectUri !== expectedRedirect || !Number.isSafeInteger(pending.expiresAt) || pending.expiresAt <= Date.now()
    || !exactText(pending.codeVerifier, 256)) {
    clearCookie(res, PENDING_COOKIE);
    return res.redirect(303, safeReturnUrl(env, 'invalid'));
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: expectedRedirect,
    code_verifier: pending.codeVerifier,
  });
  const { response, body } = await fetchJson(`${AUTH_ORIGIN}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });

  const accessToken = exactText(body.access_token, 8192);
  const tokenType = exactText(body.token_type, 64);
  const scope = exactText(body.scope, 512) ?? DEVICE_SCOPE;
  const tokenExpiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS);
  if (!response.ok || !accessToken || !accessToken.startsWith('sk_') || tokenType?.toLowerCase() !== 'bearer'
    || !hasRequiredDeviceScopes(scope) || !Number.isFinite(tokenExpiresIn) || tokenExpiresIn < 60) {
    clearCookie(res, PENDING_COOKIE);
    return res.redirect(303, safeReturnUrl(env, 'invalid'));
  }

  const ttlSeconds = Math.min(DEFAULT_TOKEN_TTL_SECONDS, Math.floor(tokenExpiresIn));
  setCookie(res, TOKEN_COOKIE, seal('token', {
    accessToken,
    expiresAt: Date.now() + ttlSeconds * 1000,
    scope,
  } satisfies TokenStateV15, env), ttlSeconds);
  clearCookie(res, PENDING_COOKIE);
  return res.redirect(303, safeReturnUrl(env, 'approved'));
}

export async function completeRasterDeviceAuthV15(req: Request, res: ExpressResponse, env: NodeJS.ProcessEnv = process.env) {
  const connected = Boolean(resolveRasterDeviceApiKeyV15(req, env));
  return res.status(connected ? 200 : 409).json({
    ok: connected,
    connected,
    code: connected ? 'IMAGE_AUTH_CONNECTED' : 'IMAGE_AUTH_NOT_CONNECTED',
    secretDelivery: 'server-only',
  });
}

export function disconnectRasterDeviceAuthV15(_req: Request, res: ExpressResponse) {
  clearCookie(res, TOKEN_COOKIE);
  clearCookie(res, PENDING_COOKIE);
  return res.status(200).json({ ok: true, connected: false });
}
