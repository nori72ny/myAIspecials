import { describe, expect, it, vi } from 'vitest';
import { runVerifiedRepositoryRepairLoop } from './verifiedRepositoryRepairLoop.js';
import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

const tool = (name: ToolName, ok: boolean, artifact = '', message = ''): ToolResult => ({
  ok,
  tool: name,
  artifact,
  message,
});

describe('runVerifiedRepositoryRepairLoop', () => {
  it('verifies the initial write and stops without repair when it passes', async () => {
    const runTool = vi.fn(async (name: ToolName) =>
      name === 'file_writer' ? tool(name, true, 'src/a.ts', 'wrote') : tool(name, true, '{"ok":true}', 'typecheck verification passed.'),
    );

    const result = await runVerifiedRepositoryRepairLoop(
      { path: 'src/a.ts', content: 'export const a = 1;' },
      'typecheck',
      [],
      runTool as unknown as (name: ToolName, params: ToolParams) => Promise<ToolResult>,
    );

    expect(result.ok).toBe(true);
    expect(result.repaired).toBe(false);
    expect(runTool).toHaveBeenCalledTimes(2);
  });

  it('repairs after a failed verification and re-verifies', async () => {
    let verificationCalls = 0;
    const runTool = vi.fn(async (name: ToolName, params: ToolParams) => {
      if (name === 'file_writer') return tool(name, true, String(params.path), 'wrote');
      verificationCalls += 1;
      return verificationCalls === 1
        ? tool(name, false, 'TS2322', 'typecheck verification failed.')
        : tool(name, true, '{"ok":true}', 'typecheck verification passed.');
    });

    const result = await runVerifiedRepositoryRepairLoop(
      { path: 'src/a.ts', content: 'export const a: number = "bad";' },
      'typecheck',
      [{ path: 'src/a.ts', content: 'export const a: number = 1;' }],
      runTool,
    );

    expect(result.ok).toBe(true);
    expect(result.repaired).toBe(true);
    expect(runTool).toHaveBeenCalledTimes(4);
  });
});
