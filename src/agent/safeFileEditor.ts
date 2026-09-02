import path from 'node:path';
import { readRepositoryFile } from './safeRepositoryReader.js';
import { writeRepositoryFileIfUnchanged } from './safeRepositoryWriter.js';
import { containsLikelySecret } from './safeFilePolicy.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHANGE_BYTES = 256 * 1024;

export type FileEditProposal = { path: string; content: string };
export type FileEditResult = { ok: true; path: string; previous: string; next: string };

function canonicalRelativePath(filePath: string): string {
  if (!filePath.trim() || path.posix.isAbsolute(filePath.replace(/\\/g, '/'))) {
    throw new Error('PATH_TRAVERSAL_BLOCKED');
  }
  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('PATH_TRAVERSAL_BLOCKED');
  return normalized;
}

export async function validateFileEdit(root: string, proposal: FileEditProposal): Promise<FileEditResult> {
  const relativePath = canonicalRelativePath(proposal.path);
  const previous = await readRepositoryFile(root, relativePath);
  const statBytes = Buffer.byteLength(previous, 'utf8');
  if (statBytes > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  const next = proposal.content;
  if (Buffer.byteLength(next, 'utf8') > MAX_CHANGE_BYTES) throw new Error('CHANGE_BUDGET_EXCEEDED');
  if (containsLikelySecret(next)) throw new Error('SECRET_CONTENT_BLOCKED');
  return { ok: true, path: relativePath, previous, next };
}

export async function applyValidatedFileEdit(root: string, edit: FileEditResult): Promise<void> {
  if (containsLikelySecret(edit.next)) throw new Error('SECRET_CONTENT_BLOCKED');
  if (Buffer.byteLength(edit.next, 'utf8') > MAX_CHANGE_BYTES) throw new Error('CHANGE_BUDGET_EXCEEDED');
  await writeRepositoryFileIfUnchanged(root, edit.path, edit.previous, edit.next);
}
