import path from 'node:path';

const BLOCKED_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const MUTATION_PROTECTED_ROOT_FILES = new Set(['package.json', 'package-lock.json', 'server.ts', 'vercel.json']);
const SECRET_EXTENSIONS = /\.(?:pem|key|p12|pfx)$/i;

function normalizeBase(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 180 || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) {
    throw new Error('CODING_PATH_BLOCKED');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || BLOCKED_SEGMENTS.has(part))) {
    throw new Error('CODING_PATH_BLOCKED');
  }
  if (SECRET_EXTENSIONS.test(value)) throw new Error('CODING_PATH_BLOCKED');
  return value;
}

/** Read-only coding context may include root manifests that are never mutation targets. */
export function normalizeCodingContextPathV14(value: unknown): string {
  return normalizeBase(value);
}

/** Mutation paths deliberately exclude deployment/runtime/package authority files. */
export function normalizeCodingMutablePathV14(value: unknown): string {
  const normalized = normalizeBase(value);
  if (MUTATION_PROTECTED_ROOT_FILES.has(normalized)) throw new Error('CODING_PATH_BLOCKED');
  return normalized;
}
