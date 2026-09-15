// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  HELD_OUT_PRIVATE_TASK_PACKET_VERSION,
  heldOutPrivateTaskDigestV14,
  publicHeldOutTaskFromPrivatePacketV14,
  runTrustedHeldOutCodingBenchmarkV14,
  type HeldOutPrivateTaskPacketV14,
} from './heldOutCodingTrustedRunnerV14.js';
import type { CodingSessionResult } from './codingSessionV14.js';

function packet(): HeldOutPrivateTaskPacketV14 {
  return {
    version: HELD_OUT_PRIVATE_TASK_PACKET_VERSION,
    id: 'task-multifile-recovery-01',
    baseSha: 'a'.repeat(40),
    timeBudgetMs: 60_000,
    requiredChangedPaths: ['src/a.ts', 'src/b.ts'],
    protectedPaths: ['tests/hidden.ts'],
    recoveryRequired: true,
    goal: 'Fix the cross-file bug while preserving the public API.',
    hiddenTests: [{ path: 'cross-file.test.ts', content: "import { describe, it } from 'vitest';\ndescribe('hidden', () => { it('works', () => {}); });\n" }],
  };
}

function check(kind: 'typecheck' | 'lint' | 'test' | 'build', ok: boolean) {
  return { kind, ok, exitCode: ok ? 0 : 1, timedOut: false };
}

function session(): CodingSessionResult {
  return {
    runId: 'coding-test-run',
    status: 'verified',
    code: 'CODING_CHECKS_PASSED',
    repairRounds: 1,
    changedPaths: ['src/a.ts', 'src/b.ts'],
    audit: [
      { sequence: 1, action: 'edited', attempt: 0, changes: [{ path: 'src/a.ts', beforeSha256: 'a', afterSha256: 'b' }] },
      { sequence: 2, action: 'verified', attempt: 0, checks: [check('typecheck', true), check('lint', true), check('test', false), check('build', true)] },
      { sequence: 3, action: 'edited', attempt: 1, changes: [{ path: 'src/b.ts', beforeSha256: 'c', afterSha256: 'd' }] },
      { sequence: 4, action: 'verified', attempt: 1, checks: [check('typecheck', true), check('lint', true), check('test', true), check('build', true)] },
    ],
    gitPublished: false,
    deployed: false,
  };
}

describe('trusted held-out coding benchmark runner', () => {
  it('derives a deterministic public task without exposing private prompt or hidden tests', () => {
    const first = packet();
    const second = packet();
    expect(heldOutPrivateTaskDigestV14(first)).toBe(heldOutPrivateTaskDigestV14(second));
    const publicTask = publicHeldOutTaskFromPrivatePacketV14(first);
    expect(publicTask.taskDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(publicTask)).not.toContain(first.goal);
    expect(JSON.stringify(publicTask)).not.toContain('cross-file.test.ts');
    second.hiddenTests[0].content += '// changed';
    expect(heldOutPrivateTaskDigestV14(second)).not.toBe(publicTask.taskDigest);
  });

  it('scores a multifile repair only after private hidden verification succeeds', async () => {
    const task = packet();
    const result = await runTrustedHeldOutCodingBenchmarkV14(task, 'ORIGIN', {
      assertBaseSha: async sha => { expect(sha).toBe(task.baseSha); },
      runAgent: async () => ({ session: session(), provider: 'openrouter', model: 'free-model', costUsd: 0, durationMs: 12_000 }),
      runHiddenTests: async (_packet, agentSession) => { expect(agentSession.status).toBe('verified'); return { ok: true }; },
    });
    expect(result.score.solved).toBe(true);
    expect(result.score.axes).toEqual({ heldOutIdentity: true, multiFileEditing: true, verification: true, failureRecovery: true });
    expect(result.run.attempts).toHaveLength(2);
  });

  it('fails final verification when hidden tests fail without feeding them back to the agent', async () => {
    let hiddenCalls = 0;
    const result = await runTrustedHeldOutCodingBenchmarkV14(packet(), 'ORIGIN', {
      assertBaseSha: async () => {},
      runAgent: async () => ({ session: session(), provider: 'openrouter', model: 'free-model', costUsd: 0, durationMs: 12_000 }),
      runHiddenTests: async () => { hiddenCalls += 1; return { ok: false }; },
    });
    expect(hiddenCalls).toBe(1);
    expect(result.run.terminalStatus).toBe('failed');
    expect(result.score.solved).toBe(false);
    expect(result.score.regressions).toContain('verification-incomplete');
    expect(result.run.attempts.at(-1)?.checks.find(row => row.kind === 'test')?.ok).toBe(false);
  });

  it('does not run hidden tests for a blocked coding session', async () => {
    const blocked = { ...session(), status: 'blocked' as const, code: 'CODING_PATH_BLOCKED', audit: [], repairRounds: 0, changedPaths: [] };
    let hiddenCalls = 0;
    const result = await runTrustedHeldOutCodingBenchmarkV14(packet(), 'ORIGIN', {
      assertBaseSha: async () => {},
      runAgent: async () => ({ session: blocked, provider: 'openrouter', model: 'free-model', costUsd: 0, durationMs: 2_000 }),
      runHiddenTests: async () => { hiddenCalls += 1; return { ok: true }; },
    });
    expect(hiddenCalls).toBe(0);
    expect(result.run.terminalStatus).toBe('blocked');
    expect(result.score.solved).toBe(false);
  });

  it('rejects unsafe or single-file private task packets before execution', async () => {
    const unsafe = packet();
    unsafe.requiredChangedPaths = ['src/a.ts'];
    await expect(runTrustedHeldOutCodingBenchmarkV14(unsafe, 'ORIGIN', {
      assertBaseSha: async () => { throw new Error('must not execute'); },
      runAgent: async () => { throw new Error('must not execute'); },
      runHiddenTests: async () => ({ ok: true }),
    })).rejects.toThrow('HELD_OUT_PRIVATE_MULTIFILE_REQUIRED');
  });
});
