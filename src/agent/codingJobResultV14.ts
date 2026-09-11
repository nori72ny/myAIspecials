import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readRepositoryFile } from './safeRepositoryReader.js';
import { normalizeCodingMutablePathV14 } from './codingPathPolicyV14.js';
import { sanitizePreEgress } from '../services/securitySanitizer.js';
import { CODING_JOB_ID_PATTERN } from './codingJobCryptoV14.js';
import type { CodingAuditEvent, CodingSessionResult } from './codingSessionV14.js';
import type { VerificationKind } from './verificationRunner.js';

export const CODING_JOB_RESULT_CIPHERTEXT_PATTERN = /^r1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;
const DATA_KEY_ENV = 'ORIGIN_CODING_JOB_DATA_KEY';
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_PREVIEW_BYTES = 1536;
const MAX_DIFFS = 12;
const CHECK_KINDS: readonly VerificationKind[] = ['typecheck', 'lint', 'test', 'build'];

export type CodingJobVerificationResultV14 = {
  kind: VerificationKind;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  attempt: number;
};

export type CodingJobDiffPreviewV14 = {
  path: string;
  kind: 'modified' | 'created';
  before: string | null;
  after: string | null;
  beforeTruncated: boolean;
  afterTruncated: boolean;
  previewAvailable: boolean;
};

export type CodingJobResultV14 = {
  schemaVersion: 1;
  sessionStatus: CodingSessionResult['status'];
  repairRounds: number;
  diffs: CodingJobDiffPreviewV14[];
  verificationChecks: CodingJobVerificationResultV14[];
  freeOnly: true;
  costUsd: 0;
  gitPublished: false;
  deployed: false;
};

type Preview = { text: string; truncated: boolean };

function canonicalDataKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('CODING_JOB_DATA_KEY_INVALID');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('CODING_JOB_DATA_KEY_INVALID');
  return key;
}

function aad(jobId: string): Buffer {
  if (!CODING_JOB_ID_PATTERN.test(jobId)) throw new Error('CODING_JOB_ID_INVALID');
  return Buffer.from(`origin-coding-job-v14-result:${jobId}`, 'utf8');
}

function boundedPreview(value: string): Preview {
  const sanitized = sanitizePreEgress(value);
  const bytes = Buffer.from(sanitized, 'utf8');
  if (bytes.length <= MAX_PREVIEW_BYTES) return { text: sanitized, truncated: false };
  return {
    text: bytes.subarray(0, MAX_PREVIEW_BYTES).toString('utf8') + '\n[DIFF_PREVIEW_TRUNCATED]',
    truncated: true,
  };
}

async function optionalRepositoryFile(root: string, filePath: string): Promise<string | null> {
  try {
    return await readRepositoryFile(root, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function latestVerification(audit: readonly CodingAuditEvent[]): CodingJobVerificationResultV14[] {
  const reversed = [...audit].reverse();
  const latest = reversed.findIndex(candidate => candidate.action === 'verified' && Array.isArray(candidate.checks));
  if (latest < 0 || reversed.slice(0, latest).some(candidate =>
    candidate.action === 'edited' || candidate.code === 'CODING_WORKSPACE_CHANGED_DURING_CHECKS')) return [];
  const event = reversed[latest];
  if (!event?.checks) return [];
  const checks: CodingJobVerificationResultV14[] = [];
  for (const kind of CHECK_KINDS) {
    const check = event.checks.find(candidate => candidate.kind === kind);
    if (!check) return [];
    checks.push({
      kind,
      ok: check.ok === true,
      exitCode: check.exitCode,
      timedOut: check.timedOut === true,
      attempt: event.attempt,
    });
  }
  return checks;
}

export async function buildCodingJobResultV14(
  session: CodingSessionResult,
  baselineRoot: string,
  workspaceRoot: string,
): Promise<CodingJobResultV14> {
  if (!session || !Array.isArray(session.changedPaths) || session.changedPaths.length > MAX_DIFFS) {
    throw new Error('CODING_JOB_RESULT_INVALID');
  }
  const diffs: CodingJobDiffPreviewV14[] = [];
  for (const rawPath of session.changedPaths) {
    const filePath = normalizeCodingMutablePathV14(rawPath);
    try {
      const [beforeValue, afterValue] = await Promise.all([
        optionalRepositoryFile(baselineRoot, filePath),
        optionalRepositoryFile(workspaceRoot, filePath),
      ]);
      const before = beforeValue === null ? null : boundedPreview(beforeValue);
      const after = afterValue === null ? null : boundedPreview(afterValue);
      diffs.push({
        path: filePath,
        kind: beforeValue === null ? 'created' : 'modified',
        before: before?.text ?? null,
        after: after?.text ?? null,
        beforeTruncated: before?.truncated ?? false,
        afterTruncated: after?.truncated ?? false,
        previewAvailable: afterValue !== null,
      });
    } catch {
      diffs.push({
        path: filePath,
        kind: 'modified',
        before: null,
        after: null,
        beforeTruncated: false,
        afterTruncated: false,
        previewAvailable: false,
      });
    }
  }
  return {
    schemaVersion: 1,
    sessionStatus: session.status,
    repairRounds: session.repairRounds,
    diffs,
    verificationChecks: latestVerification(session.audit),
    freeOnly: true,
    costUsd: 0,
    gitPublished: false,
    deployed: false,
  };
}

function validVerification(value: unknown): value is CodingJobVerificationResultV14 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return CHECK_KINDS.includes(item.kind as VerificationKind)
    && typeof item.ok === 'boolean'
    && (item.exitCode === null || Number.isInteger(item.exitCode))
    && typeof item.timedOut === 'boolean'
    && Number.isInteger(item.attempt)
    && Number(item.attempt) >= 0
    && Number(item.attempt) <= 3;
}

function validDiff(value: unknown): value is CodingJobDiffPreviewV14 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.kind !== 'modified' && item.kind !== 'created') return false;
  if (typeof item.path !== 'string') return false;
  try { if (normalizeCodingMutablePathV14(item.path) !== item.path) return false; } catch { return false; }
  const validText = (text: unknown) => text === null || (typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_PREVIEW_BYTES + 128);
  return validText(item.before)
    && validText(item.after)
    && typeof item.beforeTruncated === 'boolean'
    && typeof item.afterTruncated === 'boolean'
    && typeof item.previewAvailable === 'boolean';
}

