export type AgentExecutionRecord = {
  stepId: string;
  outcome: 'success' | 'failure' | 'blocked';
  summary: string;
  details?: string;
};

export type AgentContextSummary = {
  goal: string;
  completedSteps: string[];
  failures: string[];
  nextAction: string;
};

const MAX_FIELD = 1000;
const MAX_COMPLETED_STEPS = 20;
const MAX_FAILURES = 5;
const clean = (value: string) => value.trim().slice(0, MAX_FIELD);

/** Keep only decision-relevant state between agent steps. Full tool output must not
 * be carried indefinitely, reducing context growth and accidental secret replay. */
export function compactAgentContext(
  goal: string,
  records: readonly AgentExecutionRecord[],
  nextAction: string,
): AgentContextSummary {
  const completedSteps = records
    .filter((record) => record.outcome === 'success')
    .map((record) => `${clean(record.stepId)}: ${clean(record.summary)}`)
    .slice(-MAX_COMPLETED_STEPS);
  const failures = records
    .filter((record) => record.outcome !== 'success')
    .map((record) => `${clean(record.stepId)}: ${clean(record.summary)}`)
    .slice(-MAX_FAILURES);

  return {
    goal: clean(goal),
    completedSteps,
    failures,
    nextAction: clean(nextAction),
  };
}
