export type TaskExecutionState = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'aborted';

export type TaskExecutionResult = {
  state: TaskExecutionState;
  verified: boolean;
  toolExecuted: boolean;
  repairAttempts: number;
};

export function canReportCompleted(result: TaskExecutionResult): boolean {
  return result.state === 'completed' && result.toolExecuted && result.verified && result.repairAttempts <= 3;
}

export function assertCanReportCompleted(result: TaskExecutionResult): void {
  if (!canReportCompleted(result)) throw new Error('AGENT_COMPLETION_GATE_BLOCKED');
}
