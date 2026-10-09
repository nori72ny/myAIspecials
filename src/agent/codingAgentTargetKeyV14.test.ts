import { describe, expect, it } from 'vitest';
import { codingAgentTargetKeyForRunV14, codingAgentTargetKeyMatchesRunV14, codingAgentPinnedRevisionV14, codingAgentCheckoutMatchesTargetV14, isTrustedCodingWorkerTargetV14 } from './codingAgentTargetKeyV14.js';

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

  it('pins the exact original source SHA without changing owner association or exceeding the SQL key bound', () => {
    const run = 'run-original-release';
    const original = 'A'.repeat(40);
    const old = codingAgentTargetKeyForRunV14(run);
    const pinned = codingAgentTargetKeyForRunV14(run, original);
    expect(pinned).toBe(`${old}/${'a'.repeat(40)}`);
    expect(pinned.length).toBeLessThanOrEqual(128);
    expect(isTrustedCodingWorkerTargetV14(pinned)).toBe(true);
    expect(codingAgentPinnedRevisionV14(pinned)).toBe('a'.repeat(40));
    expect(codingAgentTargetKeyMatchesRunV14(run, pinned)).toBe(true);
    expect(codingAgentTargetKeyMatchesRunV14(run, old)).toBe(true);
    expect(codingAgentTargetKeyMatchesRunV14('run-another', pinned)).toBe(false);
    expect(codingAgentPinnedRevisionV14(old)).toBeNull();
    expect(() => codingAgentTargetKeyForRunV14(run, 'unknown')).toThrow('AGENT_CODING_SOURCE_REVISION_INVALID');
    expect(() => codingAgentTargetKeyForRunV14(run, '')).toThrow('AGENT_CODING_SOURCE_REVISION_INVALID');
  });

  it('blocks pinned checkouts when the actual trusted worker commit differs', () => {
    const target = codingAgentTargetKeyForRunV14('run-bound', 'a'.repeat(40));
    expect(codingAgentCheckoutMatchesTargetV14(target, 'a'.repeat(40))).toBe(true);
    expect(codingAgentCheckoutMatchesTargetV14(target, 'b'.repeat(40))).toBe(false);
    expect(codingAgentCheckoutMatchesTargetV14('origin:self', 'a'.repeat(40))).toBe(true);
    expect(codingAgentCheckoutMatchesTargetV14(codingAgentTargetKeyForRunV14('run-bound'), 'a'.repeat(40))).toBe(true);
    expect(codingAgentCheckoutMatchesTargetV14(target, 'unknown')).toBe(false);
    expect(codingAgentCheckoutMatchesTargetV14('origin:self/agent/../escape', 'a'.repeat(40))).toBe(false);
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
