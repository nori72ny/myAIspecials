import path from 'node:path';
import { readRepositoryFile } from './safeRepositoryReader.js';
import { writeRepositoryFileIfUnchanged } from './safeRepositoryWriter.js';
import { containsLikelySecret } from './safeFilePolicy.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHANGE_BYTES = 256 * 1024;

export type DeltaEditProposal = {
  path: string;
  search: string;
  replacement: string;
};

export type DeltaEditResult = {
  ok: true;
  path: string;
  previous: string;
  next: string;
  matchedOccurrences: 1;
};

function canonicalRelativePath(filePath: string): string {
  if (!filePath.trim() || path.posix.isAbsolute(filePath.replaceAll('\\', '/'))) {
    throw new Error('PATH_TRAVERSAL_BLOCKED');
  }
  const normalized = path.posix.normalize(filePath.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('PATH_TRAVERSAL_BLOCKED');
  return normalized;
}

function countExactOccurrences(source: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
    if (count > 1) return count;
  }
}

/**
 * Proposes a deterministic, exact-one-match edit. The model never supplies a
 * new whole-file snapshot as the mutation primitive, which sharply reduces
 * accidental overwrites and makes the intended change auditable.
 */
export async function validateDeltaEdit(root: string, proposal: DeltaEditProposal): Promise<DeltaEditResult> {
  const relativePath = canonicalRelativePath(proposal.path);
  if (!proposal.search) throw new Error('EDIT_SEARCH_REQUIRED');
  if (containsLikelySecret(proposal.replacement)) throw new Error('SECRET_CONTENT_BLOCKED');

  const previous = await readRepositoryFile(root, relativePath);
  if (Buffer.byteLength(previous, 'utf8') > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');

  const matches = countExactOccurrences(previous, proposal.search);
  if (matches === 0) throw new Error('EDIT_TARGET_NOT_FOUND');
  if (matches !== 1) throw new Error('EDIT_MATCH_NOT_UNIQUE');

  const next = previous.replace(proposal.search, proposal.replacement);
  if (Buffer.byteLength(next, 'utf8') > MAX_CHANGE_BYTES) throw new Error('CHANGE_BUDGET_EXCEEDED');
  return { ok: true, path: relativePath, previous, next, matchedOccurrences: 1 };
}

/** Applies only a previously validated exact-one-match edit and rechecks the expected snapshot. */
export async function applyDeltaEdit(root: string, edit: DeltaEditResult): Promise<void> {
  if (edit.matchedOccurrences !== 1) throw new Error('EDIT_VALIDATION_REQUIRED');
  if (containsLikelySecret(edit.next)) throw new Error('SECRET_CONTENT_BLOCKED');
  if (Buffer.byteLength(edit.next, 'utf8') > MAX_CHANGE_BYTES) throw new Error('CHANGE_BUDGET_EXCEEDED');
  await writeRepositoryFileIfUnchanged(root, edit.path, edit.previous, edit.next);
}
