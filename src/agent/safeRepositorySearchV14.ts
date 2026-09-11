import path from 'node:path';
import { containsLikelySecret } from './safeFilePolicy.js';
import { readRepositoryFile } from './safeRepositoryReader.js';
import { sanitizePreEgress } from '../services/securitySanitizer.js';

const MAX_CANDIDATE_PATHS = 200;
const MAX_QUERIES = 6;
const MAX_QUERY_CHARS = 96;
const MAX_FILE_SEARCH_BYTES = 256 * 1024;
const MAX_SCANNED_BYTES = 8 * 1024 * 1024;
const MAX_HITS = 24;
const MAX_HITS_PER_FILE = 4;
const MAX_EXCERPT_CHARS = 1200;
const SECRET_QUERY = /(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|\.env)/i;
const LOCK_OR_GENERATED = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$|\.min\.[^/]+$/i;
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.graphql', '.gql', '.h', '.hpp', '.html',
  '.java', '.js', '.json', '.jsonc', '.jsx', '.kt', '.kts', '.md', '.mdx', '.mjs', '.cjs',
  '.php', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svelte', '.swift', '.toml', '.ts',
  '.tsx', '.vue', '.xml', '.yaml', '.yml',
]);
const TEXT_NAMES = new Set(['Dockerfile', 'Makefile']);

export type CodingSearchHitV14 = {
  path: string;
  line: number;
  query: string;
  excerpt: string;
};

export function normalizeCodingSearchQueriesV14(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_QUERIES) throw new Error('CODING_SEARCH_QUERY_BLOCKED');
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('CODING_SEARCH_QUERY_BLOCKED');
    const query = item.trim();
    if (query.length < 2 || query.length > MAX_QUERY_CHARS || /[\u0000-\u001f\u007f]/.test(query) || SECRET_QUERY.test(query)) {
      throw new Error('CODING_SEARCH_QUERY_BLOCKED');
    }
    const key = query.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new Error('CODING_SEARCH_QUERY_BLOCKED');
    seen.add(key);
    output.push(query);
  }
  return output;
}

function searchablePath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part.startsWith('.'))) return false;
  if (LOCK_OR_GENERATED.test(normalized)) return false;
  const base = path.posix.basename(normalized);
  return TEXT_NAMES.has(base) || TEXT_EXTENSIONS.has(path.posix.extname(base).toLowerCase());
}

function excerptFor(content: string, index: number): { line: number; excerpt: string } {
  const line = content.slice(0, index).split('\n').length;
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, line - 2);
  const end = Math.min(lines.length, line + 2);
  const numbered = lines.slice(start, end).map((text, offset) => `${start + offset + 1}: ${text}`).join('\n');
  return { line, excerpt: sanitizePreEgress(numbered).slice(0, MAX_EXCERPT_CHARS) };
}

/**
 * Literal, read-only repository search for the trusted coding worker.
 * Candidate paths must come from the bounded safe repository inventory. Search
 * output is aggressively bounded and sanitized before it can be sent to a model.
 */
export async function searchRepositoryV14(root: string, queriesInput: unknown, candidatePaths: readonly string[]): Promise<CodingSearchHitV14[]> {
  const queries = normalizeCodingSearchQueriesV14(queriesInput);
  if (!Array.isArray(candidatePaths) || candidatePaths.length > MAX_CANDIDATE_PATHS || candidatePaths.some(file => typeof file !== 'string')) {
    throw new Error('CODING_SEARCH_INVENTORY_BLOCKED');
  }
  if (new Set(candidatePaths).size !== candidatePaths.length) throw new Error('CODING_SEARCH_INVENTORY_BLOCKED');

  const candidates = candidatePaths.filter(searchablePath);
  const queryLower = queries.map(query => query.toLocaleLowerCase('en-US'));
  const hits: CodingSearchHitV14[] = [];
  const pool: CodingSearchHitV14[] = [];
  let scannedBytes = 0;

  for (const filePath of candidates) {
    if (scannedBytes >= MAX_SCANNED_BYTES) break;
    let content: string;
    try {
      content = await readRepositoryFile(root, filePath);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'FILE_TOO_LARGE' || code === 'PROTECTED_PATH' || code === 'SYMLINK_PATH_BLOCKED' || code === 'PATH_OUTSIDE_REPOSITORY') continue;
      throw error;
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    scannedBytes += bytes;
    if (bytes > MAX_FILE_SEARCH_BYTES || scannedBytes > MAX_SCANNED_BYTES || content.includes('\0') || containsLikelySecret(content)) continue;

    const lower = content.toLocaleLowerCase('en-US');
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      let from = 0;
      let queryHits = 0;
      const seenLines = new Set<number>();
      while (queryHits < MAX_HITS_PER_FILE) {
        const found = lower.indexOf(queryLower[queryIndex], from);
        if (found < 0) break;
        const snippet = excerptFor(content, found);
        if (!seenLines.has(snippet.line)) {
          seenLines.add(snippet.line);
          pool.push({ path: filePath, line: snippet.line, query: queries[queryIndex], excerpt: snippet.excerpt });
          queryHits += 1;
        }
        // One excerpt per line: skip repeated occurrences on a minified/long
        // line instead of rescanning and rebuilding the same excerpt thousands
        // of times.
        const nextLine = lower.indexOf('\n', found);
        if (nextLine < 0) break;
        from = nextLine + 1;
      }
    }
  }
  // Scan within the existing byte budget before allocating the output budget.
  // Prefer underrepresented files, then queries. A common early match must not
  // hide a later definition, caller or test. Pool <= 200 files * 6 queries * 4.
  const perFile = new Map<string, number>();
  const perQuery = new Map<string, number>();
  const selected = new Set<string>();
  while (hits.length < MAX_HITS) {
    let best: CodingSearchHitV14 | undefined;
    for (const candidate of pool) {
      const fileCount = perFile.get(candidate.path) ?? 0;
      if (fileCount >= MAX_HITS_PER_FILE || selected.has(`${candidate.path}:${candidate.line}`)) continue;
      if (!best || fileCount < (perFile.get(best.path) ?? 0) ||
        (fileCount === (perFile.get(best.path) ?? 0) && (perQuery.get(candidate.query) ?? 0) < (perQuery.get(best.query) ?? 0))) best = candidate;
    }
    if (!best) break;
    hits.push(best);
    selected.add(`${best.path}:${best.line}`);
    perFile.set(best.path, (perFile.get(best.path) ?? 0) + 1);
    perQuery.set(best.query, (perQuery.get(best.query) ?? 0) + 1);
  }
  return hits;
}
