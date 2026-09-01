import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_DEPTH = 8;
const MAX_ENTRIES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BLOCKED_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.vercel']);
const SECRET_NAME = /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx))$/i;

export type RepositoryEntry = { path: string; type: 'file' | 'directory' };

function safeRelative(root: string, requested: string): string {
  const relative = requested.replace(/\\/g, '/').replace(/^\/+/, '');
  const absolute = path.resolve(root, relative);
  const rootResolved = path.resolve(root);
  const relativeToRoot = path.relative(rootResolved, absolute);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) throw new Error('PATH_OUTSIDE_REPOSITORY');
  return absolute;
}

function blocked(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (SECRET_NAME.test(normalized)) return true;
  return normalized.split('/').some((part) => BLOCKED_NAMES.has(part));
}

export async function listRepository(root: string): Promise<RepositoryEntry[]> {
  const entries: RepositoryEntry[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      if (entries.length >= MAX_ENTRIES) return;
      const absolute = path.join(current, child.name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (blocked(relative)) continue;
      const type = child.isDirectory() ? 'directory' : 'file';
      entries.push({ path: relative, type });
      if (child.isDirectory()) await walk(absolute, depth + 1);
    }
  }
  await walk(path.resolve(root), 0);
  return entries;
}

export async function readRepositoryFile(root: string, requestedPath: string): Promise<string> {
  const relative = requestedPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (blocked(relative)) throw new Error('PROTECTED_PATH');
  const absolute = safeRelative(root, relative);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error('NOT_A_FILE');
  if (stat.size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  return fs.readFile(absolute, 'utf8');
}
