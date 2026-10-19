import { describe, expect, it } from 'vitest';
import { codingWorkerOutcomeExitCodeV14 } from './codingWorkerOutcomeExitV14.js';
import type { CodingJobWorkerOutcomeV14 } from './codingJobWorkerV14.js';

describe('Coding V1.4 hosted worker truthful GitHub Actions status', () => {
  it('returns success only after durable verified completion', () => {
    const outcomes: Array<[CodingJobWorkerOutcomeV14['state'], 0 | 1 | 2]> = [
      ['verified', 0],
      ['blocked', 1],
      ['failed', 1],
      ['cancelled', 1],
      ['not_claimed', 1],
      ['lease_lost', 2],
      ['retryable', 2],
    ];
    for (const [state, expected] of outcomes) {
      expect(codingWorkerOutcomeExitCodeV14(state)).toBe(expected);
    }
  });

  it('does not mislabel the observed model edit mismatch as workflow success', () => {
    expect(codingWorkerOutcomeExitCodeV14('blocked')).toBe(1);
    expect(codingWorkerOutcomeExitCodeV14('verified')).toBe(0);
  });

  it('preserves the existing bounded GitHub recovery protocol only for uncertain outcomes', () => {
    expect(codingWorkerOutcomeExitCodeV14('retryable')).toBe(2);
    expect(codingWorkerOutcomeExitCodeV14('lease_lost')).toBe(2);
    for (const terminal of ['blocked', 'failed', 'cancelled', 'not_claimed'] as const) {
      expect(codingWorkerOutcomeExitCodeV14(terminal)).not.toBe(2);
    }
  });
});
