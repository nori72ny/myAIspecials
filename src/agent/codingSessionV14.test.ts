// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { runCodingSessionV14, type CodingSessionRequest, type CodingCheck } from './codingSessionV14.js';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const roots: string[] = [];
const kinds = ['typecheck', 'lint', 'test', 'build'] as const;
const green = (): CodingCheck[] => kinds.map(kind => ({ kind, ok: true, exitCode: 0, timedOut: false }));
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(): Promise<CodingSessionRequest> {
  const root = await mkdtemp(path.join(tmpdir(), 'origin-coding-v14-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'src/math.js'), 'export const add = (a, b) => a - b;\n');
  await writeFile(path.join(root, 'src/message.js'), 'export const message = "old";\n');
  return { root, goal: 'Fix addition and update the message', allowedPaths: ['src/math.js', 'src/message.js'], trustedWorkspaceApproved: true };
}
const mathEdit = (replacement = 'a + b') => ({ path: 'src/math.js', search: 'a - b', replacement });

describe('V1.4 dedicated coding workspace', () => {
  it('edits two files, observes a real failing test, repairs, and reruns all four checks', async () => {
    const input = await fixture();
    await writeFile(path.join(input.root, 'math.test.js'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './src/math.js';
import { message } from './src/message.js';
test('addition and message', () => { assert.equal(add(2, 3), 5); assert.equal(message, 'ready'); });
`);
    const rounds: CodingCheck[][] = [];
    input.contextPaths = ['math.test.js'];
    const result = await runCodingSessionV14(input, {
      propose: async context => context.attempt === 0
        ? [mathEdit('a + b + 1'), { path: 'src/message.js', search: '"old"', replacement: '"ready"' }]
        : (expect(context.failedChecks).toEqual(['test']), expect(context.diagnostics?.[0].text).toContain('AssertionError'), [{ path: 'src/math.js', search: 'a + b + 1', replacement: 'a + b' }]),
      verify: async root => {
        const commands: Record<typeof kinds[number], string[]> = {
          typecheck: [require.resolve('typescript/bin/tsc'), '--allowJs', '--checkJs', '--noEmit', 'src/math.js', 'src/message.js'],
          lint: ['--input-type=module', '-e', `import {readFileSync} from 'node:fs'; for (const p of ['src/math.js','src/message.js']) if (/ +$/m.test(readFileSync(p,'utf8'))) process.exit(1);`],
          test: ['--test', 'math.test.js'],
          build: [require.resolve('esbuild/bin/esbuild'), 'src/math.js', '--bundle', '--platform=node', '--outfile=output.cjs'],
        };
        const checks: CodingCheck[] = [];
        for (const kind of kinds) {
          try {
            const [bin, ...args] = kind === 'build' ? commands[kind] : [process.execPath, ...commands[kind]];
            await execute(bin, args, { cwd: root, timeout: 15_000, maxBuffer: 64 * 1024 });
            checks.push({ kind, ok: true, exitCode: 0, timedOut: false });
          } catch (error) {
            checks.push({ kind, ok: false, exitCode: typeof error.code === 'number' ? error.code : null, timedOut: Boolean(error.killed), diagnostic: `${error.stdout ?? ''}\n${error.stderr ?? ''}` });
          }
        }
        rounds.push(checks);
        return checks;
      },
    });
    expect(rounds).toHaveLength(2);
    expect(result).toMatchObject({ status: 'verified', repairRounds: 1, changedPaths: ['src/math.js', 'src/message.js'], gitPublished: false, deployed: false });
    expect(result.audit.filter(e => e.action === 'edited')).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('export const');
    expect(await readFile(path.join(input.root, 'src/math.js'), 'utf8')).toContain('a + b;');
  }, 60_000);

  it('preflights the entire batch before writing any file', async () => {
    const input = await fixture();
    const result = await runCodingSessionV14(input, { propose: async () => [mathEdit(), { path: 'src/message.js', search: 'missing', replacement: 'ready' }], verify: async () => green() });
    expect(result.status).toBe('blocked');
    expect(result.changedPaths).toEqual([]);
    expect(await readFile(path.join(input.root, 'src/math.js'), 'utf8')).toContain('a - b');
  });

  it('provides read-only tests to the planner without authorizing edits', async () => {
    const input = await fixture();
    input.allowedPaths = ['src/math.js'];
    input.contextPaths = ['src/message.js'];
    const result = await runCodingSessionV14(input, {
      propose: async context => {
        expect(context.files.map(f => f.path)).toContain('src/message.js');
        expect(context.editablePaths).toEqual(['src/math.js']);
        return [{ path: 'src/message.js', search: '"old"', replacement: '"cheat"' }];
      }, verify: async () => green(),
    });
    expect(result.code).toBe('CODING_OUT_OF_SCOPE');
    expect(await readFile(path.join(input.root, 'src/message.js'), 'utf8')).toContain('"old"');
  });

  it('redacts diagnostics before repair and excludes them from the audit', async () => {
    const input = await fixture();
    let round = 0;
    const result = await runCodingSessionV14(input, {
      propose: async context => {
        if (round++ === 0) return [mathEdit('a + b + 1')];
        expect(context.diagnostics?.[0].text).toContain('[REDACTED_SECRET]');
        expect(context.diagnostics?.[0].text).not.toContain('private-value');
        return [{ path: 'src/math.js', search: 'a + b + 1', replacement: 'a + b' }];
      },
      verify: async () => green().map(c => round === 1 && c.kind === 'test'
        ? { ...c, ok: false, exitCode: 1, diagnostic: 'password="private-value" assertion failed' } : c),
    });
    expect(result.status).toBe('verified');
    expect(JSON.stringify(result.audit)).not.toContain('assertion failed');
    expect(JSON.stringify(result)).not.toContain('private-value');
  });

  it.each(['../outside.js', '.env.local', '.github/workflows/ci.yml', 'package.json', 'src\\math.js'])('rejects protected scope %s', async filePath => {
    const input = await fixture();
    input.allowedPaths.push(filePath);
    const result = await runCodingSessionV14(input, { propose: async () => { throw new Error('must not reach planner'); }, verify: async () => green() });
    expect(result.code).toBe('CODING_PATH_BLOCKED');
    expect(result.changedPaths).toEqual([]);
  });

  it('rejects edits outside the approved scope', async () => {
    const input = await fixture();
    input.allowedPaths = ['src/message.js'];
    const result = await runCodingSessionV14(input, { propose: async () => [mathEdit()], verify: async () => green() });
    expect(result.code).toBe('CODING_OUT_OF_SCOPE');
  });

  it('rejects symlink escape during repository inspection', async () => {
    const input = await fixture();
    await symlink('/etc/passwd', path.join(input.root, 'src/link.js'));
    input.allowedPaths = ['src/link.js'];
    const result = await runCodingSessionV14(input, { propose: async () => [mathEdit()], verify: async () => green() });
    expect(result.status).toBe('blocked');
    expect(result.changedPaths).toEqual([]);
  });

  it('does not overwrite changes made while the planner was running', async () => {
    const input = await fixture();
    const result = await runCodingSessionV14(input, {
      propose: async () => { await writeFile(path.join(input.root, 'src/math.js'), 'export const add = (a, b) => a - b; // user change\n'); return [mathEdit()]; },
      verify: async () => green(),
    });
    expect(result.code).toBe('CODING_SNAPSHOT_CHANGED');
    expect(await readFile(path.join(input.root, 'src/math.js'), 'utf8')).toContain('user change');
  });

  it('rejects a success report when a scoped file changes during verification', async () => {
    const input = await fixture();
    const result = await runCodingSessionV14(input, {
      propose: async () => [mathEdit()],
      verify: async () => { await writeFile(path.join(input.root, 'src/message.js'), 'modified by another process'); return green(); },
    });
    expect(result.code).toBe('CODING_WORKSPACE_CHANGED_DURING_CHECKS');
  });

  it('cannot call one passing check a verified session', async () => {
    const result = await runCodingSessionV14(await fixture(), { propose: async () => [mathEdit()], verify: async () => [green()[0]] });
    expect(result.code).toBe('CODING_VERIFICATION_INCOMPLETE');
    expect(result.changedPaths).toEqual(['src/math.js']);
  });

  it('stops at the repair budget and never publishes an unverified result', async () => {
    const input = await fixture();
    input.maxRepairs = 0;
    const result = await runCodingSessionV14(input, { propose: async () => [mathEdit()], verify: async () => green().map(c => ({ ...c, ok: false, exitCode: 1 })) });
    expect(result).toMatchObject({ status: 'repair_limit', repairRounds: 0, deployed: false, gitPublished: false });
  });

  it('stops a repeated patch rather than retrying indefinitely', async () => {
    const result = await runCodingSessionV14(await fixture(), { propose: async () => [mathEdit()], verify: async () => green().map(c => ({ ...c, ok: false, exitCode: 1 })) });
    expect(result.code).toBe('CODING_REPEATED_PATCH');
    expect(result.repairRounds).toBe(1);
  });

  it('blocks sensitive context and withholds arbitrary worker errors', async () => {
    const input = await fixture();
    await writeFile(path.join(input.root, 'src/message.js'), 'const password = "private-value";');
    const sensitive = await runCodingSessionV14(input, { propose: async () => [mathEdit()], verify: async () => green() });
    expect(sensitive.code).toBe('CODING_SENSITIVE_CONTEXT_BLOCKED');
    input.allowedPaths = ['src/math.js'];
    const failed = await runCodingSessionV14(input, { propose: async () => { throw new Error('private-value'); }, verify: async () => green() });
    expect(failed.code).toBe('CODING_OPERATION_BLOCKED');
    expect(JSON.stringify([sensitive, failed])).not.toContain('private-value');
  });

  it('serializes sessions sharing a dedicated workspace', async () => {
    const input = await fixture();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = runCodingSessionV14(input, { propose: async () => { entered(); await gate; return [mathEdit()]; }, verify: async () => green() });
    await started;
    try {
      const other = await runCodingSessionV14(input, { propose: async () => [mathEdit()], verify: async () => green() });
      expect(other.code).toBe('CODING_WORKSPACE_BUSY');
    } finally { release(); }
    expect((await first).status).toBe('verified');
  });

  it('rejects missing workspace approval before calling the planner', async () => {
    const input = await fixture();
    input.trustedWorkspaceApproved = false as never;
    const result = await runCodingSessionV14(input, { propose: async () => { throw new Error('unreachable'); }, verify: async () => green() });
    expect(result.code).toBe('CODING_WORKSPACE_APPROVAL_REQUIRED');
  });

  it('does not edit the application working directory', async () => {
    const input = await fixture();
    input.root = process.cwd();
    const result = await runCodingSessionV14(input, { propose: async () => [mathEdit()], verify: async () => green() });
    expect(result.code).toBe('CODING_DEDICATED_WORKSPACE_REQUIRED');
  });

  it('rejects malformed runner evidence without leaking it into the audit', async () => {
    const input = await fixture();
    const result = await runCodingSessionV14(input, { propose: async () => [mathEdit()], verify: async () => green().map(c => ({ ...c, exitCode: 'private-value' as never })) });
    expect(result.code).toBe('CODING_VERIFICATION_INCOMPLETE');
    expect(JSON.stringify(result)).not.toContain('private-value');
  });
});
