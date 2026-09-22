import { promises as fs } from 'node:fs';
import path from 'node:path';

function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..')
    && !value.includes('\0');
}

export function assertTrustedCandidateDiffScopeV15(input: {
  actualPaths: readonly string[];
  reportedPaths: readonly string[];
  requiredPaths: readonly string[];
}): void {
  const normalize = (values: readonly string[]) => {
    if (!Array.isArray(values) || values.some(value => !safeRelativePath(value))) {
      throw new Error('TRUSTED_CANDIDATE_DIFF_SCOPE_INVALID');
    }
    return [...new Set(values)].sort();
  };
  const actual = normalize(input.actualPaths);
  const reported = normalize(input.reportedPaths);
  const required = new Set(normalize(input.requiredPaths));

  if (JSON.stringify(actual) !== JSON.stringify(reported)) {
    throw new Error('TRUSTED_CANDIDATE_DIFF_REPORT_MISMATCH');
  }
  if (actual.some(file => !required.has(file))) {
    throw new Error('TRUSTED_CANDIDATE_UNAUTHORIZED_DIFF');
  }
}

export async function assertTrustedCandidatePathNoSymlinksV15(
  root: string,
  relativePath: string,
  options: { leafMayBeMissing?: boolean } = {},
): Promise<void> {
  if (!safeRelativePath(relativePath)) throw new Error('TRUSTED_CANDIDATE_PATH_INVALID');
  const resolvedRoot = await fs.realpath(root);
  const segments = relativePath.split('/');
  let current = resolvedRoot;

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('TRUSTED_CANDIDATE_SYMLINK_BLOCKED');
      if (index < segments.length - 1 && !stat.isDirectory()) {
        throw new Error('TRUSTED_CANDIDATE_PATH_INVALID');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (index === segments.length - 1 && options.leafMayBeMissing === true) return;
        // Missing parent directories are allowed only for a hidden-test path;
        // callers create them after every existing ancestor has been checked.
        if (options.leafMayBeMissing === true) return;
      }
      throw error;
    }
  }
}

export async function writeTrustedCandidateHiddenTestV15(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  if (!relativePath.startsWith('tests/__origin_heldout__/') || !safeRelativePath(relativePath)) {
    throw new Error('TRUSTED_CANDIDATE_HIDDEN_PATH_INVALID');
  }
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 256 * 1024) {
    throw new Error('TRUSTED_CANDIDATE_HIDDEN_CONTENT_INVALID');
  }

  const resolvedRoot = await fs.realpath(root);
  const target = path.join(resolvedRoot, relativePath);
  const parentRelative = path.dirname(relativePath);
  await assertTrustedCandidatePathNoSymlinksV15(resolvedRoot, parentRelative, { leafMayBeMissing: true });

  // Build the parent one segment at a time. Existing components are checked
  // with lstat before descent so a candidate-created symlink cannot redirect
  // the trusted hidden-test write outside the worktree.
  let current = resolvedRoot;
  for (const segment of parentRelative.split('/')) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('TRUSTED_CANDIDATE_SYMLINK_BLOCKED');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.mkdir(current);
    }
  }

  await assertTrustedCandidatePathNoSymlinksV15(resolvedRoot, relativePath, { leafMayBeMissing: true });
  await fs.writeFile(target, content, { flag: 'wx', mode: 0o600 });
  const finalStat = await fs.lstat(target);
  if (!finalStat.isFile() || finalStat.isSymbolicLink()) throw new Error('TRUSTED_CANDIDATE_HIDDEN_WRITE_INVALID');
}
