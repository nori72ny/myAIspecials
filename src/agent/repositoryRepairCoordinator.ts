import type { RepairFailure, RepairPlan } from './codingRepairContract.js';
import { createRepairPlan } from './codingRepairContract.js';

export type RepairCoordinatorState = {
  attempt: number;
  fingerprints: readonly string[];
};

export type RepairCoordinatorResult =
  | { action: 'repair'; plan: RepairPlan; state: RepairCoordinatorState }
  | { action: 'stop'; plan: RepairPlan; state: RepairCoordinatorState };

/**
 * Pure orchestration boundary for repository repair.
 * It decides whether a repair may proceed; it never writes files or executes commands.
 */
export function coordinateRepositoryRepair(
  failure: RepairFailure,
  state: RepairCoordinatorState,
): RepairCoordinatorResult {
  const plan = createRepairPlan(failure, state.attempt, state.fingerprints);
  const fingerprints = [...state.fingerprints, plan.fingerprint];
  const nextState = { attempt: state.attempt + 1, fingerprints };

  if (plan.decision.action === 'stop') {
    return { action: 'stop', plan, state: nextState };
  }

  return { action: 'repair', plan, state: nextState };
}
