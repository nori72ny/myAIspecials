import { promises as fs } from 'node:fs';
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

export async function listRepository(root: string): Promise<RepositoryEntry[]> {
  const entries: RepositoryEntry[] = [];
  const rootReal = await fs.realpath(root);
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;
    const currentStat = await fs.lstat(current);
    if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) return;
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      if (entries.length >= MAX_ENTRIES) return;
      if (child.isSymbolicLink()) continue;
      const absolute = path.join(current, child.name);
      const relative = path.relative(rootReal, absolute).replace(/\\/g, '/');
      if (blocked(relative)) continue;
      const type = child.isDirectory() ? 'directory' : 'file';
      entries.push({ path: relative, type });
      if (child.isDirectory()) await walk(absolute, depth + 1);
    }
  }
  await walk(rootReal, 0);
  return entries;
}

export async function readRepositoryFile(root: string, requestedPath: string): Promise<string> {
  const relative = requestedPath.replace(/\\/g, '/');
  if (!relative || path.posix.isAbsolute(relative)) throw new Error('PATH_OUTSIDE_REPOSITORY');
  if (blocked(relative)) throw new Error('PROTECTED_PATH');
  const rootReal = await fs.realpath(root);
  const absolute = safeRelative(rootReal, relative);
  await assertNoSymlinkComponents(rootReal, absolute);
  const handle = await fs.open(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('NOT_A_FILE');
    if (stat.size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}