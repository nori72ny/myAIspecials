import path from 'node:path';
import { readRepositoryFile } from './safeRepositoryReader.js';
import { writeRepositoryFile } from './safeRepositoryWriter.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHANGE_BYTES = 256 * 1024;
const PROTECTED = [
  '.git', '.env', 'node_modules', 'dist', 'build', 'coverage', '.next', '.vercel',
  '.pem', '.key', '.p12', '.pfx',
];

function resolveSafe(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('PATH_TRAVERSAL_BLOCKED');
  const normalized = relativePath.replace(/\\/g, '/');
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, normalized);
  if (target !== rootAbs && !target.startsWith(`${rootAbs}${path.sep}`)) throw new Error('PATH_TRAVERSAL_BLOCKED');
  const rel = path.relative(rootAbs, target);
  if (!rel || PROTECTED.some((part) => part === rel || rel.split(path.sep).includes(part) || rel.endsWith(part))) {
    throw new Error('PROTECTED_PATH');
  }
  return target;
}

export type FileEditProposal = { path: string; content: string };
export type FileEditResult = { ok: true; path: string; previous: string; next: string };

export async function validateFileEdit(root: string, proposal: FileEditProposal): Promise<FileEditResult> {
  if (!proposal.path.trim()) throw new Error('FILE_PATH_REQUIRED');
  const rootReal = await import('node:fs/promises').then(({ realpath }) => realpath(root));
  const target = resolveSafe(rootReal, proposal.path);
  const previous = await readRepositoryFile(rootReal, proposal.path);
  const statBytes = Buffer.byteLength(previous, 'utf8');
  if (statBytes > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  const next = proposal.content;
  if (Buffer.byteLength(next, 'utf8') > MAX_CHANGE_BYTES) throw new Error('CHANGE_BUDGET_EXCEEDED');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|password|secret|token)\s*[:=]/i.test(next)) {
    throw new Error('SECRET_CONTENT_BLOCKED');
  }
  return { ok: true, path: path.relative(rootReal, target), previous, next };
}

export async function applyValidatedFileEdit(root: string, edit: FileEditResult): Promise<void> {
  const current = await readRepositoryFile(root, edit.path);
  if (current !== edit.previous) throw new Error('FILE_CHANGED_SINCE_VALIDATION');
  if (Buffer.byteLength(edit.next, 'utf8') > MAX_CHANGE_BYTES) throw new Error('CHANGE_BUDGET_EXCEEDED');
  await writeRepositoryFile(root, edit.path, edit.next);
}