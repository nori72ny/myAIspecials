// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY,
  AGENT_RUN_WRITE_LOCK_KEY_PATTERN,
  agentRunStepRequiresWriteLock,
} from './agentRunWriteLock.js';
import { InMemoryAgentRunWriteLockStore } from './agentRunWriteLockStoreMemory.fixture.js';
import type { ToolName } from './toolRegistry.js';

const RUN_A = 'run-writer-0001';
const RUN_B = 'run-writer-0002';
const DRIVER_A = 'driver-alpha-1';
const DRIVER_B = 'driver-beta-2';
const KEY = AGENT_RUN_REPOSITORY_WRITE_LOCK_KEY;

describe('agent run write lock classification', () => {
  it('derives the write class from the tool registry side-effect declarations', () => {
    const tools: ToolName[] = [
      'code_interpreter',
      'document_generator',
      'web_search_grounding',
      'image_prompt_compiler',
      'repository_explorer',
      'file_reader',
      'file_writer',
      'verification_runner',
    ];
    for (const tool of tools) {
      expect(agentRunStepRequiresWriteLock(tool)).toBe(tool === 'file_writer');
    }
  });

  it('uses a plain scope key for the shared repository, not an owner-derived value', () => {
    expect(KEY).toBe('origin-repository');
    expect(AGENT_RUN_WRITE_LOCK_KEY_PATTERN.test(KEY)).toBe(true);
  });
});

describe('InMemoryAgentRunWriteLockStore', () => {
  it('grants a free lock with a lease and reports the holder', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunWriteLockStore(() => clock);
    const acquired = await store.acquire(KEY, RUN_A, DRIVER_A, 120);
    expect(acquired).toEqual({
      lockKey: KEY,
      holderRunId: RUN_A,
      holderDriverId: DRIVER_A,
      acquiredAt: clock,
      leaseExpiresAt: clock + 120_000,
    });
    expect(await store.inspect(KEY)).toEqual(acquired);
    clock += 1_000;
    expect(await store.inspect('other-target')).toBeNull();
  });

  it('denies a second holder while the lease is live, whichever half of the holder pair differs', async () => {
    const store = new InMemoryAgentRunWriteLockStore(() => 1_700_000_000_000);
    await store.acquire(KEY, RUN_A, DRIVER_A, 120);
    await expect(store.acquire(KEY, RUN_B, DRIVER_B, 120)).resolves.toBeNull();
    await expect(store.acquire(KEY, RUN_A, DRIVER_B, 120)).resolves.toBeNull();
    await expect(store.acquire(KEY, RUN_B, DRIVER_A, 120)).resolves.toBeNull();
  });

  it('refreshes the lease for the exact holder and keeps the original acquisition instant', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunWriteLockStore(() => clock);
    const first = await store.acquire(KEY, RUN_A, DRIVER_A, 120);
    clock += 60_000;
    const refreshed = await store.acquire(KEY, RUN_A, DRIVER_A, 120);
    expect(refreshed?.acquiredAt).toBe(first?.acquiredAt);
    expect(refreshed?.leaseExpiresAt).toBe(clock + 120_000);
  });

  it('renews only for the live holder', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunWriteLockStore(() => clock);
    await store.acquire(KEY, RUN_A, DRIVER_A, 60);
    await expect(store.renew(KEY, RUN_B, DRIVER_B, 60)).resolves.toBe(false);
    await expect(store.renew(KEY, RUN_A, DRIVER_A, 60)).resolves.toBe(true);
    expect((await store.inspect(KEY))?.leaseExpiresAt).toBe(clock + 60_000);
    clock += 61_000;
    await expect(store.renew(KEY, RUN_A, DRIVER_A, 60)).resolves.toBe(false);
  });

  it('releases only for the holder, and the freed lock can be taken at once', async () => {
    const store = new InMemoryAgentRunWriteLockStore(() => 1_700_000_000_000);
    await store.acquire(KEY, RUN_A, DRIVER_A, 120);
    await expect(store.release(KEY, RUN_B, DRIVER_B)).resolves.toBe(false);
    expect(await store.inspect(KEY)).not.toBeNull();
    await expect(store.release(KEY, RUN_A, DRIVER_A)).resolves.toBe(true);
    expect(await store.inspect(KEY)).toBeNull();
    await expect(store.acquire(KEY, RUN_B, DRIVER_B, 120)).resolves.not.toBeNull();
  });

  it('frees the lock at lease lapse so the next writer takes over', async () => {
    let clock = 1_700_000_000_000;
    const store = new InMemoryAgentRunWriteLockStore(() => clock);
    await store.acquire(KEY, RUN_A, DRIVER_A, 30);
    clock += 31_000;
    const taken = await store.acquire(KEY, RUN_B, DRIVER_B, 30);
    expect(taken).toMatchObject({ holderRunId: RUN_B, holderDriverId: DRIVER_B, acquiredAt: clock });
    // The displaced holder can no longer renew or release what it lost.
    await expect(store.renew(KEY, RUN_A, DRIVER_A, 30)).resolves.toBe(false);
    await expect(store.release(KEY, RUN_A, DRIVER_A)).resolves.toBe(false);
    expect((await store.inspect(KEY))?.holderRunId).toBe(RUN_B);
  });

  it('rejects malformed lock requests before touching state', async () => {
    const store = new InMemoryAgentRunWriteLockStore(() => 1_700_000_000_000);
    await expect(store.acquire('Origin Repo', RUN_A, DRIVER_A, 120)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.acquire('x', RUN_A, DRIVER_A, 120)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.acquire(KEY, 'not-a-run', DRIVER_A, 120)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.acquire(KEY, RUN_A, 'x', 120)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.acquire(KEY, RUN_A, DRIVER_A, 29)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.acquire(KEY, RUN_A, DRIVER_A, 301)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.acquire(KEY, RUN_A, DRIVER_A, 1.5)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.renew(KEY, RUN_A, DRIVER_A, 0)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.release(KEY, 'bogus', DRIVER_A)).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    await expect(store.inspect('')).rejects.toThrow('AGENT_RUN_WRITE_LOCK_INPUT_INVALID');
    expect(await store.inspect(KEY)).toBeNull();
  });
});
