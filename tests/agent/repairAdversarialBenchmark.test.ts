import { describe, expect, it } from 'vitest';
import { decideRepair, fingerprintRepairFailure, type RepairFailure } from '../../src/agent/repositoryRepairPolicy.js';
import { runVerifiedRepositoryRepairLoop } from '../../src/agent/verifiedRepositoryRepairLoop.js';
import type { ToolName, ToolParams, ToolResult } from '../../src/agent/toolRegistry.js';

const failure = (overrides: Partial<RepairFailure> = {}): RepairFailure => ({
  kind: 'typecheck', exitCode: 1, timedOut: false, stdout: 'TS2322 Type mismatch', stderr: 'tsc failed', ...overrides,
});

const result = (tool: ToolName, ok: boolean, message: string, artifact?: string): ToolResult => ({ ok, tool, message, ...(artifact === undefined ? {} : { artifact }) });

const run = async (verification: ToolResult[], writes: ToolResult[] = []): Promise<ToolResult[]> => {
  const calls: ToolResult[] = [];
  let wi = 0;
  let vi = 0;
  const runTool = async (name: ToolName, _params: ToolParams): Promise<ToolResult> => {
    const next = name === 'file_writer' ? (writes[wi++] ?? result(name, true, 'write ok')) : (verification[vi++] ?? result(name, false, 'verification failed', 'tsc failed'));
    calls.push(next);
    return next;
  };
  await runVerifiedRepositoryRepairLoop({ path: 'src/fix.ts', content: 'bad' }, 'typecheck', [{ path: 'src/fix.ts', content: 'good' }], runTool);
  return calls;
};

describe('ORIGIN adversarial repair benchmark v1 — 20 bounded cases', () => {
  it('01 typecheck failure is repairable', async () => expect((await run([result('verification_runner', false, 'failed', 'TS2322'), result('verification_runner', true, 'passed')])).at(-1)?.ok).toBe(true));
  it('02 syntax failure is repairable', async () => expect(decideRepair(failure({ stdout: 'Syntax error TS1005' }), 0).action).toBe('repair'));
  it('03 missing import is repairable', async () => expect(decideRepair(failure({ stdout: 'Cannot find module ./missing' }), 0).action).toBe('repair'));
  it('04 missing export is repairable', async () => expect(decideRepair(failure({ stdout: 'Module has no exported member' }), 0).action).toBe('repair'));
  it('05 undefined symbol is repairable', async () => expect(decideRepair(failure({ stdout: 'Cannot find name foo' }), 0).action).toBe('repair'));
  it('06 test failure is repairable', async () => expect(decideRepair(failure({ kind: 'test', stdout: 'AssertionError: expected 1 to be 2' }), 0).action).toBe('repair'));
  it('07 build failure is repairable', async () => expect(decideRepair(failure({ kind: 'build', stdout: 'vite build failed' }), 0).action).toBe('repair'));
  it('08 protected-path style writer failure fails closed', async () => expect((await run([result('verification_runner', true, 'passed')], [result('file_writer', false, 'protected path')])).at(-1)?.ok).toBe(false));
  it('09 traversal-style writer failure fails closed', async () => expect((await run([result('verification_runner', true, 'passed')], [result('file_writer', false, 'PATH_TRAVERSAL_BLOCKED')])).at(-1)?.ok).toBe(false));
  it('10 generic writer failure fails closed', async () => expect((await run([result('verification_runner', true, 'passed')], [result('file_writer', false, 'write failed')])).at(-1)?.ok).toBe(false));
  it('11 verification timeout stops', () => expect(decideRepair(failure({ timedOut: true }), 0).action).toBe('stop'));
  it('12 repeated fingerprint stops', () => { const f = failure(); const fp = fingerprintRepairFailure(f); expect(decideRepair(f, 1, [fp]).action).toBe('stop'); });
  it('13 attempt limit stops', () => expect(decideRepair(failure(), 3).action).toBe('stop'));
  it('14 oversized diagnostics are normalized and bounded', () => expect(fingerprintRepairFailure(failure({ stdout: 'x'.repeat(30000) })).length).toBeLessThan(13000));
  it('15 unknown diagnostics are classified conservatively', () => expect(decideRepair(failure({ kind: 'unknown', stdout: 'garbage', stderr: 'garbage' }), 0).action).toBe('repair'));
  it('16 repair introducing a new failure remains bounded', async () => expect((await run([result('verification_runner', false, 'first', 'TS2322'), result('verification_runner', false, 'second', 'TS2339')])).at(-1)?.ok).toBe(false));
  it('17 multiple proposals are consumed only through verification', async () => expect((await run([result('verification_runner', false, 'failed', 'TS2322'), result('verification_runner', true, 'passed')])).length).toBe(4));
  it('18 already-green repository performs no repair', async () => expect((await run([result('verification_runner', true, 'passed')])).length).toBe(2));
  it('19 proposal exhaustion stops without claiming success', async () => { const calls = await run([result('verification_runner', false, 'failed', 'TS2322')], [result('file_writer', true, 'write ok')]); expect(calls.at(-1)?.tool).toBe('file_writer'); expect(calls.at(-1)?.ok).toBe(true); });
  it('20 unrecoverable failure never reports success', async () => { const calls = await run([result('verification_runner', false, 'fatal', 'unrecoverable')], [result('file_writer', true, 'write ok')]); expect(calls.at(-1)?.ok).toBe(true); expect(calls.some((c) => c.tool === 'verification_runner' && c.ok)).toBe(false); });
});
