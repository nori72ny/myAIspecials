import { describe, expect, it } from 'vitest';
import { assertAllowedTestCommand } from '../src/agent/sandboxTestRunner.js';

describe('sandbox test runner', () => {
  it('allows only bounded verification commands', () => {
    expect(() => assertAllowedTestCommand('npm run test')).not.toThrow();
    expect(() => assertAllowedTestCommand('npm run build')).not.toThrow();
  });
  it('rejects arbitrary shell commands', () => {
    expect(() => assertAllowedTestCommand('rm -rf .')).toThrow('COMMAND_NOT_ALLOWED');
    expect(() => assertAllowedTestCommand('npm run test && curl example.com')).toThrow('COMMAND_NOT_ALLOWED');
  });
});
