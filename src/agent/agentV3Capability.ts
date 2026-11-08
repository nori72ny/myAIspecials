import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET_MIN_LENGTH = 32;
// Exported so the durable run record (agentRunRecord.ts) and the piggyback
// evaluator can derive approval deadlines from the same numbers the
// capabilities themselves use: a plan may be approved until the last
// instant of its TTL, and that approval stays usable for its own TTL.
export const PLAN_TTL_MS = 10 * 60 * 1000;
export const APPROVAL_TTL_MS = 2 * 60 * 1000;
const MAX_TOKEN_LENGTH = 2048;

type CapabilityKind = 'plan' | 'approval';

export type AgentApprovalAuthModeV3 = 'operator' | 'browser';

type CapabilityPayload = {
  v: 3;
  kind: CapabilityKind;
  runId: string;
  digest: string;
  plannedTool?: string;
  plannedTools?: string[];
  paramsDigest?: string;
  authMode?: AgentApprovalAuthModeV3;
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

function issue(
  kind: CapabilityKind,
  runId: string,
  digest: string,
  ttlMs: number,
  env: NodeJS.ProcessEnv,
  now: number,
  plannedTool?: string,
  paramsDigest?: string,
  extras?: { plannedTools?: string[]; authMode?: AgentApprovalAuthModeV3 },
): string {
  const key = secret(env);
  if (!key) throw new Error('AGENT_APPROVAL_NOT_CONFIGURED');
  const payload: CapabilityPayload = {
    v: 3,
    kind,
    runId,
    digest,
    ...(kind === 'plan' && plannedTool ? { plannedTool } : {}),
    ...(kind === 'plan' && extras?.plannedTools?.length ? { plannedTools: extras.plannedTools } : {}),
    ...(kind === 'plan' && paramsDigest ? { paramsDigest } : {}),
    ...(kind === 'approval' && extras?.authMode ? { authMode: extras.authMode } : {}),
    iat: now,
    exp: now + ttlMs,
  };
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
    if (parsed.plannedTool !== undefined && (typeof parsed.plannedTool !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(parsed.plannedTool))) return null;
    if (parsed.plannedTools !== undefined && (!Array.isArray(parsed.plannedTools) || parsed.plannedTools.length < 1 || parsed.plannedTools.length > 8 || parsed.plannedTools.some(tool => typeof tool !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(tool)))) return null;
    if (parsed.paramsDigest !== undefined && (typeof parsed.paramsDigest !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.paramsDigest))) return null;
    if (parsed.authMode !== undefined && parsed.authMode !== 'operator' && parsed.authMode !== 'browser') return null;
    if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number' || parsed.exp <= now || parsed.iat > now + 30_000) return null;
    return parsed as CapabilityPayload;
  } catch {
    return null;
  }
}

export function v3CapabilityConfigured(env: NodeJS.ProcessEnv): boolean {
  return secret(env) !== null;
}

export function issuePlanCapability(
  runId: string,
  goalDigest: string,
  env: NodeJS.ProcessEnv,
  now = Date.now(),
  plannedTool?: string,
  paramsDigest?: string,
  plannedTools?: string[],
): { token: string; expiresAt: number } {
  return { token: issue('plan', runId, goalDigest, PLAN_TTL_MS, env, now, plannedTool, paramsDigest, { plannedTools }), expiresAt: now + PLAN_TTL_MS };
}

export function verifyPlanCapability(token: string, env: NodeJS.ProcessEnv, now = Date.now()): CapabilityPayload | null {
  return verify(token, 'plan', env, now);
}

/** An approval may be issued until the last instant of a valid plan. */
export function latestApprovalExpiryForPlan(planExpiresAt: number): number {
  return planExpiresAt + APPROVAL_TTL_MS;
}

export function issueApprovalCapability(runId: string, operationDigest: string, env: NodeJS.ProcessEnv, now = Date.now(), authMode: AgentApprovalAuthModeV3 = 'operator'): { token: string; expiresAt: number } {
  return { token: issue('approval', runId, operationDigest, APPROVAL_TTL_MS, env, now, undefined, undefined, { authMode }), expiresAt: now + APPROVAL_TTL_MS };
}

export function verifyApprovalCapability(token: string, env: NodeJS.ProcessEnv, now = Date.now()): CapabilityPayload | null {
  return verify(token, 'approval', env, now);
}
