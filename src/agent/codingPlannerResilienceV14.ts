import { createCodingPlannerV14 } from './codingPlannerV14.js';
import type { CodingContext, CodingProposalBatch } from './codingSessionV14.js';

const RETRYABLE_PLANNER_CODE = 'CODING_MODEL_EDIT_MATCH_INVALID';

/**
 * Adds one bounded fresh re-plan only when the strict planner exhausts its own
 * correction attempt because an edit search block is absent or non-unique.
 * All other planner/provider/policy failures remain fail-closed. The same
 * trusted context and planner options are reused; scope is never expanded.
 */
export function createResilientCodingPlannerV14(
  options: Parameters<typeof createCodingPlannerV14>[0] = {},
): (context: CodingContext) => Promise<CodingProposalBatch> {
  const planner = createCodingPlannerV14(options);
  return async context => {
    try {
      return await planner(context);
    } catch (error) {
      if (!(error instanceof Error) || error.message.split(':', 1)[0] !== RETRYABLE_PLANNER_CODE) throw error;
      return planner(context);
    }
  };
}
