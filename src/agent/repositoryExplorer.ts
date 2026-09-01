import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const MAX_FILES = 200;
const MAX_DEPTH = 8;
const MAX_BYTES = 2_000_000;

export type RepositoryEntry = {
  path: string;
  kind: 'file' | 'directory';
  size?: number;
};

function safeRelative(root: string, candidate: string): string | undefined {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return relative;
}

export async function exploreRepository(root: string): Promise<RepositoryEntry[]> {
  const resolvedRoot = path.resolve(root);
  const result: RepositoryEntry[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || result.length >= MAX_FILES) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (result.length >= MAX_FILES || DEFAULT_IGNORED.has(entry.name)) break;
      const absolute = path.join(current, entry.name);
      const relative = safeRelative(resolvedRoot, absolute);
      if (!relative) continue;
      if (entry.isDirectory()) {
        result.push({ path: relative, kind: 'directory' });
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        const stat = await fs.stat(absolute);
        result.push({ path: relative, kind: 'file', size: stat.size });
      }
    }
  }

  await walk(resolvedRoot, 0);
  return result;
}

export async function readRepositoryFile(root: string, relativePath: string): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (!safeRelative(resolvedRoot, candidate)) throw new Error('Path escapes repository root');
  const stat = await fs.stat(candidate);
  if (!stat.isFile()) throw new Error('Target is not a file');
  if (stat.size > MAX_BYTES) throw new Error('File exceeds read size limit');
  return fs.readFile(candidate, 'utf8');
}
