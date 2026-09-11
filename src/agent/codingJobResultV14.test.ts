// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCodingJobResultV14, decryptCodingJobResultV14, encryptCodingJobResultV14 } from './codingJobResultV14.js';
import type { CodingSessionResult } from './codingSessionV14.js';

const roots: string[] = [];
const env = { ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 9).toString('base64') };
const jobId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';

async function root(prefix: string): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(value);
  await mkdir(path.join(value, 'src'), { recursive: true });
  return value;
}

function session(): CodingSessionResult {
  return {
    runId: 'coding-test',
    status: 'verified',
    code: 'CODING_CHECKS_PASSED',
    repairRounds: 1,
    changedPaths: ['src/existing.ts', 'src/new.ts'],
    audit: [
      { sequence: 1, action: 'verified', attempt: 0, checks: [
        { kind: 'typecheck', ok: false, exitCode: 2, timedOut: false },
        { kind: 'lint', ok: true, exitCode: 0, timedOut: false },
        { kind: 'test', ok: true, exitCode: 0, timedOut: false },
        { kind: 'build', ok: true, exitCode: 0, timedOut: false },
      ] },
      { sequence: 2, action: 'verified', attempt: 1, checks: [
        { kind: 'typecheck', ok: true, exitCode: 0, timedOut: false },
        { kind: 'lint', ok: true, exitCode: 0, timedOut: false },
        { kind: 'test', ok: true, exitCode: 0, timedOut: false },
        { kind: 'build', ok: true, exitCode: 0, timedOut: false },
      ] },
    ],
    gitPublished: false,
    deployed: false,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(value => rm(value, { recursive: true, force: true })));
});

describe('coding job result V1.4', () => {
  it('captures bounded before/after previews plus the latest verification evidence', async () => {
    if (process.platform !== 'linux') return;
    const baseline = await root('origin-v14-result-base-');
    const workspace = await root('origin-v14-result-work-');
    await writeFile(path.join(baseline, 'src/existing.ts'), 'export const value = 1;\n');
    await writeFile(path.join(workspace, 'src/existing.ts'), 'export const value = 2;\n');
    await writeFile(path.join(workspace, 'src/new.ts'), 'export const created = true;\n');

    const result = await buildCodingJobResultV14(session(), baseline, workspace);
    expect(result.diffs).toEqual([
      expect.objectContaining({ path: 'src/existing.ts', kind: 'modified', before: 'export const value = 1;\n', after: 'export const value = 2;\n', previewAvailable: true }),
      expect.objectContaining({ path: 'src/new.ts', kind: 'created', before: null, after: 'export const created = true;\n', previewAvailable: true }),
    ]);
    expect(result.verificationChecks).toHaveLength(4);
    expect(result.verificationChecks.every(check => check.ok && check.attempt === 1)).toBe(true);
    expect(result.repairRounds).toBe(1);
  });

  it('encrypts result details with job-bound authenticated encryption', async () => {
    if (process.platform !== 'linux') return;
    const baseline = await root('origin-v14-result-base-');
    const workspace = await root('origin-v14-result-work-');
    await writeFile(path.join(baseline, 'src/existing.ts'), 'export const value = 1;\n');
    await writeFile(path.join(workspace, 'src/existing.ts'), 'export const value = 2;\n');
    await writeFile(path.join(workspace, 'src/new.ts'), 'export const created = true;\n');
    const result = await buildCodingJobResultV14(session(), baseline, workspace);

    const encrypted = encryptCodingJobResultV14(jobId, result, env);
    expect(encrypted).toMatch(/^r1\./);
    expect(encrypted).not.toContain('existing.ts');
    expect(decryptCodingJobResultV14(jobId, encrypted, env)).toEqual(result);
    expect(() => decryptCodingJobResultV14('coding-BBBBBBBBBBBBBBBBBBBBBB', encrypted, env)).toThrow('CODING_JOB_RESULT_INVALID');
  });

  it.each(['edited', 'mutation'] as const)('does not attach stale check results after %s', async reason => {
    const baseline = await root('origin-v14-stale-base-');
    const workspace = await root('origin-v14-stale-work-');
    const value = session();
    value.status = 'blocked';
    value.changedPaths = [];
    value.audit.push(reason === 'edited'
      ? { sequence: 3, action: 'edited', attempt: 2, changes: [] }
      : { sequence: 3, action: 'stopped', attempt: 1, code: 'CODING_WORKSPACE_CHANGED_DURING_CHECKS' });
    const result = await buildCodingJobResultV14(value, baseline, workspace);
    expect(result.verificationChecks).toEqual([]);
  });

  it('rejects a verified result without four successful checks on the final attempt', async () => {
    const baseline = await root('origin-v14-evidence-base-');
    const workspace = await root('origin-v14-evidence-work-');
    const value = session();
    value.changedPaths = [];
    const result = await buildCodingJobResultV14(value, baseline, workspace);
    expect(() => encryptCodingJobResultV14(jobId, { ...result, verificationChecks: [] }, env)).toThrow('CODING_JOB_RESULT_INVALID');
    expect(() => encryptCodingJobResultV14(jobId, { ...result, repairRounds: 2 }, env)).toThrow('CODING_JOB_RESULT_INVALID');
    const checks = result.verificationChecks.map(check => ({ ...check, timedOut: true }));
    expect(() => encryptCodingJobResultV14(jobId, { ...result, verificationChecks: checks }, env)).toThrow('CODING_JOB_RESULT_INVALID');
  });
});
