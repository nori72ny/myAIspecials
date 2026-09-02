const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]+['"]/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const PROTECTED_SEGMENTS = new Set(['.git', 'node_modules', 'dist', 'build']);
const isProtectedPath = (normalized: string): boolean => {
  const segments = normalized.split('/').filter(Boolean);
  return segments.some((segment, index) => PROTECTED_SEGMENTS.has(segment) || (index === 0 && segment.startsWith('.env')));
};

export function assertReadableAgentPath(relativePath: string): void {
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Unsafe repository path');
  }
  if (isProtectedPath(normalized)) {
    throw new Error('Protected repository path');
  }
}

export function containsLikelySecret(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}
