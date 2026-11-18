import { createHash } from 'node:crypto';
import { AGENT_RUN_OWNER_BINDING_PATTERN } from './agentRunRecord.js';
import { containsLikelySecret } from './safeFilePolicy.js';

/**
 * Agent attachment sets (agent file-input foundation, F1).
 *
 * A user hands the agent files to work on. The measured constraints of
 * the existing system make the naive shapes impossible: the goal text
 * is capped at 4,000 characters and the JSON body boundary at 64KB, so
 * file data can travel neither inside the goal nor inside plan params
 * (plan snapshots are capped at 32KiB). Instead the data lives in a
 * dedicated store, scoped by owner binding exactly like run records,
 * and a plan binds only `{ attachmentSetId, setDigest }` — the digest
 * of the set's contents — so the existing plan/approval digest chain
 * covers the data itself: replacing a file after approval changes the
 * set digest and the approved params no longer match.
 *
 * Invariants:
 * - Only extracted text and metadata are stored, never the original
 *   binary (stage 2 extracts xlsx/pdf server-side and discards the
 *   original; stage 1 accepts text-family files only).
 * - Attachment bodies never appear in logs, step summaries, live
 *   detail, or metadata responses. The only reader of a body is a
 *   data step executing inside the server (F2).
 * - Ingestion fails closed: oversize, unsupported kinds and likely
 *   secrets are rejected per file, never truncated into compliance.
 * - Retention is bounded: an unclaimed set expires 24 hours after
 *   creation; a claimed set's expiry is set by the claiming run (the
 *   run's own expiry plus a grace period, see claimSet).
 */

export const AGENT_ATTACHMENT_SET_ID_PATTERN = /^att-[A-Za-z0-9-]{8,100}$/;
export const AGENT_ATTACHMENT_SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Per-file cap on extracted text (design §2.2). The M&A audit's full
 * input set (~49,640 chars across 10 files) fits with wide margin. */
export const MAX_AGENT_ATTACHMENT_FILE_TEXT_CHARS = 200_000;
export const MAX_AGENT_ATTACHMENT_SET_FILES = 10;
export const MAX_AGENT_ATTACHMENT_SET_TEXT_CHARS = 500_000;
export const MAX_AGENT_ATTACHMENT_FILE_NAME_LENGTH = 255;
export const MAX_AGENT_ATTACHMENT_MEDIA_TYPE_LENGTH = 128;

/** Unclaimed sets live at most 24 hours (design §2.3). */
export const AGENT_ATTACHMENT_SET_TTL_MS = 24 * 60 * 60 * 1000;
/** After a claiming run reaches a terminal state, its set's bodies are
 * deleted within this grace period (design §2.3). The claiming side
 * (F2) computes the set expiry as run expiry + this grace. */
export const AGENT_ATTACHMENT_CLAIMED_GRACE_MS = 24 * 60 * 60 * 1000;

export const ORIGIN_AGENT_ATTACHMENTS_ENABLED_ENV = 'ORIGIN_AGENT_ATTACHMENTS_ENABLED' as const;

/** The feature switch, in the same style as ORIGIN_GROQ_FIRST_ENABLED:
 * only the exact string "true" enables it; anything else is OFF. */
export function agentAttachmentsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_AGENT_ATTACHMENTS_ENABLED_ENV] === 'true';
}

export const AGENT_ATTACHMENT_KINDS = ['text', 'xlsx', 'pdf'] as const;
export type AgentAttachmentKind = typeof AGENT_ATTACHMENT_KINDS[number];

export const AGENT_ATTACHMENT_EXTRACTION_STATUSES = ['ok', 'failed'] as const;
export type AgentAttachmentExtractionStatus = typeof AGENT_ATTACHMENT_EXTRACTION_STATUSES[number];

export const AGENT_ATTACHMENT_SET_STATUSES = ['open', 'claimed', 'deleted'] as const;
export type AgentAttachmentSetStatus = typeof AGENT_ATTACHMENT_SET_STATUSES[number];

/** Metadata of one stored file. Bodies are never part of this shape. */
export type AgentAttachmentFileMeta = {
  idx: number;
  name: string;
  mediaType: string;
  kind: AgentAttachmentKind;
  byteSize: number;
  charCount: number;
  sha256: string;
  extractionStatus: AgentAttachmentExtractionStatus;
};

