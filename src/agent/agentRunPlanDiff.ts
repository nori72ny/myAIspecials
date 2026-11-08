import type { ToolName, ToolParams } from './toolRegistry.js';
import type { AgentRunPlanStep } from './agentRunRecord.js';

/**
 * Plan diffing for the hold/resume flow (multitask Phase 1, PR 1-C).
 *
 * Resuming a held run always re-plans the goal with the current planner
 * (design §8.4). The user must be able to see whether the plan they are
 * about to approve is the one that was stored when the run was held, so
 * the resume endpoint presents this per-step diff and the approval is
 * bound to the new plan either way. Params are compared with a stable
 * (key-sorted) serialization so a JSON round trip through the run store
 * never reports a phantom change.
 */

export type AgentRunPlanStepInput = { toolName: ToolName; params: ToolParams };

export type AgentRunPlanStepChange = 'unchanged' | 'modified' | 'added' | 'removed';

export type AgentRunPlanStepDiff = {
  index: number;
  change: AgentRunPlanStepChange;
  /** Tool of the new plan at this index, or null when the step was removed. */
  toolName: ToolName | null;
  /** Tool of the stored plan at this index, or null when the step was added. */
  previousToolName: ToolName | null;
  /** True when the tool stayed the same but its params differ. Also true
   * (with the tool change) when the tool itself changed. */
  paramsChanged: boolean;
};

export type AgentRunPlanDiff = {
  changed: boolean;
  previousStepCount: number;
  nextStepCount: number;
  steps: AgentRunPlanStepDiff[];
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

export function agentRunPlanParamsEqual(a: ToolParams, b: ToolParams): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Compares the stored plan snapshot of a held run with the freshly
 * re-planned steps for the same goal. A null stored plan (a goal-only
 * held run that was never planned) diffs as "every step added".
 */
export function diffAgentRunPlans(
  previous: readonly AgentRunPlanStep[] | null,
  next: readonly AgentRunPlanStepInput[],
): AgentRunPlanDiff {
  const stored = previous ?? [];
  const length = Math.max(stored.length, next.length);
  const steps: AgentRunPlanStepDiff[] = [];
  for (let index = 0; index < length; index += 1) {
    const before = stored[index];
    const after = next[index];
    if (before && after) {
      const paramsChanged = !agentRunPlanParamsEqual(before.params, after.params);
      const toolChanged = before.toolName !== after.toolName;
      steps.push({
        index,
        change: !toolChanged && !paramsChanged ? 'unchanged' : 'modified',
        toolName: after.toolName,
        previousToolName: before.toolName,
        paramsChanged: paramsChanged || toolChanged,
      });
    } else if (after) {
      steps.push({ index, change: 'added', toolName: after.toolName, previousToolName: null, paramsChanged: false });
    } else if (before) {
      steps.push({ index, change: 'removed', toolName: null, previousToolName: before.toolName, paramsChanged: false });
    }
  }
  return {
    changed: steps.some((step) => step.change !== 'unchanged'),
    previousStepCount: stored.length,
    nextStepCount: next.length,
    steps,
  };
}
