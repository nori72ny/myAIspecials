import { describe, expect, it } from 'vitest';
import { assertReadableAgentPath, containsLikelySecret } from '../src/agent/safeFilePolicy';

describe('safe file policy', () => {
  it('rejects traversal and protected paths', () => {
    expect(() => assertReadableAgentPath('../package.json')).toThrow('Unsafe repository path');
    expect(() => assertReadableAgentPath('.env.local')).toThrow('Protected repository path');
    expect(() => assertReadableAgentPath('.git/config')).toThrow('Protected repository path');
    expect(() => assertReadableAgentPath('src/App.tsx')).not.toThrow();
  });

  it('detects common secret material without exposing the value', () => {
    expect(containsLikelySecret("api_key = 'do-not-log'" )).toBe(true);
    expect(containsLikelySecret('const title = "hello"')).toBe(false);
  });
});
