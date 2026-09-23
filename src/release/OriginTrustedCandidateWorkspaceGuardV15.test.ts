// @vitest-environment node
import { copyFile, link, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertTrustedCandidateDiffScopeV15,
  assertTrustedCandidatePathNoSymlinksV15,
  assertTrustedCandidateVerificationBaselineV15,
  writeTrustedCandidateHiddenTestV15,
} from './OriginTrustedCandidateWorkspaceGuardV15.js';

async function seedTrustedVerificationBaseline(root: string): Promise<void> {
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  for (const relative of [
    'package-lock.json',
    'vite.config.ts',
    'tsconfig.json',
    'scripts/design-token-lock.js',
  ]) {
    await copyFile(path.resolve(process.cwd(), relative), path.join(root, relative));
  }
}

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

  it('rejects ambiguous, control-character and traversal-like diff paths', () => {
    for (const invalid of ['src/', 'src//a.ts', 'src/./a.ts', 'src/../a.ts', 'src/a.ts\n']) {
      expect(() => assertTrustedCandidateDiffScopeV15({
        actualPaths: [invalid],
        reportedPaths: [invalid],
        requiredPaths: [invalid],
      })).toThrow('TRUSTED_CANDIDATE_DIFF_SCOPE_INVALID');
    }
  });

  it('blocks hard-linked changed files explicitly', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-hardlink-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    await link(path.join(root, 'src', 'a.ts'), path.join(root, 'src', 'alias.ts'));

    await expect(assertTrustedCandidatePathNoSymlinksV15(root, 'src/a.ts'))
      .rejects.toThrow('TRUSTED_CANDIDATE_HARDLINK_BLOCKED');
  });

  it('blocks non-regular changed leaves', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-special-'));
    await mkdir(path.join(root, 'src', 'directory.ts'), { recursive: true });
    await expect(assertTrustedCandidatePathNoSymlinksV15(root, 'src/directory.ts'))
      .rejects.toThrow('TRUSTED_CANDIDATE_SPECIAL_FILE_BLOCKED');
  });

  it('accepts only the trusted verification baseline and rejects alternate Vitest config', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-baseline-'));
    await seedTrustedVerificationBaseline(root);
    await expect(assertTrustedCandidateVerificationBaselineV15(root)).resolves.toBeUndefined();
    await writeFile(path.join(root, 'vitest.config.ts'), 'export default {};\n');
    await expect(assertTrustedCandidateVerificationBaselineV15(root))
      .rejects.toThrow('TRUSTED_CANDIDATE_VERIFICATION_CONFIG_SET_MISMATCH');
  });

  it('rejects a modified trusted verification config', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-baseline-tamper-'));
    await seedTrustedVerificationBaseline(root);
    await writeFile(path.join(root, 'vite.config.ts'), 'export default {};\n');
    await expect(assertTrustedCandidateVerificationBaselineV15(root))
      .rejects.toThrow('TRUSTED_CANDIDATE_VERIFICATION_BASELINE_MISMATCH');
  });

  it('blocks symlinked hidden-test parents before any trusted write', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-guard-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'origin-workspace-outside-'));
    await seedTrustedVerificationBaseline(root);
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
    await seedTrustedVerificationBaseline(root);

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
