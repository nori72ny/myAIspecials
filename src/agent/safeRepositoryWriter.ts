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

export async function writeRepositoryFile(root: string, filePath: string, content: string): Promise<{ bytes: number; path: string }> {
  assertSafeRelativePath(filePath);
  const rootReal = await fs.realpath(root);
  const target = path.resolve(rootReal, filePath);
  const parent = path.dirname(target);
  const relative = path.relative(rootReal, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('REPOSITORY_BOUNDARY_BLOCKED');

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) throw new Error('WRITE_SIZE_LIMIT_EXCEEDED');

  // Create only within a path whose existing components are known not to be symlinks.
  await assertNoSymlinkComponents(rootReal, parent);
  await fs.mkdir(parent, { recursive: true });
  // Re-check immediately before the write/rename boundary. This closes the deterministic
  // intermediate-symlink escape class, but portable Node fs APIs do not provide dirfd-relative
  // renameat semantics, so this is not claimed to be an adversarial race-proof primitive.
  await assertNoSymlinkComponents(rootReal, parent);

  const temp = path.join(parent, `.${path.basename(target)}.origin-tmp-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
    await assertNoSymlinkComponents(rootReal, parent);
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
  return { bytes, path: relative };
}
