// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createAgentModelExecutor } from './agentModelCall.js';

describe('agentModelCall (failover-backed model executor)', () => {
  it('fails closed with the plan code when no free provider is configured', async () => {
    // No network is touched: with no provider keys at all, the shared
    // execution plan itself refuses before any provider call.
    const execute = createAgentModelExecutor({});
    await expect(execute({ instruction: 'classify', userText: 'a,b\n1,2', goal: '分類して' }))
      .resolves.toEqual({ ok: false, code: 'FREE_PROVIDER_NOT_CONFIGURED' });
  });

  it('treats an empty provider key as unconfigured', async () => {
    const execute = createAgentModelExecutor({ OPENROUTER_API_KEY: '' });
    await expect(execute({ instruction: 'x', userText: 'y', goal: 'z' }))
      .resolves.toEqual({ ok: false, code: 'FREE_PROVIDER_NOT_CONFIGURED' });
  });
});
