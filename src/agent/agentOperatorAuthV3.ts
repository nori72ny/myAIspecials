import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const AGENT_OPERATOR_SECRET_ENV = 'ORIGIN_AGENT_OPERATOR_SECRET';
const LEGACY_APPROVAL_SECRET_ENV = 'ORIGIN_AGENT_APPROVAL_SECRET';
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 512;

export type AgentOperatorAuthorizationModeV3 = 'agent-operator' | 'legacy-approval-compat' | 'unconfigured';

type ConfiguredCredential = {
  mode: Exclude<AgentOperatorAuthorizationModeV3, 'unconfigured'>;
  secret: Buffer;
};

function normalizedSecret(value: string | undefined): Buffer | null {
  if (typeof value !== 'string') return null;
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length < MIN_SECRET_BYTES || bytes.length > MAX_SECRET_BYTES) return null;
  return bytes;
}

function configuredCredential(env: NodeJS.ProcessEnv): ConfiguredCredential | null {
  // Once the dedicated operator credential is present, malformed configuration
  // fails closed. Never silently broaden browser authority back to the HMAC key.
  if (env[AGENT_OPERATOR_SECRET_ENV] !== undefined) {
    const secret = normalizedSecret(env[AGENT_OPERATOR_SECRET_ENV]);
    return secret ? { mode: 'agent-operator', secret } : null;
  }

  // Migration-only compatibility for current deployments. The status endpoint
  // makes this mode explicit so it is never misreported as key separation.
  const legacy = normalizedSecret(env[LEGACY_APPROVAL_SECRET_ENV]);
  return legacy ? { mode: 'legacy-approval-compat', secret: legacy } : null;
}

function presentedBearer(req: Request): Buffer | null {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const value = header.slice('Bearer '.length).trim();
  if (!value) return null;
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > MAX_SECRET_BYTES) return null;
  return bytes;
}

export function agentOperatorAuthorizationModeV3(env: NodeJS.ProcessEnv = process.env): AgentOperatorAuthorizationModeV3 {
  return configuredCredential(env)?.mode ?? 'unconfigured';
}

export function agentOperatorConfiguredV3(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredCredential(env) !== null;
}

export function authenticateAgentOperatorV3(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = configuredCredential(env);
  const presented = presentedBearer(req);
  if (!configured || !presented || configured.secret.length !== presented.length) return false;
  return timingSafeEqual(configured.secret, presented);
}
