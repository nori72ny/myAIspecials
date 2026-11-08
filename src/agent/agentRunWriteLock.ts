import { AGENT_RUN_ID_PATTERN } from './agentRunRecord.js';
import { toolRegistry, type ToolName } from './toolRegistry.js';

/**
 * Repository writer lock for durable agent runs (multitask Phase 1,
 * PR 1-E; design §2.5, §11-R1).
 *
 * Every run operates on the same shared repository (there is no per-user
 * sandbox), so two runs writing at once — or one run writing while
 * another run's repository-wide completion verification reads — can
 * corrupt each other's artifacts. The writer lock serializes exactly
 * that: write-class steps and the completion verification run only while
 * the executing advance holds the repository lock. Read-only steps never
 * take it and stay parallel.
 *
 * Shape of the mechanism (the run store's lock-row option from design
 * §2.5, following the claim pattern PR-1 established for run records):
 * - One row per lock target, keyed by `lockKey`. The run path uses a
 *   single repository-scope key (below); the store itself is keyed
 *   generically so a finer target can be adopted without new machinery.
 * - The holder is the pair (run id, driver id) — the same identity that
 *   holds the run's claim — never an owner binding or any secret, so
 *   lock state is safe to surface in responses (contention is reported,
 *   not hidden).
 * - The lock is a lease: it frees automatically at `leaseExpiresAt`, so
 *   a driver that dies mid-write never wedges the repository. A lock may
 *   be re-acquired or renewed only by its exact holder; an expired lock
 *   may be taken over by the next writer.
 *
 * Contention is handled honestly, never as failure (design §2.5): a step
 * that cannot take the lock simply does not execute. The run is NOT
 * parked as `held` for this — a lock wait is a step wait inside the
 * queue, reported by the advance outcome so drivers and the board can
 * show "waiting for another run's write" instead of an error.
 */

export const AGENT_RUN_WRITE_LOCK_KEY_PATTERN = /^[a-z][a-z0-9][a-z0-9._:/-]{1,126}$/;
export const AGENT_RUN_WRITE_LOCK_DRIVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
export const AGENT_RUN_WRITE_LOCK_MIN_LEASE_SECONDS = 30;
export const AGENT_RUN_WRITE_LOCK_MAX_LEASE_SECONDS = 300;

/**
 * The lock target for the shared repository every run writes to. It is a
 * plain scope identifier — not derived from any owner, goal or secret.
 */
export const AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY = 'origin-repository';

export type AgentRunWriteLockRecord = {
  lockKey: string;
  holderRunId: string;
  holderDriverId: string;
  /** When the current holder first took the lock (a same-holder refresh keeps it). */
  acquiredAt: number;
  leaseExpiresAt: number;
};

/**
 * Storage boundary for writer locks. Implementations must make
 * acquisition atomic (a single conditional write): two drivers racing
 * for the same target produce exactly one holder.
 */
export interface AgentRunWriteLockStore {
  /**
   * Takes the lock for (holderRunId, holderDriverId), or refreshes it
   * when the exact same holder already holds it. Returns the lock record
   * on success, or null when a different holder's lease is still live.
   */
  acquire(lockKey: string, holderRunId: string, holderDriverId: string, leaseSeconds: number): Promise<AgentRunWriteLockRecord | null>;
  /** Extends the holder's lease. False when the caller is not the live holder. */
  renew(lockKey: string, holderRunId: string, holderDriverId: string, leaseSeconds: number): Promise<boolean>;
  /** Frees the lock when the caller is the holder. False otherwise. */
  release(lockKey: string, holderRunId: string, holderDriverId: string): Promise<boolean>;
  /** The current lock row for a target, or null when no row exists. The
   * row is returned even when its lease has lapsed (it is then free for
   * the taking); callers compare `leaseExpiresAt` themselves. */
  inspect(lockKey: string): Promise<AgentRunWriteLockRecord | null>;
}

/**
 * Whether a plan step must run under the writer lock. The classification
 * is the tool registry's own `sideEffects` declaration — the single
 * source of truth for which tools mutate the repository (today only
 * `file_writer`); this module deliberately does not keep a second list.
 */
export function agentRunStepRequiresWriteLock(toolName: ToolName): boolean {
  return toolRegistry[toolName]?.sideEffects === 'write';
}

export function validateAgentRunWriteLockKey(lockKey: unknown): void {
  if (typeof lockKey !== 'string' || !AGENT_RUN_WRITE_LOCK_KEY_PATTERN.test(lockKey)) {
    throw new Error('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
  }
}

/** Validates the lock target and holder identity (no lease involved). */
export function validateAgentRunWriteLockHolder(lockKey: unknown, holderRunId: unknown, holderDriverId: unknown): void {
  validateAgentRunWriteLockKey(lockKey);
  if (typeof holderRunId !== 'string' || !AGENT_RUN_ID_PATTERN.test(holderRunId)) {
    throw new Error('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
  }
  if (typeof holderDriverId !== 'string' || !AGENT_RUN_WRITE_LOCK_DRIVER_ID_PATTERN.test(holderDriverId)) {
    throw new Error('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
  }
}

export function validateAgentRunWriteLockRequest(
  lockKey: unknown,
  holderRunId: unknown,
  holderDriverId: unknown,
  leaseSeconds: unknown,
): void {
  validateAgentRunWriteLockHolder(lockKey, holderRunId, holderDriverId);
  if (!Number.isInteger(leaseSeconds)
    || Number(leaseSeconds) < AGENT_RUN_WRITE_LOCK_MIN_LEASE_SECONDS
    || Number(leaseSeconds) > AGENT_RUN_WRITE_LOCK_MAX_LEASE_SECONDS) {
    throw new Error('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
  }
}
