import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_DEPTH = 8;
const MAX_ENTRIES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BLOCKED_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.vercel']);
const SECRET_NAME = /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx))$/i;

export type RepositoryEntry = { path: string; type: 'file' | 'directory' };

function safeRelative(root: string, requested: string): string {
  if (!requested || path.isAbsolute(requested)) throw new Error('PATH_OUTSIDE_REPOSITORY');
  const relative = requested.replace(/\\/g, '/');
  const absolute = path.resolve(root, relative);
  const rootResolved = path.resolve(root);
  const relativeToRoot = path.relative(rootResolved, absolute);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) throw new Error('PATH_OUTSIDE_REPOSITORY');
  return absolute;
}

async function assertNoSymlinkComponents(rootReal: string, target: string): Promise<void> {
  const relative = path.relative(rootReal, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('PATH_OUTSIDE_REPOSITORY');
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

function blocked(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (SECRET_NAME.test(normalized)) return true;
  return normalized.split('/').some((part) => BLOCKED_NAMES.has(part));
}

async function openStableDirectory(rootReal: string, relativePath: string) {
  if (process.platform !== 'linux') throw new Error('RACE_SAFE_READ_UNSUPPORTED');
  let directoryHandle = await fs.open(rootReal, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    for (const segment of relativePath.split(path.sep).filter(Boolean)) {
      const childPath = path.join(`/proc/self/fd/${directoryHandle.fd}`, segment);
      const nextHandle = await fs.open(childPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      try {
        await directoryHandle.close();
        directoryHandle = nextHandle;
      } catch (error) {
        await nextHandle.close().catch(() => undefined);
        throw error;
      }
    }
    return directoryHandle;
  } catch (error) {
    await directoryHandle.close().catch(() => undefined);
    throw error;
  }
}

async function openStableFile(rootReal: string, absolute: string) {
  if (process.platform !== 'linux') throw new Error('RACE_SAFE_READ_UNSUPPORTED');
  const relative = path.relative(rootReal, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('PATH_OUTSIDE_REPOSITORY');
  const segments = relative.split(path.sep).filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) throw new Error('NOT_A_FILE');

  let directoryHandle = await fs.open(rootReal, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    for (const segment of segments) {
      const childPath = path.join(`/proc/self/fd/${directoryHandle.fd}`, segment);
      const nextHandle = await fs.open(childPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      try {
        await directoryHandle.close();
        directoryHandle = nextHandle;
      } catch (error) {
        await nextHandle.close().catch(() => undefined);
        throw error;
      }
    }
    const stableFile = path.join(`/proc/self/fd/${directoryHandle.fd}`, fileName);
    const fileHandle = await fs.open(stableFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      await directoryHandle.close();
      return fileHandle;
    } catch (error) {
      await fileHandle.close().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await directoryHandle.close().catch(() => undefined);
    throw error;
  }
}

export async function listRepository(root: string): Promise<RepositoryEntry[]> {
  if (process.platform !== 'linux') throw new Error('RACE_SAFE_READ_UNSUPPORTED');
  const entries: RepositoryEntry[] = [];
  const rootReal = await fs.realpath(root);

  async function walk(directoryHandle: Awaited<ReturnType<typeof fs.open>>, relativeDirectory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;
    const stableDirectory = `/proc/self/fd/${directoryHandle.fd}`;
    const children = await fs.readdir(stableDirectory, { withFileTypes: true });

    for (const child of children) {
      if (entries.length >= MAX_ENTRIES) return;
      if (child.isSymbolicLink()) continue;

      const relative = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      if (blocked(relative)) continue;
      const isDirectory = child.isDirectory();
      entries.push({ path: relative, type: isDirectory ? 'directory' : 'file' });
      if (!isDirectory || depth >= MAX_DEPTH) continue;

      const childPath = path.join(stableDirectory, child.name);
      let childHandle;
      try {
        childHandle = await fs.open(childPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') continue;
        throw error;
      }
      try {
        await walk(childHandle, relative, depth + 1);
      } finally {
        await childHandle.close();
      }
    }
  }

  const rootHandle = await openStableDirectory(rootReal, '');
  try {
    await walk(rootHandle, '', 0);
  } finally {
    await rootHandle.close();
  }
  return entries;
}

export async function readRepositoryFile(root: string, requestedPath: string): Promise<string> {
  const relative = requestedPath.replace(/\\/g, '/');
  if (!relative || path.posix.isAbsolute(relative)) throw new Error('PATH_OUTSIDE_REPOSITORY');
  if (blocked(relative)) throw new Error('PROTECTED_PATH');
  const rootReal = await fs.realpath(root);
  const absolute = safeRelative(rootReal, relative);
  await assertNoSymlinkComponents(rootReal, absolute);
  const handle = await openStableFile(rootReal, absolute);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('NOT_A_FILE');
    if (stat.size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}
