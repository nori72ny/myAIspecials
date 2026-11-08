import {
  validateAgentRunWriteLockHolder,
  validateAgentRunWriteLockKey,
  validateAgentRunWriteLockRequest,
  type AgentRunWriteLockRecord,
  type AgentRunWriteLockStore,
} from './agentRunWriteLock.js';

/**
 * Test double for `AgentRunWriteLockStore` with the same observable
 * semantics as the Postgres store (atomic single-holder acquisition,
 * same-holder refresh, lease lapse freeing the lock, holder-only renew
 * and release). Test-only: never wire this into the server — durable
 * runs require the Postgres store.
 */
export class InMemoryAgentRunWriteLockStore implements AgentRunWriteLockStore {
  private readonly locks = new Map<string, AgentRunWriteLockRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async acquire(lockKey: string, holderRunId: string, holderDriverId: string, leaseSeconds: number): Promise<AgentRunWriteLockRecord | null> {
    validateAgentRunWriteLockRequest(lockKey, holderRunId, holderDriverId, leaseSeconds);
    const timestamp = this.now();
    const existing = this.locks.get(lockKey);
    const sameHolder = existing !== undefined && existing.holderRunId === holderRunId && existing.holderDriverId === holderDriverId;
    if (existing && !sameHolder && existing.leaseExpiresAt > timestamp) return null;
    const record: AgentRunWriteLockRecord = {
      lockKey,
      holderRunId,
      holderDriverId,
      acquiredAt: sameHolder ? existing.acquiredAt : timestamp,
      leaseExpiresAt: timestamp + leaseSeconds * 1_000,
    };
    this.locks.set(lockKey, record);
    return { ...record };
  }

  async renew(lockKey: string, holderRunId: string, holderDriverId: string, leaseSeconds: number): Promise<boolean> {
    validateAgentRunWriteLockRequest(lockKey, holderRunId, holderDriverId, leaseSeconds);
    const existing = this.locks.get(lockKey);
    if (!existing || existing.holderRunId !== holderRunId || existing.holderDriverId !== holderDriverId) return false;
    if (existing.leaseExpiresAt <= this.now()) return false;
    this.locks.set(lockKey, { ...existing, leaseExpiresAt: this.now() + leaseSeconds * 1_000 });
    return true;
  }

  async release(lockKey: string, holderRunId: string, holderDriverId: string): Promise<boolean> {
    validateAgentRunWriteLockHolder(lockKey, holderRunId, holderDriverId);
    const existing = this.locks.get(lockKey);
    if (!existing || existing.holderRunId !== holderRunId || existing.holderDriverId !== holderDriverId) return false;
    this.locks.delete(lockKey);
    return true;
  }

  async inspect(lockKey: string): Promise<AgentRunWriteLockRecord | null> {
    validateAgentRunWriteLockKey(lockKey);
    const existing = this.locks.get(lockKey);
    return existing ? { ...existing } : null;
  }
}
