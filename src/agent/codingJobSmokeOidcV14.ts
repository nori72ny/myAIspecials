import { createPublicKey, verify as verifySignature, type JsonWebKey as NodeJsonWebKey, type KeyObject } from 'node:crypto';

export const CODING_SMOKE_OIDC_AUDIENCE_V14 = 'origin-coding-smoke-v14';
export const CODING_SMOKE_OIDC_ISSUER_V14 = 'https://token.actions.githubusercontent.com';
export const CODING_SMOKE_WORKFLOW_REF_V14 = 'nori72ny/myAIspecials/.github/workflows/coding-production-smoke-v14.yml@refs/heads/main';
export const CODING_SMOKE_WORKFLOW_NAME_V14 = 'V1.4 production coding smoke';

const JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const EXPECTED_REPOSITORY = 'nori72ny/myAIspecials';
const EXPECTED_REPOSITORY_ID = '1282163675';
const EXPECTED_REPOSITORY_OWNER = 'nori72ny';
const EXPECTED_REF = 'refs/heads/main';
const EXPECTED_EVENT = 'push';
const EXPECTED_RUNNER = 'github-hosted';
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_JSON_BYTES = 8 * 1024;
const MAX_JWKS_BYTES = 64 * 1024;
const MAX_TOKEN_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;
const KEY_CACHE_MS = 10 * 60_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DIGITS = /^\d+$/;

type FetchLike = typeof fetch;

type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

type JwtPayload = Record<string, unknown>;

type CachedKey = { key: KeyObject; expiresAt: number };
const keyCache = new Map<string, CachedKey>();

export type VerifiedCodingSmokeOidcV14 = {
  sha: string;
  runId: string;
};

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const bytes = Buffer.from(segment, 'base64url');
    if (bytes.length === 0 || bytes.length > MAX_JSON_BYTES || bytes.toString('base64url') !== segment) return null;
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function boundedInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? Number(value) : null;
}

function preliminaryClaimsValid(payload: JwtPayload, nowSeconds: number): payload is JwtPayload & { sha: string; run_id: string } {
  const iat = boundedInteger(payload.iat);
  const nbf = boundedInteger(payload.nbf);
  const exp = boundedInteger(payload.exp);
  if (iat === null || nbf === null || exp === null) return false;
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS || nbf > nowSeconds + CLOCK_SKEW_SECONDS || exp <= nowSeconds - CLOCK_SKEW_SECONDS) return false;
  if (iat < nowSeconds - MAX_TOKEN_AGE_SECONDS || exp - iat <= 0 || exp - iat > MAX_TOKEN_AGE_SECONDS + CLOCK_SKEW_SECONDS) return false;
  if (payload.iss !== CODING_SMOKE_OIDC_ISSUER_V14) return false;
  if (payload.aud !== CODING_SMOKE_OIDC_AUDIENCE_V14) return false;
  if (payload.repository !== EXPECTED_REPOSITORY || payload.repository_id !== EXPECTED_REPOSITORY_ID) return false;
  if (payload.repository_owner !== EXPECTED_REPOSITORY_OWNER) return false;
  if (payload.repository_visibility !== 'public') return false;
  if (payload.ref !== EXPECTED_REF || payload.ref_type !== 'branch') return false;
  if (payload.event_name !== EXPECTED_EVENT || payload.runner_environment !== EXPECTED_RUNNER) return false;
  if (payload.workflow !== CODING_SMOKE_WORKFLOW_NAME_V14 || payload.workflow_ref !== CODING_SMOKE_WORKFLOW_REF_V14) return false;
  if (typeof payload.sha !== 'string' || !SHA_PATTERN.test(payload.sha)) return false;
  if (payload.workflow_sha !== payload.sha) return false;
  if (typeof payload.run_id !== 'string' || !DIGITS.test(payload.run_id)) return false;
  if (typeof payload.jti !== 'string' || payload.jti.length < 8 || payload.jti.length > 256) return false;
  if (typeof payload.sub !== 'string' || payload.sub.length < 8 || payload.sub.length > 512) return false;
  return true;
}

async function resolveSigningKey(kid: string, fetchImpl: FetchLike, nowMs: number): Promise<KeyObject | null> {
  const cached = keyCache.get(kid);
  if (cached && cached.expiresAt > nowMs) return cached.key;
  try {
    const response = await fetchImpl(JWKS_URL, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_JWKS_BYTES) return null;
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const keys = (parsed as { keys?: unknown }).keys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 16) return null;
    const candidate = keys.find((value): value is NodeJsonWebKey & { kid: string } => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const jwk = value as Record<string, unknown>;
      return jwk.kid === kid
        && jwk.kty === 'RSA'
        && (jwk.use === undefined || jwk.use === 'sig')
        && (jwk.alg === undefined || jwk.alg === 'RS256')
        && typeof jwk.n === 'string'
        && typeof jwk.e === 'string';
    });
    if (!candidate) return null;
    const key = createPublicKey({ key: candidate, format: 'jwk' });
    keyCache.set(kid, { key, expiresAt: nowMs + KEY_CACHE_MS });
    return key;
  } catch {
    return null;
  }
}

export async function verifyCodingJobSmokeOidcV14(
  token: string,
  options: { fetchImpl?: FetchLike; nowMs?: number } = {},
): Promise<VerifiedCodingSmokeOidcV14 | null> {
  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerText, payloadText, signatureText] = parts;
  const header = decodeJsonSegment(headerText) as JwtHeader | null;
  const payload = decodeJsonSegment(payloadText) as JwtPayload | null;
  if (!header || !payload || header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string' || header.kid.length < 1 || header.kid.length > 256) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(header.kid)) return null;
  const nowMs = options.nowMs ?? Date.now();
  if (!preliminaryClaimsValid(payload, Math.floor(nowMs / 1_000))) return null;
  if (!signatureText || !/^[A-Za-z0-9_-]+$/.test(signatureText)) return null;
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureText, 'base64url');
    if (signature.length < 128 || signature.length > 1024 || signature.toString('base64url') !== signatureText) return null;
  } catch {
    return null;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const key = await resolveSigningKey(header.kid, fetchImpl, nowMs);
  if (!key) return null;
  const verified = verifySignature('RSA-SHA256', Buffer.from(`${headerText}.${payloadText}`, 'ascii'), key, signature);
  if (!verified) return null;
  return { sha: payload.sha.toLowerCase(), runId: payload.run_id };
}
