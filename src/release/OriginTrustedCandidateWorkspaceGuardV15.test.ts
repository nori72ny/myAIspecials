// @vitest-environment node
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertTrustedCandidateDiffScopeV15,
  assertTrustedCandidatePathNoSymlinksV15,
  writeTrustedCandidateHiddenTestV15,
} from './OriginTrustedCandidateWorkspaceGuardV15.js';

describe('trusted candidate workspace guard', () => {
  it('requires actual diff to equal the candidate report and remain inside required paths', () => {
    expect(() => assertTrustedCandidateDiffScopeV15({
      actualPaths: ['src/a.ts', 'src/b.ts'],
      reportedPaths: ['src/b.ts', 'src/a.ts'],
      requiredPaths: ['src/a.ts', 'src/b.ts'],
    })).not.toThrow();

    expect(() => assertTrustedCandidateDiffScopeV15({
      actualPaths: ['src/a.ts', 'src/extra.ts'],
      reportedPaths: ['src/a.ts', 'src/extra.ts'],
      requiredPaths: ['src/a.ts', 'src/b.ts'],
    })).toThrow('TRUSTED_CANDIDATE_UNAUTHORIZED_DIFF');

    expect(() => assertTrustedCandidateDiffScopeV15({
      actualPaths: ['src/a.ts'],
      reportedPaths: ['src/b.ts'],
      requiredPaths: ['src/a.ts', 'src/b.ts'],
    })).toThrow('TRUSTED_CANDIDATE_DIFF_REPORT_MISMATCH');
  });

  it('blocks symlinked hidden-test parents before any trusted write', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-guard-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-outside-'));
    await mkdir(path.join(root, 'tests'), { recursive: true });
    await symlink(outside, path.join(root, 'tests', '__origin_heldout__'));

    await expect(writeTrustedCandidateHiddenTestV15(
      root,
      'tests/__origin_heldout__/secret.test.ts',
      "import { it } from 'vitest'; it('x', () => {});",
    )).rejects.toThrow('TRUSTED_CANDIDATE_SYMLINK_BLOCKED');
  });

  it('writes hidden tests only under a symlink-free held-out directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-guard-ok-'));
    await writeFile(path.join(root, 'package.json'), '{}');

    await expect(writeTrustedCandidateHiddenTestV15(
      root,
      'tests/__origin_heldout__/nested/secret.test.ts',
      "import { it } from 'vitest'; it('x', () => {});",
    )).resolves.toBeUndefined();
    await expect(assertTrustedCandidatePathNoSymlinksV15(
      root,
      'tests/__origin_heldout__/nested/secret.test.ts',
    )).resolves.toBeUndefined();
  });
});
