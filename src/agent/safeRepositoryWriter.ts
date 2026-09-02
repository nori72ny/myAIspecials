import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { containsLikelySecret } from './safeFilePolicy.js';

const MAX_WRITE_BYTES = 256 * 1024;
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

async function openStableParent(rootReal: string, parent: string) {
  if (process.platform !== 'linux') throw new Error('RACE_SAFE_WRITE_UNSUPPORTED');
  const relativeParent = path.relative(rootReal, parent);
  if (!relativeParent || relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) throw new Error('REPOSITORY_BOUNDARY_BLOCKED');
  let currentHandle = await fs.open(rootReal, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
      const childPath = path.join(`/proc/self/fd/${currentHandle.fd}`, segment);
      try { await fs.mkdir(childPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const nextHandle = await fs.open(childPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      await currentHandle.close();
      currentHandle = nextHandle;
    }
    return currentHandle;
  } catch (error) {
    await currentHandle.close().catch(() => undefined);
    throw error;
  }
}

async function writeThroughStableParent(rootReal: string, target: string, content: string, expectedPrevious?: string): Promise<void> {
  const parent = path.dirname(target);
  const parentHandle = await openStableParent(rootReal, parent);
  try {
    const stableParent = `/proc/self/fd/${parentHandle.fd}`;
    const stableTarget = path.join(stableParent, path.basename(target));
    if (expectedPrevious !== undefined) {
      let targetHandle;
      try {
        targetHandle = await fs.open(stableTarget, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const current = await targetHandle.readFile({ encoding: 'utf8' });
        if (current !== expectedPrevious) throw new Error('FILE_CHANGED_SINCE_VALIDATION');
      } catch (error) {
        if (error instanceof Error && error.message === 'FILE_CHANGED_SINCE_VALIDATION') throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { if (expectedPrevious !== '') throw new Error('FILE_CHANGED_SINCE_VALIDATION'); }
        else if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new Error('SYMLINK_PATH_BLOCKED');
        else throw error;
      } finally { await targetHandle?.close().catch(() => undefined); }
    }
    const tempName = `.${path.basename(target)}.origin-tmp-${process.pid}-${Date.now()}`;
    const temp = path.join(stableParent, tempName);
    try {
      await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temp, stableTarget);
    } finally { await fs.rm(temp, { force: true }).catch(() => undefined); }
  } finally { await parentHandle.close(); }
}

async function prepareWrite(root: string, filePath: string, content: string): Promise<{ rootReal: string; target: string; relative: string; bytes: number }> {
  assertSafeRelativePath(filePath);
  if (containsLikelySecret(content)) throw new Error('SECRET_CONTENT_BLOCKED');
  const rootReal = await fs.realpath(root);
  const target = path.resolve(rootReal, filePath);
  const relative = path.relative(rootReal, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('REPOSITORY_BOUNDARY_BLOCKED');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) throw new Error('WRITE_SIZE_LIMIT_EXCEEDED');
  await assertNoSymlinkComponents(rootReal, path.dirname(target));
  return { rootReal, target, relative, bytes };
}

export async function writeRepositoryFile(root: string, filePath: string, content: string): Promise<{ bytes: number; path: string }> {
  const prepared = await prepareWrite(root, filePath, content);
  await writeThroughStableParent(prepared.rootReal, prepared.target, content);
  return { bytes: prepared.bytes, path: prepared.relative };
}

export async function writeRepositoryFileIfUnchanged(root: string, filePath: string, expectedPrevious: string, content: string): Promise<{ bytes: number; path: string }> {
  const prepared = await prepareWrite(root, filePath, content);
  await writeThroughStableParent(prepared.rootReal, prepared.target, content, expectedPrevious);
  return { bytes: prepared.bytes, path: prepared.relative };
}
