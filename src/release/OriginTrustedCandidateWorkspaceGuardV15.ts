import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TRUSTED_VERIFICATION_BASELINE_V15 = new Map<string, string>([
  ['package-lock.json', '6ffbdaf5d08d45f3632432fec27324d840c6dce5'],
  ['vite.config.ts', 'fa396109dd321106533a27070567fb77f30b6e90'],
  ['tsconfig.json', '166577ad1b6c79a81519689f71b0769e7f465ff3'],
  ['scripts/design-token-lock.js', 'a47fc4b878f84bf3b0bf303e6bf7ea5093e27803'],
]);
const TRUSTED_ROOT_AUTO_CONFIGS_V15 = ['vite.config.ts'] as const;

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 240) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const segments = value.split('/');
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

function gitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(content).digest('hex');
}

async function assertRegularSingleLinkFile(root: string, relativePath: string, code: string): Promise<string> {
  const target = path.join(root, relativePath);
  let stat;
  try { stat = await fs.lstat(target); }
  catch { throw new Error(code); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(code);
  return target;
}

export async function assertTrustedCandidateVerificationBaselineV15(root: string): Promise<void> {
  const resolvedRoot = await fs.realpath(root);
  for (const [relativePath, expectedSha] of TRUSTED_VERIFICATION_BASELINE_V15) {
    const target = await assertRegularSingleLinkFile(
      resolvedRoot,
      relativePath,
      'TRUSTED_CANDIDATE_VERIFICATION_BASELINE_MISMATCH',
    );
    const content = await fs.readFile(target);
    if (gitBlobSha(content) !== expectedSha) {
      throw new Error('TRUSTED_CANDIDATE_VERIFICATION_BASELINE_MISMATCH');
    }
  }

  const rootEntries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  const autoConfigs = rootEntries
    .filter(entry => /^(?:(?:vite|vitest)\.config\.[A-Za-z0-9]+|vitest\.workspace\.[A-Za-z0-9]+|\.env(?:\..+)?)$/.test(entry.name))
    .map(entry => entry.name)
    .sort();
  if (JSON.stringify(autoConfigs) !== JSON.stringify([...TRUSTED_ROOT_AUTO_CONFIGS_V15].sort())) {
    throw new Error('TRUSTED_CANDIDATE_VERIFICATION_CONFIG_SET_MISMATCH');
  }
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
      if (index === segments.length - 1) {
        if (!stat.isFile()) throw new Error('TRUSTED_CANDIDATE_SPECIAL_FILE_BLOCKED');
        if (stat.nlink !== 1) throw new Error('TRUSTED_CANDIDATE_HARDLINK_BLOCKED');
      } else if (!stat.isDirectory()) {
        throw new Error('TRUSTED_CANDIDATE_PATH_INVALID');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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

  await assertTrustedCandidateVerificationBaselineV15(root);
  const resolvedRoot = await fs.realpath(root);
  const target = path.join(resolvedRoot, relativePath);
  const parentRelative = path.dirname(relativePath);

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
  if (!finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.nlink !== 1) {
    throw new Error('TRUSTED_CANDIDATE_HIDDEN_WRITE_INVALID');
  }
}
