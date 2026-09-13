// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => {
  // Match execFile's custom promisify contract ({ stdout, stderr }).
  Object.defineProperty(git, Symbol.for('nodejs.util.promisify.custom'), { value: (...args: unknown[]) =>
    new Promise((resolve, reject) => git(...args, (error: Error | null, stdout: string, stderr: string) => {
      if (error) reject(error); else resolve({ stdout, stderr });
    })), configurable: true });
  return { execFile: git };
});
import { captureCodingJobExecutionEvidenceV14, validCodingJobExecutionEvidenceV14 } from './codingJobExecutionEvidenceV14.js';

const revision = 'a'.repeat(40);
const evidence = { sourceRevision: revision, workerRunId: '12345', workerRunAttempt: 1 };
const env = {
  GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'nori72ny/myAIspecials', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_REF: 'nori72ny/myAIspecials/.github/workflows/coding-job-worker-v14.yml@refs/heads/main',
  GITHUB_SHA: revision, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1',
};

beforeEach(() => {
  git.mockReset();
  git.mockImplementation((_file, _args, _options, callback) => callback(null, `${revision}\n`, ''));
});

describe('trusted worker execution provenance', () => {
  it('captures the checkout revision without passing credentials or Git overrides to the child', async () => {
    const result = await captureCodingJobExecutionEvidenceV14('/trusted/checkout', {
      ...env, OPENROUTER_API_KEY: 'fixture-secret', GIT_DIR: '/untrusted/override',
    });
    expect(result).toEqual(evidence);
    expect(Object.isFrozen(result)).toBe(true);
    expect(git.mock.calls[0].slice(0, 3)).toEqual(['git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: '/trusted/checkout',
      env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      timeout: 5000, maxBuffer: 1024, encoding: 'utf8',
    }]);
  });

  it.each(Object.keys(env))('rejects missing %s before reading Git', async key => {
    const invalid: NodeJS.ProcessEnv = { ...env };
    delete invalid[key];
    await expect(captureCodingJobExecutionEvidenceV14('/trusted', invalid)).rejects.toThrow('CODING_WORKER_EXECUTION_EVIDENCE_INVALID');
    expect(git).not.toHaveBeenCalled();
  });

  it('rejects a different checkout even if the workflow environment looks valid', async () => {
    git.mockImplementation((_file, _args, _options, callback) => callback(null, `${'b'.repeat(40)}\n`, ''));
    await expect(captureCodingJobExecutionEvidenceV14('/trusted', env)).rejects.toThrow('CODING_WORKER_SOURCE_REVISION_MISMATCH');
  });

  it('replaces Git errors with a safe code', async () => {
    git.mockImplementation((_file, _args, _options, callback) => callback(new Error('private-path-fixture')));
    await expect(captureCodingJobExecutionEvidenceV14('/trusted', env)).rejects.toThrow('CODING_WORKER_SOURCE_REVISION_UNAVAILABLE');
  });

  it.each([null, {}, [], { ...evidence, sourceRevision: 'main' }, { ...evidence, workerRunId: '../secret' },
    { ...evidence, workerRunAttempt: 0 }, { ...evidence, workerRunAttempt: 1.5 },
    { ...evidence, workerRunAttempt: Number.MAX_SAFE_INTEGER + 1 }, { ...evidence, goal: 'untrusted' },
  ])('rejects malformed or extra provenance fields %#', value => {
    expect(validCodingJobExecutionEvidenceV14(value)).toBe(false);
  });
});
