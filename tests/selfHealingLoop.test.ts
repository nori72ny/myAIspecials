import { describe, expect, it } from 'vitest';
import { runBoundedSelfHealing } from '../src/agent/selfHealingLoop.js';

describe('bounded self-healing loop', () => {
  it('repairs a failure and stops after success', async () => {
    let checks = 0;
    const result = await runBoundedSelfHealing(
      async () => (++checks >= 2 ? { ok: true } : { ok: false, error: 'TYPE_ERROR' }),
      async () => ({ changed: true, diagnosis: 'Corrected the failing type.' }),
    );
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(1);
  });

  it('caps repair attempts at three', async () => {
    let repairs = 0;
    const result = await runBoundedSelfHealing(
      async () => ({ ok: false, error: 'PERSISTENT_FAILURE' }),
      async () => { repairs += 1; return { changed: true, diagnosis: 'retry' }; },
      { maxAttempts: 99 },
    );
    expect(result.ok).toBe(false);
    expect(repairs).toBe(3);
    expect(result.attempts).toHaveLength(3);
  });

  it('fails closed when repair cannot make a change', async () => {
    const result = await runBoundedSelfHealing(
      async () => ({ ok: false, error: 'UNRECOVERABLE' }),
      async () => ({ changed: false, diagnosis: 'No safe repair identified.' }),
    );
    expect(result.ok).toBe(false);
    expect(result.finalError).toBe('UNRECOVERABLE');
  });
});
