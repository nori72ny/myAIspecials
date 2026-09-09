import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET_MIN_LENGTH = 32;
const PLAN_TTL_MS = 10 * 60 * 1000;
const APPROVAL_TTL_MS = 2 * 60 * 1000;
const MAX_TOKEN_LENGTH = 2048;

type CapabilityKind = 'plan' | 'approval';

type CapabilityPayload = {
  v: 3;
  kind: CapabilityKind;
  runId: string;
  digest: string;
  iat: number;
  exp: number;
};

function secret(env: NodeJS.ProcessEnv): Buffer | null {
  const value = env.ORIGIN_AGENT_APPROVAL_SECRET;
  if (!value || value.length < SECRET_MIN_LENGTH) return null;
  return Buffer.from(value, 'utf8');
}

function sign(encodedPayload: string, key: Buffer): string {
  return createHmac('sha256', key).update(encodedPayload).digest('base64url');
}

function issue(kind: CapabilityKind, runId: string, digest: string, ttlMs: number, env: NodeJS.ProcessEnv, now: number): string {
  const key = secret(env);
  if (!key) throw new Error('AGENT_APPROVAL_NOT_CONFIGURED');
  const payload: CapabilityPayload = { v: 3, kind, runId, digest, iat: now, exp: now + ttlMs };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

function verify(token: string, expectedKind: CapabilityKind, env: NodeJS.ProcessEnv, now: number): CapabilityPayload | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const key = secret(env);
  if (!key) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = Buffer.from(sign(encoded, key), 'utf8');
  const presented = Buffer.from(signature, 'utf8');
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<CapabilityPayload>;
    if (parsed.v !== 3 || parsed.kind !== expectedKind) return null;
    if (typeof parsed.runId !== 'string' || !parsed.runId.startsWith('run-')) return null;
    if (typeof parsed.digest !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.digest)) return null;
    if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number' || parsed.exp <= now || parsed.iat > now + 30_000) return null;
    return parsed as CapabilityPayload;
  } catch {
    return null;
  }
}

export function v3CapabilityConfigured(env: NodeJS.ProcessEnv): boolean {
  return secret(env) !== null;
}

export function issuePlanCapability(runId: string, goalDigest: string, env: NodeJS.ProcessEnv, now = Date.now()): { token: string; expiresAt: number } {
  return { token: issue('plan', runId, goalDigest, PLAN_TTL_MS, env, now), expiresAt: now + PLAN_TTL_MS };
}

export function verifyPlanCapability(token: string, env: NodeJS.ProcessEnv, now = Date.now()): CapabilityPayload | null {
  return verify(token, 'plan', env, now);
}

export function issueApprovalCapability(runId: string, operationDigest: string, env: NodeJS.ProcessEnv, now = Date.now()): { token: string; expiresAt: number } {
  return { token: issue('approval', runId, operationDigest, APPROVAL_TTL_MS, env, now), expiresAt: now + APPROVAL_TTL_MS };
}

export function verifyApprovalCapability(token: string, env: NodeJS.ProcessEnv, now = Date.now()): CapabilityPayload | null {
  return verify(token, 'approval', env, now);
}
