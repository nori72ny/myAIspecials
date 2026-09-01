import path from 'node:path';
import fs from 'node:fs/promises';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHANGE_BYTES = 256 * 1024;
const PROTECTED = [
  '.git', '.env', 'node_modules', 'dist', 'build', 'coverage', '.next', '.vercel',
  '.pem', '.key', '.p12', '.pfx',
];

function resolveSafe(root: string, relativePath: string): string {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, relativePath);
  if (target !== rootAbs && !target.startsWith(`${rootAbs}${path.sep}`)) throw new Error('PATH_TRAVERSAL_BLOCKED');
  const rel = path.relative(rootAbs, target);
  if (PROTECTED.some((part) => part === rel || rel.split(path.sep).includes(part) || rel.endsWith(part))) throw new Error('PROTECTED_PATH');
  return target;
}

export type FileEditProposal = { path: string; content: string };
export type FileEditResult = { ok: true; path: string; previous: string; next: string };

export async function validateFileEdit(root: string, proposal: FileEditProposal): Promise<FileEditResult> {
  if (!proposal.path.trim()) throw new Error('FILE_PATH_REQUIRED');
  const target = resolveSafe(root, proposal.path);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error('NOT_A_FILE');
  if (stat.size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  const previous = await fs.readFile(target, 'utf8');
  const next = proposal.content;
  const changeBytes = Buffer.byteLength(next, 'utf8');
  if (changeBytes > MAX_CHANGE_BYTES) throw new Error('CHANGE_BUDGET_EXCEEDED');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|api[_-]?key\s*[:=]|password\s*[:=]/i.test(next)) throw new Error('SECRET_CONTENT_BLOCKED');
  return { ok: true, path: proposal.path, previous, next };
}

export async function applyValidatedFileEdit(root: string, edit: FileEditResult): Promise<void> {
  const target = resolveSafe(root, edit.path);
  const current = await fs.readFile(target, 'utf8');
  if (current !== edit.previous) throw new Error('FILE_CHANGED_SINCE_VALIDATION');
  await fs.writeFile(target, edit.next, 'utf8');
}
