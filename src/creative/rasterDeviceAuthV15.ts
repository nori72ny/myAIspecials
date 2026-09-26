import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Request, Response as ExpressResponse } from 'express';

const AUTH_ORIGIN = 'https://enter.pollinations.ai';
const DEVICE_CLIENT_ID = 'pk_NgBAArhUeGvSRFba';
const DEVICE_SCOPE = 'generate usage';
const DATA_KEY_ENV = 'ORIGIN_CODING_JOB_DATA_KEY';
const PENDING_COOKIE = '__Host-origin-image-device';
const TOKEN_COOKIE = '__Host-origin-image-token';
const MAX_COOKIE_BYTES = 3800;
const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

type PendingStateV15 = {
  deviceCode: string;
  clientId: string;
  expiresAt: number;
  intervalSeconds: number;
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

export function rasterDeviceAuthConfiguredV15(env: NodeJS.ProcessEnv = process.env): boolean {
  try { dataKey(env); return true; } catch { return false; }
}

export function resolveRasterDeviceApiKeyV15(req: Request, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const state = open<TokenStateV15>('token', cookies(req).get(TOKEN_COOKIE), env);
  if (!state || !exactText(state.accessToken, 8192) || !state.accessToken.startsWith('sk_')
    || !Number.isSafeInteger(state.expiresAt) || state.expiresAt <= Date.now()
    || typeof state.scope !== 'string' || !state.scope.split(/\s+/).includes('usage')) return undefined;
  return state.accessToken;
}

export async function startRasterDeviceAuthV15(req: Request, res: ExpressResponse, env: NodeJS.ProcessEnv = process.env) {
  if (!rasterDeviceAuthConfiguredV15(env)) return res.status(503).json({ ok: false, code: 'IMAGE_AUTH_KEY_UNAVAILABLE' });
  const form = new URLSearchParams({ client_id: DEVICE_CLIENT_ID, scope: DEVICE_SCOPE });
  const { response, body } = await fetchJson(`${AUTH_ORIGIN}/api/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  const deviceCode = exactText(body.device_code, 2048);
  const userCode = exactText(body.user_code, 64);
  const verificationUriRaw = exactText(body.verification_uri, 2048);
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in);
  const interval = typeof body.interval === 'number' ? body.interval : Number(body.interval);
  if (!response.ok || !deviceCode || !userCode || !verificationUriRaw || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 1800
    || !Number.isFinite(interval) || interval < 1 || interval > 60) {
    return res.status(502).json({ ok: false, code: 'IMAGE_DEVICE_AUTH_START_FAILED' });
  }
  const verificationUri = new URL(verificationUriRaw, AUTH_ORIGIN);
  if (verificationUri.origin !== AUTH_ORIGIN || verificationUri.protocol !== 'https:') {
    return res.status(502).json({ ok: false, code: 'IMAGE_DEVICE_AUTH_URI_INVALID' });
  }
  const expiresAt = Date.now() + Math.floor(expiresIn * 1000);
  setCookie(res, PENDING_COOKIE, seal('pending', {
    deviceCode,
    clientId: DEVICE_CLIENT_ID,
    expiresAt,
    intervalSeconds: Math.ceil(interval),
  } satisfies PendingStateV15, env), expiresIn);
  return res.status(200).json({
    ok: true,
    userCode,
    verificationUri: verificationUri.href,
    expiresIn: Math.floor(expiresIn),
    interval: Math.ceil(interval),
    scope: DEVICE_SCOPE,
    secretDelivery: 'server-only',
  });
}

export async function completeRasterDeviceAuthV15(req: Request, res: ExpressResponse, env: NodeJS.ProcessEnv = process.env) {
  const state = open<PendingStateV15>('pending', cookies(req).get(PENDING_COOKIE), env);
  if (!state || !exactText(state.deviceCode, 2048) || state.clientId !== DEVICE_CLIENT_ID
    || !Number.isSafeInteger(state.expiresAt) || state.expiresAt <= Date.now()) {
    clearCookie(res, PENDING_COOKIE);
    return res.status(409).json({ ok: false, code: 'IMAGE_DEVICE_AUTH_EXPIRED' });
  }

  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: state.deviceCode,
    client_id: DEVICE_CLIENT_ID,
  });
  const { response, body } = await fetchJson(`${AUTH_ORIGIN}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  if (!response.ok) {
    if (body.error === 'authorization_pending' || body.error === 'slow_down') {
      return res.status(202).json({ ok: false, pending: true, code: String(body.error), interval: state.intervalSeconds });
    }
    clearCookie(res, PENDING_COOKIE);
    return res.status(409).json({ ok: false, code: 'IMAGE_DEVICE_AUTH_DENIED' });
  }

  const accessToken = exactText(body.access_token, 8192);
  const tokenType = exactText(body.token_type, 64);
  const scope = exactText(body.scope, 512) ?? DEVICE_SCOPE;
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS);
  if (!accessToken || !accessToken.startsWith('sk_') || tokenType?.toLowerCase() !== 'bearer'
    || !scope.split(/\s+/).includes('usage') || !Number.isFinite(expiresIn) || expiresIn < 60) {
    clearCookie(res, PENDING_COOKIE);
    return res.status(502).json({ ok: false, code: 'IMAGE_DEVICE_TOKEN_INVALID' });
  }
  const ttlSeconds = Math.min(DEFAULT_TOKEN_TTL_SECONDS, Math.floor(expiresIn));
  setCookie(res, TOKEN_COOKIE, seal('token', {
    accessToken,
    expiresAt: Date.now() + ttlSeconds * 1000,
    scope,
  } satisfies TokenStateV15, env), ttlSeconds);
  clearCookie(res, PENDING_COOKIE);
  return res.status(200).json({ ok: true, connected: true, expiresIn: ttlSeconds, scope, secretDelivery: 'server-only' });
}

export function disconnectRasterDeviceAuthV15(_req: Request, res: ExpressResponse) {
  clearCookie(res, TOKEN_COOKIE);
  clearCookie(res, PENDING_COOKIE);
  return res.status(200).json({ ok: true, connected: false });
}
