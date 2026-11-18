import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AGENT_ATTACHMENT_SET_ID_PATTERN, AGENT_ATTACHMENT_SET_TTL_MS } from './agentAttachmentRecord.js';

/**
 * Upload capabilities for agent attachment sets (file-input foundation
 * F1), modeled directly on agentV3Capability.ts: an HMAC-signed token
 * over the same server-only signing secret, issued once when a set is
 * created. The token is the uploader's only credential for adding,
 * listing and deleting files; the set stores only its SHA-256 digest,
 * and browser-created sets additionally derive their owner binding
 * from the token (browserAttachmentOwnerBinding in
 * agentOrchestratorV3.ts, the same derivation shape as run records'
 * browserRunOwnerBinding). Possession of the token is therefore proof
 * of ownership of exactly one set — and the token authorizes nothing
 * else: file data is only ever used inside a plan a human approved,
 * whose params digest binds the set's content digest.
 */

const SECRET_MIN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 2048;

/** The upload token lives exactly as long as the unclaimed set it
 * authorizes uploads to. */
export const AGENT_ATTACHMENT_UPLOAD_TOKEN_TTL_MS = AGENT_ATTACHMENT_SET_TTL_MS;

type AttachmentUploadCapabilityPayload = {
  v: 1;
  kind: 'attachment-upload';
  setId: string;
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

export function issueAttachmentUploadCapability(
  setId: string,
  env: NodeJS.ProcessEnv,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const key = secret(env);
  if (!key) throw new Error('AGENT_APPROVAL_NOT_CONFIGURED');
  if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) throw new Error('AGENT_ATTACHMENT_SET_ID_INVALID');
  const payload: AttachmentUploadCapabilityPayload = {
    v: 1,
    kind: 'attachment-upload',
    setId,
    iat: now,
    exp: now + AGENT_ATTACHMENT_UPLOAD_TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { token: `${encoded}.${sign(encoded, key)}`, expiresAt: payload.exp };
}

export function verifyAttachmentUploadCapability(
  token: string,
  env: NodeJS.ProcessEnv,
  now = Date.now(),
): AttachmentUploadCapabilityPayload | null {
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
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<AttachmentUploadCapabilityPayload>;
    if (parsed.v !== 1 || parsed.kind !== 'attachment-upload') return null;
    if (typeof parsed.setId !== 'string' || !AGENT_ATTACHMENT_SET_ID_PATTERN.test(parsed.setId)) return null;
    if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number' || parsed.exp <= now || parsed.iat > now + 30_000) return null;
    return parsed as AttachmentUploadCapabilityPayload;
  } catch {
    return null;
  }
}

/** The digest stored on the set row for the issued token. */
export function attachmentUploadTokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
