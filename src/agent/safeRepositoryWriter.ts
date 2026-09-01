import { promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_WRITE_BYTES = 128 * 1024;
const PROTECTED_SEGMENTS = new Set(['.git', 'node_modules', 'dist', 'build', '.next']);
const PROTECTED_FILES = new Set(['.env', '.env.local', '.env.production', '.env.development']);
const PROTECTED_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);

function assertSafeRelativePath(filePath: string): void {
  if (!filePath || path.isAbsolute(filePath)) throw new Error('UNSAFE_PATH');
  const normalized = path.posix.normalize(filePath.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error('PATH_TRAVERSAL_BLOCKED');
  const segments = normalized.split('/');
  if (segments.some((segment) => PROTECTED_SEGMENTS.has(segment))) throw new Error('PROTECTED_PATH_BLOCKED');
  const basename = segments.at(-1) ?? '';
  if (PROTECTED_FILES.has(basename) || PROTECTED_EXTENSIONS.has(path.extname(basename).toLowerCase())) throw new Error('SECRET_PATH_BLOCKED');
}

export async function writeRepositoryFile(root: string, filePath: string, content: string): Promise<{ bytes: number; path: string }> {
  assertSafeRelativePath(filePath);
  const rootReal = await fs.realpath(root);
  const target = path.resolve(rootReal, filePath);
  const parent = path.dirname(target);
  const parentReal = await fs.realpath(parent).catch(() => parent);
  const relative = path.relative(rootReal, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('REPOSITORY_BOUNDARY_BLOCKED');
  if (path.relative(rootReal, parentReal).startsWith('..')) throw new Error('REPOSITORY_BOUNDARY_BLOCKED');

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) throw new Error('WRITE_SIZE_LIMIT_EXCEEDED');

  await fs.mkdir(parentReal, { recursive: true });
  const temp = path.join(parentReal, `.${path.basename(target)}.origin-tmp-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
  return { bytes, path: relative };
}
