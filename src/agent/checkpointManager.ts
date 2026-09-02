import { createHash } from 'node:crypto';
import { readRepositoryFile } from './safeRepositoryReader.js';
import { writeRepositoryFile } from './safeRepositoryWriter.js';
import { deleteRepositoryFile } from './safeRepositoryDeleter.js';
import { containsLikelySecret } from './safeFilePolicy.js';

const MAX_SNAPSHOT_BYTES = 256 * 1024;

export type FileMutationCheckpoint = {
  path: string;
  beforeExists: boolean;
  beforeContent?: string;
  afterSha256: string;
};

export type CheckpointState = {
  checkpointId: string;
  taskId: string;
  executionId: string;
  version: number;
  status: string;
  artifact: string;
  createdAt: number;
  mutation?: FileMutationCheckpoint;
};

const checkpoints = new Map<string, CheckpointState>();
const taskVersions = new Map<string, number>();

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

function validateMutation(mutation: FileMutationCheckpoint | undefined): void {
  if (!mutation) return;
  if (!mutation.path || mutation.path.length > 1024) throw new Error('CHECKPOINT_INVALID_MUTATION');
  if (!mutation.afterSha256 || !/^[a-f0-9]{64}$/.test(mutation.afterSha256)) throw new Error('CHECKPOINT_INVALID_MUTATION');
  if (mutation.beforeExists) {
    if (typeof mutation.beforeContent !== 'string') throw new Error('CHECKPOINT_SNAPSHOT_MISSING');
    if (Buffer.byteLength(mutation.beforeContent, 'utf8') > MAX_SNAPSHOT_BYTES) throw new Error('CHECKPOINT_SNAPSHOT_TOO_LARGE');
    if (containsLikelySecret(mutation.beforeContent)) throw new Error('CHECKPOINT_SECRET_SNAPSHOT_BLOCKED');
  } else if (mutation.beforeContent !== undefined) {
    throw new Error('CHECKPOINT_INVALID_MUTATION');
  }
}

export function saveCheckpoint(input: Omit<CheckpointState, 'checkpointId' | 'version' | 'createdAt'>): CheckpointState {
  validateMutation(input.mutation);
  const version = (taskVersions.get(input.taskId) ?? 0) + 1;
  const checkpoint: CheckpointState = {
    ...input,
    checkpointId: `${input.taskId}-${input.executionId}-v${version}`,
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

async function readCurrent(root: string, filePath: string): Promise<string | undefined> {
  try {
    return await readRepositoryFile(root, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function rollbackToCheckpoint(checkpointId: string, repositoryRoot = process.cwd()): Promise<CheckpointState> {
  const checkpoint = checkpoints.get(checkpointId);
  if (!checkpoint) throw new Error('CHECKPOINT_NOT_FOUND');
  const mutation = checkpoint.mutation;
  if (!mutation) throw new Error('CHECKPOINT_ROLLBACK_UNSUPPORTED');

  const current = await readCurrent(repositoryRoot, mutation.path);
  const currentSha256 = current === undefined ? undefined : sha256(current);
  if (currentSha256 !== mutation.afterSha256) throw new Error('CHECKPOINT_STATE_CHANGED');

  if (mutation.beforeExists) {
    await writeRepositoryFile(repositoryRoot, mutation.path, mutation.beforeContent ?? '');
    const restored = await readRepositoryFile(repositoryRoot, mutation.path);
    if (sha256(restored) !== sha256(mutation.beforeContent ?? '')) throw new Error('CHECKPOINT_ROLLBACK_VERIFY_FAILED');
  } else {
    await deleteRepositoryFile(repositoryRoot, mutation.path);
    if (await readCurrent(repositoryRoot, mutation.path) !== undefined) throw new Error('CHECKPOINT_ROLLBACK_VERIFY_FAILED');
  }

  return saveCheckpoint({
    taskId: checkpoint.taskId,
    executionId: checkpoint.executionId,
    status: 'rolled_back',
    artifact: checkpoint.artifact,
  });
}

export function hasSuccessfulCheckpoint(taskId: string, executionId: string): boolean {
  return [...checkpoints.values()].some(
    (checkpoint) => checkpoint.taskId === taskId
      && checkpoint.executionId === executionId
      && (checkpoint.status === 'completed' || checkpoint.status === 'self_fixed'),
  );
}
