import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_WRITE_BYTES = 128 * 1024;
const PROTECTED_SEGMENTS = new Set(['.git', 'node_modules', 'dist', 'build', '.next']);
const PROTECTED_FILES = new Set(['.env', '.env.local', '.env.production', '.env.development']);
const PROTECTED_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);

function assertSafeRelativePath(filePath: string): void {
  if (!filePath || path.isAbsolute(filePath)) throw new Error('UNSAFE_PATH');
  const normalized = path.posix.normalize(filePath.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error('PATH_TRAVERSAL_BLOCKED');
  const segments = normalized.split('/');
  if (segments.some((segment) => PROTECTED_SEGMENTS.has(segment))) throw new Error('PROTECTED_PATH_BLOCKED');
  const basename = segments.at(-1) ?? '';
  if (PROTECTED_FILES.has(basename) || PROTECTED_EXTENSIONS.has(path.extname(basename).toLowerCase())) throw new Error('SECRET_PATH_BLOCKED');
}

async function assertNoSymlinkComponents(rootReal: string, target: string): Promise<void> {
  const relative = path.relative(rootReal, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('REPOSITORY_BOUNDARY_BLOCKED');
  let current = rootReal;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('SYMLINK_PATH_BLOCKED');
    } catch (error) {
      if (error instanceof Error && error.message === 'SYMLINK_PATH_BLOCKED') throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

/**
 * Open the final parent directory and keep that descriptor alive through the
 * temp-file write and rename. On Linux, /proc/self/fd/<fd> resolves to the
 * already-open directory, so replacing the path name after this point cannot
 * redirect the write/rename into an attacker-controlled directory.
 *
 * The production Agent runtime is Linux (Vercel). We fail closed elsewhere
 * rather than silently falling back to a path-based TOCTOU primitive.
 */
async function openStableParent(parent: string) {
  if (process.platform !== 'linux') throw new Error('RACE_SAFE_WRITE_UNSUPPORTED');
  return fs.open(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
}

export async function writeRepositoryFile(root: string, filePath: string, content: string): Promise<{ bytes: number; path: string }> {
  assertSafeRelativePath(filePath);
  const rootReal = await fs.realpath(root);
  const target = path.resolve(rootReal, filePath);
  const parent = path.dirname(target);
  const relative = path.relative(rootReal, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('REPOSITORY_BOUNDARY_BLOCKED');

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) throw new Error('WRITE_SIZE_LIMIT_EXCEEDED');

  await assertNoSymlinkComponents(rootReal, parent);
  await fs.mkdir(parent, { recursive: true });
  await assertNoSymlinkComponents(rootReal, parent);

  const parentHandle = await openStableParent(parent);
  try {
    const stableParent = `/proc/self/fd/${parentHandle.fd}`;
    const tempName = `.${path.basename(target)}.origin-tmp-${process.pid}-${Date.now()}`;
    const temp = path.join(stableParent, tempName);
    const stableTarget = path.join(stableParent, path.basename(target));

    try {
      await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temp, stableTarget);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  } finally {
    await parentHandle.close();
  }

  return { bytes, path: relative };
}
