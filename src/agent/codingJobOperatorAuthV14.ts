import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const CODING_OPERATOR_SECRET_ENV = 'ORIGIN_CODING_OPERATOR_SECRET';
const LEGACY_AGENT_SECRET_ENV = 'ORIGIN_AGENT_APPROVAL_SECRET';
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 512;

export type CodingJobAuthorizationModeV14 = 'coding-operator' | 'legacy-agent-compat' | 'unconfigured';

export const CODING_JOB_OPERATOR_OWNER_BINDING_V14 = 'coding-operator:default-v14';

type ConfiguredCredential = {
  mode: Exclude<CodingJobAuthorizationModeV14, 'unconfigured'>;
  secret: Buffer;
};

function normalizedSecret(value: string | undefined): Buffer | null {
  if (typeof value !== 'string') return null;
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length < MIN_SECRET_BYTES || bytes.length > MAX_SECRET_BYTES) return null;
  return bytes;
}

function configuredCredential(env: NodeJS.ProcessEnv): ConfiguredCredential | null {
  // Once the dedicated credential is present, invalid configuration fails closed.
  // Never silently broaden authority by falling back to the agent-wide secret.
  if (env[CODING_OPERATOR_SECRET_ENV] !== undefined) {
    const secret = normalizedSecret(env[CODING_OPERATOR_SECRET_ENV]);
    return secret ? { mode: 'coding-operator', secret } : null;
  }
  const legacy = normalizedSecret(env[LEGACY_AGENT_SECRET_ENV]);
  return legacy ? { mode: 'legacy-agent-compat', secret: legacy } : null;
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

export function codingJobAuthorizationModeV14(env: NodeJS.ProcessEnv = process.env): CodingJobAuthorizationModeV14 {
  return configuredCredential(env)?.mode ?? 'unconfigured';
}

export function codingJobOperatorConfiguredV14(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredCredential(env) !== null;
}

export function authenticateCodingJobOperatorV14(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = configuredCredential(env);
  const presented = presentedBearer(req);
  if (!configured || !presented || configured.secret.length !== presented.length) return false;
  return timingSafeEqual(configured.secret, presented);
}
