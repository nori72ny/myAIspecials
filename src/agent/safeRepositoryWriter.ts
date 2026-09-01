import path from 'node:path';
import { promises as fs } from 'node:fs';

const MAX_WRITE_BYTES = 128 * 1024;
const PROTECTED = [
  '.git', 'node_modules', 'dist', 'build', '.next',
  '.env', '.env.local', '.env.production', '.env.development',
];
const SECRET_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx'];

export type SafeWriteResult = { ok: true; path: string; bytes: number };

function isProtected(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const base = parts.at(-1) ?? '';
  return parts.some((part) => PROTECTED.includes(part)) || PROTECTED.includes(base) || SECRET_EXTENSIONS.some((ext) => base.endsWith(ext));
}

export async function safeWriteRepositoryFile(relativePath: string, content: string, rootDir = process.cwd()): Promise<SafeWriteResult> {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('INVALID_REPOSITORY_PATH');
  if (typeof content !== 'string') throw new Error('INVALID_FILE_CONTENT');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) throw new Error('WRITE_SIZE_LIMIT_EXCEEDED');
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || isProtected(normalized)) throw new Error('PROTECTED_REPOSITORY_PATH');

  const root = path.resolve(rootDir);
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('REPOSITORY_BOUNDARY_VIOLATION');

  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const temp = path.join(parent, `.${path.basename(target)}.origin-tmp-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
  return { ok: true, path: normalized.replaceAll('\\', '/'), bytes };
}
