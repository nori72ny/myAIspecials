import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { runVerification } from '../../src/agent/verificationRunner.js';

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeChild(exitCode = 0): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  queueMicrotask(() => child.emit('close', exitCode));
  return child;
}

describe('runVerification', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-verification-'));
    spawnMock.mockReset();
  });

  it('rejects commands outside the verification allowlist', async () => {
    await expect(runVerification(root, 'lint' as never)).rejects.toThrow('VERIFICATION_NOT_ALLOWED');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('requires the selected npm script to exist', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    await expect(runVerification(root, 'typecheck')).rejects.toThrow('VERIFICATION_SCRIPT_MISSING:typecheck');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('runs the allowlisted script without a shell and returns bounded verification state', async () => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    spawnMock.mockReturnValue(makeChild(0));

    const result = await runVerification(root, 'test');

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(spawnMock).toHaveBeenCalledWith('npm', ['run', 'test'], expect.objectContaining({ cwd: root, shell: false }));
  });
});
