export type SecurityCheck = { id: string; description: string; pass: boolean; reason: string };

const BLOCKED_PATTERNS = [
  /(^|\s)rm\s+-rf\b/i,
  /(^|\s)(curl|wget)\b/i,
  /(^|\s)(nc|netcat)\b/i,
  /(^|\s)\.env(?:\.|\s|$)/i,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/i,
];

export function runSecurityPolicyChecks(inputs: readonly string[]): SecurityCheck[] {
  return inputs.map((input, index) => {
    const matched = BLOCKED_PATTERNS.find((pattern) => pattern.test(input));
    return matched
      ? { id: `security-${index + 1}`, description: input, pass: false, reason: 'blocked-dangerous-pattern' }
      : { id: `security-${index + 1}`, description: input, pass: true, reason: 'no-known-dangerous-pattern' };
  });
}
