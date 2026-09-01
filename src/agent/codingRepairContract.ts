import type { RepairFailure, RepairDecision } from './repositoryRepairPolicy.js';
import { decideRepair, fingerprintRepairFailure } from './repositoryRepairPolicy.js';

export type RepairPlan = {
  decision: RepairDecision;
  failure: RepairFailure;
  fingerprint: string;
  constraints: readonly string[];
};

/** Converts verification output into a bounded contract for the coding agent.
 * The repair planner never writes files and never executes commands itself.
 */
export function createRepairPlan(
  failure: RepairFailure,
  attempt: number,
  previousFingerprints: readonly string[] = [],
): RepairPlan {
  const fingerprint = fingerprintRepairFailure(failure);
  return {
    decision: decideRepair(failure, attempt, previousFingerprints),
    failure: {
      ...failure,
      stdout: failure.stdout.slice(0, 12000),
      stderr: failure.stderr.slice(0, 12000),
    },
    fingerprint,
    constraints: [
      'Only modify files explicitly permitted by the tool policy.',
      'Never modify protected paths or secrets.',
      'Never disable or delete tests merely to obtain a passing result.',
      'Re-run verification after every accepted repair.',
      'Stop when the same failure fingerprint repeats or the attempt budget is exhausted.',
    ],
  };
}
