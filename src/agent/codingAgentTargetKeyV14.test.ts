import { describe, expect, it } from 'vitest';
import { codingAgentTargetKeyForRunV14, isTrustedCodingWorkerTargetV14 } from './codingAgentTargetKeyV14.js';

describe('durable Agent to Coding target binding', () => {
  it('generates an immutable path-free run association accepted only by the worker allowlist', () => {
    const a = codingAgentTargetKeyForRunV14('run-agent-coding-test');
    const b = codingAgentTargetKeyForRunV14('run-agent-coding-test');
    const other = codingAgentTargetKeyForRunV14('run-other');
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).toMatch(/^origin:self\/agent\/[0-9a-f]{64}$/);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(isTrustedCodingWorkerTargetV14(a)).toBe(true);
    expect(isTrustedCodingWorkerTargetV14('origin:self')).toBe(true);
  });

  it.each([
    'origin:self/agent/../../etc/passwd',
    'origin:self/agent/000',
    'origin:self/private',
    'origin:self/agent/' + 'A'.repeat(64),
    'github:outside/repo',
    '../origin:self',
    '',
  ])('never interprets arbitrary target keys as executable filesystem access: %s', bad => {
    expect(isTrustedCodingWorkerTargetV14(bad)).toBe(false);
  });

  it.each(['run-', 'run-../../etc/passwd', 'run-X_underscore', '', 'random', 'run-' + 'x'.repeat(101)])(
    'rejects invalid recovery run binding %s', bad => {
      expect(() => codingAgentTargetKeyForRunV14(bad)).toThrow('AGENT_CODING_RUN_ID_INVALID');
    },
  );
});
