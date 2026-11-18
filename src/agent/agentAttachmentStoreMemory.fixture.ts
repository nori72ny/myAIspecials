import { AGENT_RUN_ID_PATTERN } from './agentRunRecord.js';
import {
  AGENT_ATTACHMENT_SET_ID_PATTERN,
  MAX_AGENT_ATTACHMENT_SET_FILES,
  MAX_AGENT_ATTACHMENT_SET_TEXT_CHARS,
  assertAgentAttachmentOwnerBinding,
  assertAgentAttachmentSetId,
  validateAddAgentAttachmentFileInput,
  validateCreateAgentAttachmentSetInput,
  type AddAgentAttachmentFileInput,
  type AgentAttachmentFileMeta,
  type AgentAttachmentSetRecord,
  type AgentAttachmentStore,
  type CreateAgentAttachmentSetInput,
} from './agentAttachmentRecord.js';

/**
 * Test double for `AgentAttachmentStore` with the same observable
 * semantics as the Postgres store (owner scoping, lazy expiry
 * deletion, set-level limits, claim lifecycle). Test-only: never wire
 * this into the server — durable attachment sets require the Postgres
 * store.
 */

type StoredFile = AgentAttachmentFileMeta & { extractedText: string };
type StoredSet = Omit<AgentAttachmentSetRecord, 'files'> & { files: StoredFile[] };

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryAgentAttachmentStore implements AgentAttachmentStore {
  private readonly sets = new Map<string, StoredSet>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private toRecord(stored: StoredSet): AgentAttachmentSetRecord {
    const { files, ...rest } = stored;
    return clone({
      ...rest,
      files: files.map(({ extractedText: _extractedText, ...meta }) => meta),
    });
  }

  /** Returns the live set, deleting it first if it has expired (the
   * lazy-deletion invariant every read path shares). */
  private live(setId: string, ownerBinding: string, now: number): StoredSet | undefined {
    const stored = this.sets.get(setId);
    if (!stored || stored.ownerBinding !== ownerBinding) return undefined;
    if (stored.expiresAt <= now) {
      this.sets.delete(setId);
      return undefined;
    }
    return stored;
  }

  async createSet(input: CreateAgentAttachmentSetInput, now?: number): Promise<AgentAttachmentSetRecord | null> {
    const timestamp = now ?? this.now();
    const normalized = validateCreateAgentAttachmentSetInput(input, timestamp);
    if (this.sets.has(normalized.setId)) return null;
    const stored: StoredSet = {
      ...normalized,
      status: 'open',
      claimedRunId: null,
      files: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.sets.set(normalized.setId, stored);
    return this.toRecord(stored);
  }

  async getSet(setId: string, ownerBinding: string, now?: number): Promise<AgentAttachmentSetRecord | null> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) return null;
    const stored = this.live(setId, ownerBinding, now ?? this.now());
    return stored ? this.toRecord(stored) : null;
  }

  async addFile(setId: string, ownerBinding: string, input: AddAgentAttachmentFileInput, now?: number): Promise<AgentAttachmentFileMeta> {
    assertAgentAttachmentSetId(setId);
    assertAgentAttachmentOwnerBinding(ownerBinding);
    const file = validateAddAgentAttachmentFileInput(input);
    const stored = this.live(setId, ownerBinding, now ?? this.now());
    if (!stored) throw new Error('AGENT_ATTACHMENT_SET_NOT_FOUND');
    if (stored.status !== 'open') throw new Error('AGENT_ATTACHMENT_SET_NOT_OPEN');
    if (stored.files.length >= MAX_AGENT_ATTACHMENT_SET_FILES) throw new Error('AGENT_ATTACHMENT_SET_FILE_LIMIT');
    const totalChars = stored.files.reduce((sum, existing) => sum + existing.charCount, 0);
    if (totalChars + file.charCount > MAX_AGENT_ATTACHMENT_SET_TEXT_CHARS) throw new Error('AGENT_ATTACHMENT_SET_TOO_LARGE');
    const meta: AgentAttachmentFileMeta = {
      idx: stored.files.length,
      name: file.name,
      mediaType: file.mediaType,
      kind: file.kind,
      byteSize: file.byteSize,
      charCount: file.charCount,
      sha256: file.sha256,
      extractionStatus: 'ok',
    };
    stored.files.push({ ...meta, extractedText: file.extractedText });
    stored.updatedAt = now ?? this.now();
    return clone(meta);
  }

  async getFileText(setId: string, ownerBinding: string, idx: number, now?: number): Promise<string | null> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) return null;
    if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_AGENT_ATTACHMENT_SET_FILES) return null;
    const stored = this.live(setId, ownerBinding, now ?? this.now());
    if (!stored || (stored.status !== 'open' && stored.status !== 'claimed')) return null;
    return stored.files.find((file) => file.idx === idx)?.extractedText ?? null;
  }

  async claimSet(setId: string, ownerBinding: string, runId: string, expiresAt: number, now?: number): Promise<AgentAttachmentSetRecord | null> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) return null;
    if (!AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
    const timestamp = now ?? this.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= timestamp) throw new Error('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
    const stored = this.live(setId, ownerBinding, timestamp);
    if (!stored || stored.status !== 'open') return null;
    stored.status = 'claimed';
    stored.claimedRunId = runId;
    stored.expiresAt = expiresAt;
    stored.updatedAt = timestamp;
    return this.toRecord(stored);
  }

  async claimSetForRun(setId: string, fromOwnerBinding: string, toOwnerBinding: string, runId: string, expiresAt: number, now?: number): Promise<AgentAttachmentSetRecord | null> {
    if (!AGENT_ATTACHMENT_SET_ID_PATTERN.test(setId)) return null;
    assertAgentAttachmentOwnerBinding(fromOwnerBinding);
    assertAgentAttachmentOwnerBinding(toOwnerBinding);
    if (!AGENT_RUN_ID_PATTERN.test(runId)) throw new Error('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
    const timestamp = now ?? this.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= timestamp) throw new Error('AGENT_ATTACHMENT_CLAIM_INPUT_INVALID');
    const stored = this.live(setId, fromOwnerBinding, timestamp);
    if (!stored || stored.status !== 'open') return null;
    stored.ownerBinding = toOwnerBinding;
    stored.status = 'claimed';
    stored.claimedRunId = runId;
    stored.expiresAt = expiresAt;
    stored.updatedAt = timestamp;
    return this.toRecord(stored);
  }

  async deleteSet(setId: string, ownerBinding: string): Promise<boolean> {
    const stored = this.sets.get(setId);
    if (!stored || stored.ownerBinding !== ownerBinding) return false;
    this.sets.delete(setId);
    return true;
  }

  async sweepExpired(limit = 100, now?: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('AGENT_ATTACHMENT_CLEANUP_LIMIT_INVALID');
    const timestamp = now ?? this.now();
    let count = 0;
    for (const stored of this.sets.values()) {
      if (count >= limit) break;
      if (stored.expiresAt > timestamp) continue;
      this.sets.delete(stored.setId);
      count += 1;
    }
    return count;
  }
}
