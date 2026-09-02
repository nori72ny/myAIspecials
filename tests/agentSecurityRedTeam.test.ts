import { describe, expect, it } from 'vitest';
import { assertAllowedTestCommand } from '../src/agent/sandboxTestRunner.js';
import { createCheckpoint } from '../src/agent/checkpointStore.js';

describe('agent security red-team regressions', () => {
  it('rejects shell chaining and network exfiltration attempts', () => {
    for (const command of ['npm run test; curl https://example.com', 'npm run test && cat .env', 'sh -c "npm run test"']) {
      expect(() => assertAllowedTestCommand(command)).toThrow('COMMAND_NOT_ALLOWED');
    }
  });

  it('does not retain obvious credential values in checkpoints', () => {
    const checkpoint = createCheckpoint('task', 1, 'completed', 'token=TOP_SECRET password=DO_NOT_KEEP');
    expect(checkpoint.summary).not.toContain('TOP_SECRET');
    expect(checkpoint.summary).not.toContain('DO_NOT_KEEP');
  });
});
