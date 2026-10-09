import { createHash } from 'node:crypto';

// The database's immutable, server-written target_key stores the Agent run
// association without a second writable ledger or plaintext goal/prompt.
// No target key is ever interpreted as a filesystem path.
const LEGACY_TARGET = 'origin:self';
const AGENT_TARGET_PREFIX = 'origin:self/agent/';
const AGENT_RUN_ID = /^run-[A-Za-z0-9-]{1,100}$/;
const AGENT_TARGET = /^origin:self\/agent\/[0-9a-f]{64}$/;
const PINNED_SHA = /^[0-9a-f]{40}$/i;
const AGENT_TARGET_PINNED = /^origin:self\/agent\/[0-9a-f]{64}\/[0-9a-f]{40}$/;

export function codingAgentTargetKeyForRunV14(runId: string, releaseSha?: string): string {
  if (typeof runId !== 'string' || !AGENT_RUN_ID.test(runId)) {
    throw new Error('AGENT_CODING_RUN_ID_INVALID');
  }
  const digest = createHash('sha256')
    .update('origin-agent-coding-run-v3\0', 'utf8')
    .update(runId, 'utf8')
    .digest('hex');
  const key = `${AGENT_TARGET_PREFIX}${digest}`;
  if (releaseSha === undefined) return key; // Backward-compatible read of pre-pinned jobs only.
  if (typeof releaseSha !== 'string' || !PINNED_SHA.test(releaseSha)) {
    throw new Error('AGENT_CODING_SOURCE_REVISION_INVALID');
  }
  // 18 + 64 + 1 + 40 = 123 bytes; stays inside immutable DB target_key bound (128).
  return `${key}/${releaseSha.toLowerCase()}`;
}

export function codingAgentTargetKeyMatchesRunV14(runId: string, targetKey: string): boolean {
  try {
    const legacy = codingAgentTargetKeyForRunV14(runId);
    return targetKey === legacy || (targetKey.startsWith(`${legacy}/`) && AGENT_TARGET_PINNED.test(targetKey));
  } catch {
    return false;
  }
}

export function codingAgentPinnedRevisionV14(targetKey: string): string | null {
  return AGENT_TARGET_PINNED.test(targetKey) ? targetKey.slice(-40) : null;
}

export function isTrustedCodingWorkerTargetV14(targetKey: string): boolean {
  return targetKey === LEGACY_TARGET
    || (typeof targetKey === 'string' && (AGENT_TARGET.test(targetKey) || AGENT_TARGET_PINNED.test(targetKey)));
}
