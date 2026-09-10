import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { containsLikelySecret } from './safeFilePolicy.js';

export const CODING_JOB_ID_PATTERN = /^coding-[A-Za-z0-9_-]{22}$/;
export const CODING_JOB_OWNER_HASH_PATTERN = /^[0-9a-f]{64}$/;
export const CODING_JOB_CIPHERTEXT_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;
export const DEFAULT_CODING_JOB_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CODING_JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_CODING_JOB_TTL_MS = 60 * 1000;
const MAX_PRIVATE_PAYLOAD_BYTES = 8 * 1024;
const DATA_KEY_ENV = 'ORIGIN_CODING_JOB_DATA_KEY';
const OWNER_SECRET_ENV = 'ORIGIN_CODING_JOB_OWNER_HMAC_SECRET';

type CodingJobPrivatePayloadV14 = { goal: string };
export type CodingJobEnvelopeV14 = {
  jobId: string;
  ownerHash: string;
  targetKey: string;
  payloadCiphertext: string;
  expiresAt: number;
};

function canonicalDataKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('CODING_JOB_DATA_KEY_INVALID');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('CODING_JOB_DATA_KEY_INVALID');
  return key;
}

function ownerSecret(value: string | undefined): string {
  if (!value || Buffer.byteLength(value, 'utf8') < 32 || Buffer.byteLength(value, 'utf8') > 512) {
    throw new Error('CODING_JOB_OWNER_SECRET_INVALID');
  }
  return value;
}

function validateGoal(value: unknown): string {
  if (typeof value !== 'string') throw new Error('CODING_JOB_GOAL_BLOCKED');
  const goal = value.trim();
  if (!goal || goal.length > 4000 || containsLikelySecret(goal)) throw new Error('CODING_JOB_GOAL_BLOCKED');
  return goal;
}

function aad(jobId: string): Buffer {
  if (!CODING_JOB_ID_PATTERN.test(jobId)) throw new Error('CODING_JOB_ID_INVALID');
  return Buffer.from(`origin-coding-job-v14:${jobId}`, 'utf8');
}

export function createCodingJobIdV14(): string {
  return `coding-${randomBytes(16).toString('base64url')}`;
}

export function hashCodingJobOwnerV14(ownerBinding: string, env: NodeJS.ProcessEnv = process.env): string {
  if (typeof ownerBinding !== 'string' || !ownerBinding || ownerBinding.length > 512 || /[\u0000-\u001f\u007f]/.test(ownerBinding)) {
    throw new Error('CODING_JOB_OWNER_BINDING_INVALID');
  }
  return createHmac('sha256', ownerSecret(env[OWNER_SECRET_ENV])).update(ownerBinding, 'utf8').digest('hex');
}

export function encryptCodingJobPayloadV14(jobId: string, payload: CodingJobPrivatePayloadV14, env: NodeJS.ProcessEnv = process.env): string {
  const normalized: CodingJobPrivatePayloadV14 = { goal: validateGoal(payload?.goal) };
  const plaintext = Buffer.from(JSON.stringify(normalized), 'utf8');
  if (plaintext.length > MAX_PRIVATE_PAYLOAD_BYTES) throw new Error('CODING_JOB_PAYLOAD_TOO_LARGE');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', canonicalDataKey(env[DATA_KEY_ENV]), iv, { authTagLength: 16 });
  cipher.setAAD(aad(jobId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptCodingJobPayloadV14(jobId: string, encoded: string, env: NodeJS.ProcessEnv = process.env): CodingJobPrivatePayloadV14 {
  if (typeof encoded !== 'string' || encoded.length > 16 * 1024 || !CODING_JOB_CIPHERTEXT_PATTERN.test(encoded)) {
    throw new Error('CODING_JOB_CIPHERTEXT_INVALID');
  }
  const [, ivText, ciphertextText, tagText] = encoded.split('.');
  const iv = Buffer.from(ivText, 'base64url');
  const ciphertext = Buffer.from(ciphertextText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PRIVATE_PAYLOAD_BYTES + 64) throw new Error('CODING_JOB_CIPHERTEXT_INVALID');
  try {
    const decipher = createDecipheriv('aes-256-gcm', canonicalDataKey(env[DATA_KEY_ENV]), iv, { authTagLength: 16 });
    decipher.setAAD(aad(jobId));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length > MAX_PRIVATE_PAYLOAD_BYTES) throw new Error('CODING_JOB_PAYLOAD_INVALID');
    const parsed = JSON.parse(plaintext.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).join() !== 'goal') throw new Error('CODING_JOB_PAYLOAD_INVALID');
    return { goal: validateGoal((parsed as { goal?: unknown }).goal) };
  } catch (error) {
    if (error instanceof Error && (error.message === 'CODING_JOB_DATA_KEY_INVALID' || error.message === 'CODING_JOB_ID_INVALID')) throw error;
    throw new Error('CODING_JOB_PAYLOAD_INVALID');
  }
}

export function createCodingJobEnvelopeV14(input: {
  ownerBinding: string;
  targetKey: string;
  goal: string;
  ttlMs?: number;
}, env: NodeJS.ProcessEnv = process.env, now = Date.now()): CodingJobEnvelopeV14 {
  const ttlMs = input.ttlMs ?? DEFAULT_CODING_JOB_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs < MIN_CODING_JOB_TTL_MS || ttlMs > MAX_CODING_JOB_TTL_MS) throw new Error('CODING_JOB_TTL_INVALID');
  const jobId = createCodingJobIdV14();
  return {
    jobId,
    ownerHash: hashCodingJobOwnerV14(input.ownerBinding, env),
    targetKey: input.targetKey,
    payloadCiphertext: encryptCodingJobPayloadV14(jobId, { goal: input.goal }, env),
    expiresAt: now + ttlMs,
  };
}
