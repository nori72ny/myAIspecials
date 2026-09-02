import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const MAX_FILES = 200;
const MAX_DEPTH = 8;
const MAX_BYTES = 2_000_000;
const SECRET_NAME = /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx))$/i;

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

function isProtected(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SECRET_NAME.test(normalized) || normalized.split('/').some((segment) => DEFAULT_IGNORED.has(segment));
}

export async function exploreRepository(root: string): Promise<RepositoryEntry[]> {
  const resolvedRoot = await fs.realpath(root);
  const result: RepositoryEntry[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || result.length >= MAX_FILES) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    const safeEntries = entries.filter((entry) => !DEFAULT_IGNORED.has(entry.name) && !entry.isSymbolicLink());

    // Visit files before directories so important root metadata such as package.json
    // is not starved by a bounded directory walk.
    for (const entry of safeEntries.filter((candidate) => candidate.isFile())) {
      if (result.length >= MAX_FILES) return;
      const absolute = path.join(current, entry.name);
      const relative = safeRelative(resolvedRoot, absolute);
      if (!relative || isProtected(relative)) continue;
      result.push({ path: relative, kind: 'file' });
    }

    for (const entry of safeEntries.filter((candidate) => candidate.isDirectory())) {
      if (result.length >= MAX_FILES) return;
      const absolute = path.join(current, entry.name);
      const relative = safeRelative(resolvedRoot, absolute);
      if (!relative || isProtected(relative)) continue;
      result.push({ path: relative, kind: 'directory' });
      await walk(absolute, depth + 1);
    }
  }

  await walk(resolvedRoot, 0);
  return result;
}

export async function readRepositoryFile(root: string, relativePath: string): Promise<string> {
  const resolvedRoot = await fs.realpath(root);
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (isProtected(normalized)) throw new Error('Protected repository path');
  const candidate = path.resolve(resolvedRoot, normalized);
  if (!safeRelative(resolvedRoot, candidate)) throw new Error('Path escapes repository root');

  const relative = path.relative(resolvedRoot, candidate);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const handle = await fs.open(current, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (current !== candidate && !stat.isDirectory()) throw new Error('Path component is not a directory');
      if (current === candidate) {
        if (!stat.isFile()) throw new Error('Target is not a file');
        if (stat.size > MAX_BYTES) throw new Error('File exceeds read size limit');
        return await handle.readFile({ encoding: 'utf8' });
      }
    } finally {
      await handle.close();
    }
  }
  throw new Error('Target path is empty');
}