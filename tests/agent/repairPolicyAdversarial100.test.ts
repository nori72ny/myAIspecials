import { describe, expect, it } from 'vitest';
import { classifyRepairFailure, decideRepair, fingerprintRepairFailure, type RepairFailure } from '../../src/agent/repositoryRepairPolicy.js';

const kinds: RepairFailure['kind'][] = ['typecheck', 'test', 'build', 'unknown'];
const diagnostics = [
  'TS2322 Type mismatch',
  'TS2339 Property does not exist',
  'Cannot find module ./missing',
  'AssertionError: expected 1 to be 2',
  'vitest test failed',
  'vite build failed',
  'tsc --noEmit failed',
  'unrecoverable diagnostic',
  'path /tmp/project/node_modules/pkg/file.ts line 42',
  'diagnostic with version 5.8.2 and line 100',
];

const makeFailure = (index: number, overrides: Partial<RepairFailure> = {}): RepairFailure => ({
  kind: kinds[index % kinds.length],
  exitCode: 1,
  timedOut: false,
  stdout: `${diagnostics[index % diagnostics.length]} case-${index}`,
  stderr: `stderr-${index} node_modules/pkg/${index}.ts`,
  ...overrides,
});

describe('ORIGIN repair policy adversarial benchmark v1 — 100 deterministic cases', () => {
  for (let index = 0; index < 100; index += 1) {
    it(`case ${String(index + 1).padStart(3, '0')}: bounded decision invariants`, () => {
      const failure = makeFailure(index);
      const fingerprint = fingerprintRepairFailure(failure);
      expect(fingerprint.length).toBeLessThanOrEqual(24050);
      expect(fingerprintRepairFailure(failure)).toBe(fingerprint);

      const normalDecision = decideRepair(failure, index % 3, []);
      expect(normalDecision.fingerprint).toBe(fingerprint);
      expect(['repair', 'stop']).toContain(normalDecision.action);

      const timeoutDecision = decideRepair({ ...failure, timedOut: true }, 0);
      expect(timeoutDecision.action).toBe('stop');

      const limitDecision = decideRepair(failure, 3, []);
      expect(limitDecision.action).toBe('stop');

      const repeatedDecision = decideRepair(failure, 1, [fingerprint]);
      expect(repeatedDecision.action).toBe('stop');
    });
  }

  it('preserves explicit failure kinds', () => {
    expect(classifyRepairFailure(makeFailure(0, { kind: 'typecheck' }))).toBe('typecheck');
    expect(classifyRepairFailure(makeFailure(1, { kind: 'test' }))).toBe('test');
    expect(classifyRepairFailure(makeFailure(2, { kind: 'build' }))).toBe('build');
  });

  it('classifies unknown diagnostics conservatively from their content', () => {
    expect(classifyRepairFailure(makeFailure(0, { kind: 'unknown', stdout: 'tsc: TypeScript error' }))).toBe('typecheck');
    expect(classifyRepairFailure(makeFailure(1, { kind: 'unknown', stdout: 'vitest test failed' }))).toBe('test');
    expect(classifyRepairFailure(makeFailure(2, { kind: 'unknown', stdout: 'vite build failed' }))).toBe('build');
  });
});
