import type { CodingJobWorkerOutcomeV14 } from './codingJobWorkerV14.js';

/**
 * GitHub Actions process status is not the durable Coding task's outcome.
 * In particular, a safely blocked or failed task must NOT give a green
 * workflow that observers could mistake for an actual verified code edit.
 *
 * Only the durable verified terminal may exit successfully. Lease/transport
 * uncertainty retains exit 2 so the existing bounded recovery path applies.
 * All other terminal/nonclaimed outcomes exit 1 with their code in structured
 * worker logs; do not retry or claim a successful artifact.
 */
export function codingWorkerOutcomeExitCodeV14(
  state: CodingJobWorkerOutcomeV14['state'],
): 0 | 1 | 2 {
  if (state === 'verified') return 0;
  if (state === 'retryable' || state === 'lease_lost') return 2;
  return 1;
}
