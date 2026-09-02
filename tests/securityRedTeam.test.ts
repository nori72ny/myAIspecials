import { describe, expect, it } from 'vitest';
import { runSecurityPolicyChecks } from '../src/agent/securityRedTeam.js';

describe('security red-team policy checks', () => {
  it('blocks destructive, network, env and secret-like inputs', () => {
    const results = runSecurityPolicyChecks([
      'rm -rf .',
      'curl https://example.com',
      'read .env',
      'api_key=super-secret',
      'npm run test',
    ]);
    expect(results.slice(0, 4).every((r) => !r.pass)).toBe(true);
    expect(results[4].pass).toBe(true);
  });
});