export type AgentAttachmentSetRecord = {
  setId: string;
  ownerBinding: string;
  /** SHA-256 of the single upload token issued for this set. The token
   * itself is never stored; presenting it is proven against this
   * digest (and the owner binding derived from it at creation). */
  uploadTokenDigest: string;
  status: AgentAttachmentSetStatus;
  claimedRunId: string | null;
  files: AgentAttachmentFileMeta[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type CreateAgentAttachmentSetInput = {
  setId: string;
  ownerBinding: string;
  uploadTokenDigest: string;
  expiresAt: number;
};

/** A fully validated file, ready to store. Validation (name, kind,
 * size, secret screening, digests) happens in this module before the
 * store is asked to enforce the set-level limits atomically. */
export type AddAgentAttachmentFileInput = {
  name: string;
  mediaType: string;
  kind: AgentAttachmentKind;
  byteSize: number;
  charCount: number;
  sha256: string;
  extractedText: string;
};

/**
 * Storage boundary for attachment sets. Implementations must scope
 * every operation by owner binding (a set is invisible to other
 * owners), enforce the set-level limits (file count, total chars)
 * atomically with the insert, and delete expired sets lazily on read
 * so an expired set can never be observed or used.
 */
export interface AgentAttachmentStore {
  createSet(input: CreateAgentAttachmentSetInput, now?: number): Promise<AgentAttachmentSetRecord | null>;
  getSet(setId: string, ownerBinding: string, now?: number): Promise<AgentAttachmentSetRecord | null>;
  addFile(setId: string, ownerBinding: string, input: AddAgentAttachmentFileInput, now?: number): Promise<AgentAttachmentFileMeta>;
  /** The extracted body of one file — the only body read path, for
   * server-internal data steps (F2). Never exposed over HTTP. */
  getFileText(setId: string, ownerBinding: string, idx: number, now?: number): Promise<string | null>;
  /**
   * Binds an open set to a run (design J2: at run creation). The
   * caller supplies the set's final expiry (the run's expiry plus
   * AGENT_ATTACHMENT_CLAIMED_GRACE_MS). Returns null when the set is
   * missing, not open, or expired.
   */
  claimSet(setId: string, ownerBinding: string, runId: string, expiresAt: number, now?: number): Promise<AgentAttachmentSetRecord | null>;
  deleteSet(setId: string, ownerBinding: string): Promise<boolean>;
  sweepExpired(limit?: number, now?: number): Promise<number>;
}

export function assertAgentAttachmentSetId(setId: unknown): asserts setId is string {
  if (typeof setId !== 'string' || !AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) {
    throw new Error('AGENT_ATTACHMENT_SET_ID_INVALID');
  }
}

export function assertAgentAttachmentOwnerBinding(ownerBinding: unknown): asserts ownerBinding is string {
  if (typeof ownerBinding !== 'string' || !AGENT_RUN_OWNER_BINDING_PATTERN.test(ownerBinding)) {
    throw new Error('AGENT_ATTACHMENT_OWNER_BINDING_INVALID');
  }
}

const FILE_NAME_FORBIDDEN = /[\\/\u0000-\u001f\u007f]/;

export function normalizeAgentAttachmentFileName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('AGENT_ATTACHMENT_FILE_INVALID');
  const normalized = name.trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_AGENT_ATTACHMENT_FILE_NAME_LENGTH
    || FILE_NAME_FORBIDDEN.test(normalized)
  ) {
    throw new Error('AGENT_ATTACHMENT_FILE_INVALID');
  }
  return normalized;
}

const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['txt', 'csv', 'tsv', 'md', 'json']);
const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  json: 'application/json',
};

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Stage 1 accepts text-family files only: a known text extension, any
 * `text/*` media type, or `application/json` (what browsers report for
 * .json files). xlsx/pdf return null here; stage 2 (F4) adds the
 * binary kinds with server-side extraction.
 */
export function resolveAgentAttachmentKind(name: string, mediaType: string | undefined): AgentAttachmentKind | null {
  const extension = fileExtension(name);
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  if (typeof mediaType === 'string') {
    const normalized = mediaType.trim().toLowerCase();
    if (normalized.startsWith('text/') || normalized === 'application/json') return 'text';
  }
  return null;
}

/** Validates the presented media type, or derives one from the file
 * extension when the client did not supply a usable one. */
export function normalizeAgentAttachmentMediaType(name: string, mediaType: unknown): string {
  if (typeof mediaType === 'string') {
    const normalized = mediaType.trim().toLowerCase();
    if (normalized.length > 0 && normalized.length <= MAX_AGENT_ATTACHMENT_MEDIA_TYPE_LENGTH && MEDIA_TYPE_PATTERN.test(normalized)) {
      return normalized;
    }
  }
  return EXTENSION_MEDIA_TYPES[fileExtension(name)] ?? 'text/plain';
}

/**
 * Measures and screens one file's extracted text. Oversize is rejected
 * (never truncated), and the likely-secret screening is the same one
 * run records apply — a file whose text trips it is refused as a
 * whole, with the dedicated code, mirroring
 * AGENT_RUN_SECRET_CONTENT_BLOCKED.
 */
