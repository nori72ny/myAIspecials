const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]+['"]/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const PROTECTED_PREFIXES = ['.env', '.git/', 'node_modules/', 'dist/', 'build/'];

export function assertReadableAgentPath(relativePath: string): void {
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Unsafe repository path');
  }
  if (PROTECTED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix))) {
    throw new Error('Protected repository path');
  }
}

export function containsLikelySecret(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}
