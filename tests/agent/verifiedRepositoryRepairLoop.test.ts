import { describe, expect, it } from 'vitest';
import { runVerifiedRepositoryRepairLoop } from '../../src/agent/verifiedRepositoryRepairLoop.js';
import type { ToolName, ToolParams, ToolResult } from '../../src/agent/toolRegistry.js';

const result = (tool: ToolName, ok: boolean, message: string, artifact?: string): ToolResult => ({
  ok,
  tool,
  message,
  ...(artifact === undefined ? {} : { artifact }),
});

describe('verified repository repair loop', () => {
  it('accepts a successful initial write only after verification passes', async () => {
    const calls: string[] = [];
    const runTool = async (name: ToolName, _params: ToolParams): Promise<ToolResult> => {
      calls.push(name);
      if (name === 'file_writer') return result(name, true, 'write ok', 'src/fix.ts');
      return result(name, true, 'typecheck passed', JSON.stringify({ ok: true, timedOut: false }));
    };

    const outcome = await runVerifiedRepositoryRepairLoop(
      { path: 'src/fix.ts', content: 'export const fixed = true;' },
      'typecheck',
      [],
      runTool,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.repaired).toBe(false);
    expect(calls).toEqual(['file_writer', 'verification_runner']);
  });

  it('repairs after verification failure and only succeeds after the repaired state verifies', async () => {
    const calls: string[] = [];
    let verificationCount = 0;
    const runTool = async (name: ToolName, _params: ToolParams): Promise<ToolResult> => {
      calls.push(name);
      if (name === 'file_writer') return result(name, true, 'write ok', 'src/fix.ts');
      verificationCount += 1;
      if (verificationCount === 1) {
        return result(name, false, 'typecheck verification failed', 'TS1005: expected ;');
      }
      return result(name, true, 'typecheck passed', JSON.stringify({ ok: true, timedOut: false }));
    };

    const outcome = await runVerifiedRepositoryRepairLoop(
      { path: 'src/fix.ts', content: 'export const broken = ;' },
      'typecheck',
      [{ path: 'src/fix.ts', content: 'export const fixed = true;' }],
      runTool,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.repaired).toBe(true);
    expect(outcome.attempts).toBe(2);
    expect(calls).toEqual(['file_writer', 'verification_runner', 'file_writer', 'verification_runner']);
  });

  it('fails closed when the initial write fails', async () => {
    const calls: string[] = [];
    const runTool = async (name: ToolName, _params: ToolParams): Promise<ToolResult> => {
      calls.push(name);
      return result(name, false, 'REPOSITORY_WRITE_FAILED');
    };

    const outcome = await runVerifiedRepositoryRepairLoop(
      { path: '../escape.ts', content: 'unsafe' },
      'typecheck',
      [{ path: 'src/fix.ts', content: 'safe' }],
      runTool,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.stopReason).toBe('INITIAL_WRITE_FAILED');
    expect(calls).toEqual(['file_writer']);
  });

  it('fails closed when a repair write fails and never verifies a failed write', async () => {
    const calls: string[] = [];
    let writes = 0;
    const runTool = async (name: ToolName, _params: ToolParams): Promise<ToolResult> => {
      calls.push(name);
      if (name === 'file_writer') {
        writes += 1;
        return writes === 1
          ? result(name, true, 'write ok', 'src/fix.ts')
          : result(name, false, 'REPOSITORY_WRITE_FAILED');
      }
      return result(name, false, 'typecheck verification failed', 'TS1005: expected ;');
    };

    const outcome = await runVerifiedRepositoryRepairLoop(
      { path: 'src/fix.ts', content: 'export const broken = ;' },
      'typecheck',
      [{ path: 'src/fix.ts', content: 'unsafe repair' }],
      runTool,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.stopReason).toBe('REPAIR_WRITE_FAILED');
    expect(calls).toEqual(['file_writer', 'verification_runner', 'file_writer']);
  });
});
