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

async function assertNoSymlinkComponents(rootReal: string, target: string): Promise<void> {
  const relative = path.relative(rootReal, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('REPOSITORY_BOUNDARY_BLOCKED');
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

export type FileEditProposal = { path: string; content: string };
export type FileEditResult = { ok: true; path: string; previous: string; next: string };

async function openTarget(root: string, target: string, flags: number) {
  const rootReal = await fs.realpath(root);
  await assertNoSymlinkComponents(rootReal, target);
  return fs.open(target, flags | fs.constants.O_NOFOLLOW);
}

export async function validateFileEdit(root: string, proposal: FileEditProposal): Promise<FileEditResult> {
  if (!proposal.path.trim()) throw new Error('FILE_PATH_REQUIRED');
  const rootReal = await fs.realpath(root);
  const target = resolveSafe(rootReal, proposal.path);
  const handle = await openTarget(rootReal, target, fs.constants.O_RDONLY);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('NOT_A_FILE');
    if (stat.size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    const previous = await handle.readFile({ encoding: 'utf8' });
    const next = proposal.content;
    if (Buffer.byteLength(next, 'utf8') > MAX_CHANGE_BYTES) throw new Error('CHANGE_BUDGET_EXCEEDED');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|api[_-]?key\s*[:=]|password\s*[:=]/i.test(next)) throw new Error('SECRET_CONTENT_BLOCKED');
    return { ok: true, path: proposal.path, previous, next };
  } finally {
    await handle.close();
  }
}

export async function applyValidatedFileEdit(root: string, edit: FileEditResult): Promise<void> {
  const rootReal = await fs.realpath(root);
  const target = resolveSafe(rootReal, edit.path);
  const handle = await openTarget(rootReal, target, fs.constants.O_RDWR);
  try {
    const current = await handle.readFile({ encoding: 'utf8' });
    if (current !== edit.previous) throw new Error('FILE_CHANGED_SINCE_VALIDATION');
    await handle.truncate(0);
    await handle.write(edit.next, 0, 'utf8');
  } finally {
    await handle.close();
  }
}