import { createHash } from 'node:crypto';

// The database's immutable, server-written target_key stores the Agent run
// association without a second writable ledger or plaintext goal/prompt.
// No target key is ever interpreted as a filesystem path.
const LEGACY_TARGET = 'origin:self';
const AGENT_TARGET_PREFIX = 'origin:self/agent/';
const AGENT_RUN_ID = /^run-[A-Za-z0-9-]{1,100}$/;
const AGENT_TARGET = /^origin:self\/agent\/[0-9a-f]{64}$/;

export function codingAgentTargetKeyForRunV14(runId: string): string {
  if (typeof runId !== 'string' || !AGENT_RUN_ID.test(runId)) {
    throw new Error('AGENT_CODING_RUN_ID_INVALID');
  }
  const digest = createHash('sha256')
    .update('origin-agent-coding-run-v3\0', 'utf8')
    .update(runId, 'utf8')
    .digest('hex');
  return `${AGENT_TARGET_PREFIX}${digest}`;
}

export function isTrustedCodingWorkerTargetV14(targetKey: string): boolean {
  return targetKey === LEGACY_TARGET
    || (typeof targetKey === 'string' && AGENT_TARGET.test(targetKey));
}
