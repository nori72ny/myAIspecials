// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCodingSessionV14, type CodingCheck, type CodingSessionRequest } from './codingSessionV14.js';

const roots: string[] = [];
const kinds = ['typecheck', 'lint', 'test', 'build'] as const;
const green = (): CodingCheck[] => kinds.map(kind => ({ kind, ok: true, exitCode: 0, timedOut: false }));

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<CodingSessionRequest> {
  const root = await mkdtemp(path.join(tmpdir(), 'origin-coding-repeat-v14-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/value.ts'), 'export const value = 1;\n');
  return {
    root,
    goal: 'Make the value equal three',
    allowedPaths: ['src/value.ts'],
    trustedWorkspaceApproved: true,
  };
}

describe('V1.4 repeated patch recovery', () => {
  it('allows one bounded replan without spending an additional repair round', async () => {
    const input = await fixture();
    const firstPatch = { path: 'src/value.ts', search: 'value = 1', replacement: 'value = 2' };
    let proposalCalls = 0;
    let verificationRounds = 0;

    const result = await runCodingSessionV14(input, {
      propose: async context => {
        proposalCalls += 1;
        if (proposalCalls === 1) return [firstPatch];
        if (proposalCalls === 2) {
          expect(context.attempt).toBe(1);
          return [firstPatch];
        }
        expect(context.attempt).toBe(1);
        expect(context.diagnostics?.some(item => item.text.includes('previous proposal exactly repeated'))).toBe(true);
        return [{ path: 'src/value.ts', search: 'value = 2', replacement: 'value = 3' }];
      },
      verify: async () => {
        const round = verificationRounds++;
        return green().map(check => round === 0 && check.kind === 'test'
          ? { ...check, ok: false, exitCode: 1, diagnostic: 'expected 3, received 2' }
          : check);
      },
    });

    expect(result).toMatchObject({ status: 'verified', code: 'CODING_CHECKS_PASSED', repairRounds: 1 });
    expect(proposalCalls).toBe(3);
    expect(verificationRounds).toBe(2);
    expect(await readFile(path.join(input.root, 'src/value.ts'), 'utf8')).toBe('export const value = 3;\n');
  });

  it('still fails closed when the bounded replan repeats the same patch again', async () => {
    const input = await fixture();
    const firstPatch = { path: 'src/value.ts', search: 'value = 1', replacement: 'value = 2' };
    let proposalCalls = 0;

    const result = await runCodingSessionV14(input, {
      propose: async () => {
        proposalCalls += 1;
        return [firstPatch];
      },
      verify: async () => green().map(check => check.kind === 'test'
        ? { ...check, ok: false, exitCode: 1, diagnostic: 'still failing' }
        : check),
    });

    expect(result).toMatchObject({ status: 'blocked', code: 'CODING_REPEATED_PATCH', repairRounds: 1 });
    expect(proposalCalls).toBe(3);
    expect(await readFile(path.join(input.root, 'src/value.ts'), 'utf8')).toBe('export const value = 2;\n');
  });
});
