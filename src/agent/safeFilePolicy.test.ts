import { describe, expect, it } from 'vitest';
import { assertReadableAgentPath, containsLikelySecret } from './safeFilePolicy';

describe('safeFilePolicy', () => {
  it('rejects protected repository segments at any depth', () => {
    for (const path of ['.git/config', 'packages/demo/.git/config', 'nested/node_modules/pkg/index.js', 'nested/dist/app.js', 'nested/build/output.js', '.env.local']) {
      expect(() => assertReadableAgentPath(path)).toThrow('Protected repository path');
    }
  });

  it('allows normal repository files while blocking traversal and absolute paths', () => {
    for (const path of ['src/App.tsx', 'packages/demo/README.md', 'docs/architecture.md']) {
      expect(() => assertReadableAgentPath(path)).not.toThrow();
    }
    for (const path of ['../secret.txt', 'src/../secret.txt', '/etc/passwd', '']) {
      expect(() => assertReadableAgentPath(path)).toThrow('Unsafe repository path');
    }
  });

  it('keeps secret-content detection fail-closed', () => {
    expect(containsLikelySecret("apiKey: 'not-for-output'")).toBe(true);
    expect(containsLikelySecret('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(containsLikelySecret('const greeting = "hello";')).toBe(false);
  });
});