function normalizeResult(value: unknown): CodingJobResultV14 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CODING_JOB_RESULT_INVALID');
  const item = value as Record<string, unknown>;
  const exactKeys = ['schemaVersion', 'sessionStatus', 'repairRounds', 'diffs', 'verificationChecks', 'freeOnly', 'costUsd', 'gitPublished', 'deployed'];
  if (Object.keys(item).sort().join('|') !== [...exactKeys].sort().join('|')) throw new Error('CODING_JOB_RESULT_INVALID');
  if (item.schemaVersion !== 1 || !['verified', 'blocked', 'repair_limit'].includes(String(item.sessionStatus))) throw new Error('CODING_JOB_RESULT_INVALID');
  if (!Number.isInteger(item.repairRounds) || Number(item.repairRounds) < 0 || Number(item.repairRounds) > 3) throw new Error('CODING_JOB_RESULT_INVALID');
  if (!Array.isArray(item.diffs) || item.diffs.length > MAX_DIFFS || item.diffs.some(diff => !validDiff(diff))) throw new Error('CODING_JOB_RESULT_INVALID');
  if (!Array.isArray(item.verificationChecks) || ![0, 4].includes(item.verificationChecks.length) || item.verificationChecks.some(check => !validVerification(check))) throw new Error('CODING_JOB_RESULT_INVALID');
  if (item.verificationChecks.length === 4 && new Set(item.verificationChecks.map(check => check.kind)).size !== 4) throw new Error('CODING_JOB_RESULT_INVALID');
  if (item.sessionStatus === 'verified' && (item.verificationChecks.length !== 4 || item.verificationChecks.some(check =>
    !check.ok || check.exitCode !== 0 || check.timedOut || check.attempt !== item.repairRounds))) throw new Error('CODING_JOB_RESULT_INVALID');
  if (item.freeOnly !== true || item.costUsd !== 0 || item.gitPublished !== false || item.deployed !== false) throw new Error('CODING_JOB_RESULT_INVALID');
  return item as CodingJobResultV14;
}

export function encryptCodingJobResultV14(jobId: string, result: CodingJobResultV14, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = normalizeResult(result);
  const plaintext = Buffer.from(JSON.stringify(normalized), 'utf8');
  if (plaintext.length > MAX_RESULT_BYTES) throw new Error('CODING_JOB_RESULT_TOO_LARGE');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', canonicalDataKey(env[DATA_KEY_ENV]), iv, { authTagLength: 16 });
  cipher.setAAD(aad(jobId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `r1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptCodingJobResultV14(jobId: string, encoded: string, env: NodeJS.ProcessEnv = process.env): CodingJobResultV14 {
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > 96 * 1024 || !CODING_JOB_RESULT_CIPHERTEXT_PATTERN.test(encoded)) {
    throw new Error('CODING_JOB_RESULT_CIPHERTEXT_INVALID');
  }
  const [, ivText, ciphertextText, tagText] = encoded.split('.');
  const iv = Buffer.from(ivText, 'base64url');
  const ciphertext = Buffer.from(ciphertextText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_RESULT_BYTES + 64) throw new Error('CODING_JOB_RESULT_CIPHERTEXT_INVALID');
  try {
    const decipher = createDecipheriv('aes-256-gcm', canonicalDataKey(env[DATA_KEY_ENV]), iv, { authTagLength: 16 });
    decipher.setAAD(aad(jobId));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length > MAX_RESULT_BYTES) throw new Error('CODING_JOB_RESULT_INVALID');
    return normalizeResult(JSON.parse(plaintext.toString('utf8')) as unknown);
  } catch (error) {
    if (error instanceof Error && (error.message === 'CODING_JOB_DATA_KEY_INVALID' || error.message === 'CODING_JOB_ID_INVALID')) throw error;
    throw new Error('CODING_JOB_RESULT_INVALID');
  }
}
