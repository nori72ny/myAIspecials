export type CheckpointState = {
  checkpointId: string;
  taskId: string;
  version: number;
  status: string;
  artifact: string;
  createdAt: number;
};

const checkpoints = new Map<string, CheckpointState>();
const taskVersions = new Map<string, number>();

export function saveCheckpoint(input: Omit<CheckpointState, 'checkpointId' | 'version' | 'createdAt'>): CheckpointState {
  const version = (taskVersions.get(input.taskId) ?? 0) + 1;
  const checkpoint: CheckpointState = {
    ...input,
    checkpointId: `${input.taskId}-v${version}`,
    version,
    createdAt: Date.now(),
  };
  checkpoints.set(checkpoint.checkpointId, checkpoint);
  taskVersions.set(input.taskId, version);
  return checkpoint;
}

export function getCheckpoint(checkpointId: string): CheckpointState | undefined {
  return checkpoints.get(checkpointId);
}

export function listCheckpoints(taskId: string): CheckpointState[] {
  return [...checkpoints.values()].filter((item) => item.taskId === taskId).sort((a, b) => a.version - b.version);
}

export function rollbackToCheckpoint(checkpointId: string): CheckpointState {
  const checkpoint = checkpoints.get(checkpointId);
  if (!checkpoint) throw new Error('CHECKPOINT_NOT_FOUND');
  // Rollback is represented as a new immutable checkpoint so history is never destroyed.
  return saveCheckpoint({
    taskId: checkpoint.taskId,
    status: 'rolled_back',
    artifact: checkpoint.artifact,
  });
}
