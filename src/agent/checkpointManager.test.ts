import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getCheckpoint, rollbackToCheckpoint, saveCheckpoint } from './checkpointManager';

const tempRoots: string[] = [];
const makeRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-checkpoint-'));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('checkpoint rollback integrity', () => {
  it('restores the exact pre-edit bytes and verifies the result', async () => {
    const root = await makeRoot();
    const file = path.join(root, 'example.txt');
    await fs.writeFile(file, 'before', 'utf8');
    const checkpoint = saveCheckpoint({
      taskId: 'task-restore',
      executionId: 'exec-restore',
      status: 'completed',
      artifact: 'example.txt',
      mutation: { path: 'example.txt', beforeExists: true, beforeContent: 'before', afterSha256: 'a0f1490a20d0211c997b9d1d4d4f4a0b1a8e4c3b7b4d2b3c2f2d4e7f4f0b5d3a' },
    });
    // Replace the synthetic hash with the real value by creating a second checkpoint.
    const crypto = await import('node:crypto');
    const valid = saveCheckpoint({
      taskId: 'task-restore-valid',
      executionId: 'exec-restore-valid',
      status: 'completed',
      artifact: 'example.txt',
      mutation: { path: 'example.txt', beforeExists: true, beforeContent: 'before', afterSha256: crypto.createHash('sha256').update('after').digest('hex') },
    });
    await fs.writeFile(file, 'after', 'utf8');
    const rolledBack = await rollbackToCheckpoint(valid.checkpointId, root);
    expect(await fs.readFile(file, 'utf8')).toBe('before');
    expect(rolledBack.status).toBe('rolled_back');
    expect(getCheckpoint(valid.checkpointId)?.status).toBe('completed');
    expect(checkpoint.checkpointId).toContain('task-restore');
  });

  it('fails closed when the file changed after the checkpoint', async () => {
    const root = await makeRoot();
    const file = path.join(root, 'changed.txt');
    await fs.writeFile(file, 'current', 'utf8');
    const crypto = await import('node:crypto');
    const checkpoint = saveCheckpoint({
      taskId: 'task-stale',
      executionId: 'exec-stale',
      status: 'completed',
      artifact: 'changed.txt',
      mutation: { path: 'changed.txt', beforeExists: true, beforeContent: 'before', afterSha256: crypto.createHash('sha256').update('after').digest('hex') },
    });
    await expect(rollbackToCheckpoint(checkpoint.checkpointId, root)).rejects.toThrow('CHECKPOINT_STATE_CHANGED');
    expect(await fs.readFile(file, 'utf8')).toBe('current');
  });

  it('deletes a file that did not exist before the checkpoint', async () => {
    const root = await makeRoot();
    const crypto = await import('node:crypto');
    const checkpoint = saveCheckpoint({
      taskId: 'task-create',
      executionId: 'exec-create',
      status: 'completed',
      artifact: 'created.txt',
      mutation: { path: 'created.txt', beforeExists: false, afterSha256: crypto.createHash('sha256').update('created').digest('hex') },
    });
    await fs.writeFile(path.join(root, 'created.txt'), 'created', 'utf8');
    await rollbackToCheckpoint(checkpoint.checkpointId, root);
    await expect(fs.access(path.join(root, 'created.txt'))).rejects.toThrow();
  });
});
