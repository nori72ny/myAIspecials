import { describe, expect, it, vi } from 'vitest';
import { applyOriginSecurityHeaders } from './originSecurity';

function runMiddleware(path = '/') {
  const headers = new Map<string, string>();
  const req = { path } as never;
  const res = {
    setHeader: (name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    },
  } as never;
  const next = vi.fn();
  applyOriginSecurityHeaders({})(req, res, next);
  return { headers, next };
}

describe('applyOriginSecurityHeaders Permissions-Policy', () => {
  it('allows the microphone for this origin only (PR-V3 voice input) and keeps everything else off', () => {
    const { headers, next } = runMiddleware();
    const policy = headers.get('permissions-policy');
    expect(policy).toBe('camera=(), microphone=(self), geolocation=(), payment=(), usb=()');
    // The microphone grant is scoped to the app's own origin: no wildcard
    // and no cross-origin allowlist entry.
    expect(policy).not.toContain('*');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