export function validateAgentAttachmentFileText(contentText: unknown): { byteSize: number; charCount: number; sha256: string } {
  if (typeof contentText !== 'string') throw new Error('AGENT_ATTACHMENT_FILE_INVALID');
  const charCount = contentText.length;
  if (charCount > MAX_AGENT_ATTACHMENT_FILE_TEXT_CHARS) throw new Error('AGENT_ATTACHMENT_FILE_TOO_LARGE');
  if (containsLikelySecret(contentText)) throw new Error('AGENT_ATTACHMENT_SECRET_CONTENT_BLOCKED');
  return {
    byteSize: Buffer.byteLength(contentText, 'utf8'),
    charCount,
    sha256: createHash('sha256').update(contentText, 'utf8').digest('hex'),
  };
}

/**
 * The digest that binds a set's contents into plan params: SHA-256
 * over the files' (name, sha256) pairs, sorted so the digest depends
 * on the set's contents only, never on upload order.
 */
export function computeAgentAttachmentSetDigest(files: readonly AgentAttachmentFileMeta[]): string {
  const lines = files
    .map((file) => ({ name: file.name, sha256: file.sha256 }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0))
    .map((file) => `${file.name}\n${file.sha256}`);
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

export function agentAttachmentSetTotals(files: readonly AgentAttachmentFileMeta[]): { fileCount: number; totalChars: number } {
  return {
    fileCount: files.length,
    totalChars: files.reduce((sum, file) => sum + file.charCount, 0),
  };
}

/** The longest a set may live: an unclaimed set's 24 hours, or a
 * claimed set following the longest-lived run (7 days) plus grace. */
export const MAX_AGENT_ATTACHMENT_SET_TTL_MS = AGENT_ATTACHMENT_SET_TTL_MS + 7 * 24 * 60 * 60 * 1000 + AGENT_ATTACHMENT_CLAIMED_GRACE_MS;

/**
 * Validates a set creation request at the store boundary, the same
 * role validateCreateAgentRunInput plays for run records.
 */
export function validateCreateAgentAttachmentSetInput(
  input: CreateAgentAttachmentSetInput,
  now = Date.now(),
): CreateAgentAttachmentSetInput {
  if (!input || typeof input !== 'object') throw new Error('AGENT_ATTACHMENT_CREATE_INPUT_INVALID');
  assertAgentAttachmentSetId(input.setId);
  assertAgentAttachmentOwnerBinding(input.ownerBinding);
  if (typeof input.uploadTokenDigest !== 'string' || !AGENT_ATTACHMENT_SHA256_PATTERN.test(input.uploadTokenDigest)) {
    throw new Error('AGENT_ATTACHMENT_CREATE_INPUT_INVALID');
  }
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now || input.expiresAt > now + MAX_AGENT_ATTACHMENT_SET_TTL_MS + 10_000) {
    throw new Error('AGENT_ATTACHMENT_CREATE_INPUT_INVALID');
  }
  return {
    setId: input.setId,
    ownerBinding: input.ownerBinding,
    uploadTokenDigest: input.uploadTokenDigest,
    expiresAt: input.expiresAt,
  };
}

/**
 * Re-validates a file at the store boundary: the measured values
 * (byte size, char count, digest) are recomputed from the text itself
 * so a store can never persist metadata that disagrees with the body
 * it holds, and the secret screening runs again as defense in depth.
 */
export function validateAddAgentAttachmentFileInput(input: AddAgentAttachmentFileInput): AddAgentAttachmentFileInput {
  if (!input || typeof input !== 'object') throw new Error('AGENT_ATTACHMENT_FILE_INVALID');
  const name = normalizeAgentAttachmentFileName(input.name);
  const kind = input.kind;
  if (kind !== 'text' && kind !== 'xlsx' && kind !== 'pdf') throw new Error('AGENT_ATTACHMENT_FILE_INVALID');
  if (typeof input.mediaType !== 'string' || input.mediaType.length === 0 || input.mediaType.length > MAX_AGENT_ATTACHMENT_MEDIA_TYPE_LENGTH) {
    throw new Error('AGENT_ATTACHMENT_FILE_INVALID');
  }
  const measured = validateAgentAttachmentFileText(input.extractedText);
  if (measured.byteSize !== input.byteSize || measured.charCount !== input.charCount || measured.sha256 !== input.sha256) {
    throw new Error('AGENT_ATTACHMENT_FILE_INVALID');
  }
  return {
    name,
    mediaType: input.mediaType,
    kind,
    byteSize: measured.byteSize,
    charCount: measured.charCount,
    sha256: measured.sha256,
    extractedText: input.extractedText,
  };
}
