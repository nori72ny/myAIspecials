import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const APPROVAL_TTL_MS = 2 * 60 * 1000;
const MAX_PENDING_APPROVALS = 1000;
const SECRET_MIN_LENGTH = 32;

type ApprovalAction = 'execute' | 'resume' | 'rollback';

export interface AgentApprovalOperation {
  action: ApprovalAction;
  toolName?: string;
  params?: unknown;
  checkpointId?: string;
}

interface ApprovalRecord {
  digest: string;
  expiresAt: number;
  used: boolean;
}

const approvals = new Map<string, ApprovalRecord>();

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}

export function approvalDigest(operation: AgentApprovalOperation): string {
  return createHash('sha256').update(stable(operation)).digest('hex');
}

function cleanup(now: number): void {
  for (const [token, record] of approvals) {
    if (record.used || record.expiresAt <= now) approvals.delete(token);
  }
  while (approvals.size >= MAX_PENDING_APPROVALS) {
    const oldest = approvals.keys().next().value as string | undefined;
    if (!oldest) break;
    approvals.delete(oldest);
  }
}

function configuredSecret(env: NodeJS.ProcessEnv): Buffer | null {
  const value = env.ORIGIN_AGENT_APPROVAL_SECRET;
  if (!value || value.length < SECRET_MIN_LENGTH) return null;
  return Buffer.from(value, 'utf8');
}

function bearer(req: Request): Buffer | null {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const value = header.slice('Bearer '.length).trim();
  return value ? Buffer.from(value, 'utf8') : null;
}

export function authenticateAgentRequest(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = configuredSecret(env);
  const presented = bearer(req);
  if (!expected || !presented || expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}

export function issueApproval(operation: AgentApprovalOperation, now = Date.now()): string {
  cleanup(now);
  const token = randomBytes(32).toString('base64url');
  approvals.set(token, { digest: approvalDigest(operation), expiresAt: now + APPROVAL_TTL_MS, used: false });
  return token;
}

export function consumeApproval(token: string, operation: AgentApprovalOperation, now = Date.now()): boolean {
  cleanup(now);
  const record = approvals.get(token);
  if (!record || record.used || record.expiresAt <= now) return false;
  if (record.digest !== approvalDigest(operation)) return false;
  record.used = true;
  approvals.delete(token);
  return true;
}

export function agentApprovalConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return configuredSecret(env) !== null;
}
