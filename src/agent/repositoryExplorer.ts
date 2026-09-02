import { listRepository as listSafeRepository, readRepositoryFile as readSafeRepositoryFile } from './safeRepositoryReader.js';

const MAX_BYTES = 2_000_000;

export type RepositoryEntry = {
  path: string;
  kind: 'file' | 'directory';
  size?: number;
};

/**
 * Compatibility facade for the historical repository explorer.
 * All filesystem traversal/read operations are delegated to the canonical
 * descriptor-stable reader so this module cannot reintroduce path-based TOCTOU.
 */
export async function exploreRepository(root: string): Promise<RepositoryEntry[]> {
  const entries = await listSafeRepository(root);
  return entries.map((entry) => ({
    path: entry.path,
    kind: entry.type,
  }));
}

export async function readRepositoryFile(root: string, relativePath: string): Promise<string> {
  const content = await readSafeRepositoryFile(root, relativePath);
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw new Error('File exceeds read size limit');
  return content;
}
