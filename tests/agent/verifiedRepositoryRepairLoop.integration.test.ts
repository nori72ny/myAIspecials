import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runVerifiedRepositoryRepairLoop } from '../../src/agent/verifiedRepositoryRepairLoop.js';
import { safeWriteRepositoryFile } from '../../src/agent/safeRepositoryWriter.js';
import { runVerification } from '../../src/agent/verificationRunner.js';
import type { ToolName, ToolParams, ToolResult } from '../../src/agent/toolRegistry.js';

describe('verified repository repair loop: real filesystem', () => {
  it('repairs a real broken TypeScript fixture and proves the repaired state typechecks', async () => {
    const originalCwd = process.cwd();
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'origin-repair-fixture-'));
    const rootNodeModules = path.resolve(originalCwd, 'node_modules');

    try {
      await writeFile(
        path.join(fixtureRoot, 'package.json'),
        JSON.stringify({ name: 'origin-repair-fixture', private: true, scripts: { typecheck: 'tsc --noEmit' } }),
      );
      await writeFile(
        path.join(fixtureRoot, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', skipLibCheck: true }, include: ['src/**/*.ts'] }),
      );
      await symlink(rootNodeModules, path.join(fixtureRoot, 'node_modules'), 'junction');

      process.chdir(fixtureRoot);

      const runTool = async (name: ToolName, params: ToolParams): Promise<ToolResult> => {
        if (name === 'file_writer') {
          try {
            const result = await safeWriteRepositoryFile(params.path, params.content);
            return { ok: true, tool: name, message: 'write ok', artifact: JSON.stringify(result) };
          } catch (error) {
            return { ok: false, tool: name, message: error instanceof Error ? error.message : String(error) };
          }
        }

        const verification = await runVerification(params.kind);
        return {
          ok: verification.ok,
          tool: name,
          message: verification.ok ? `${verification.kind} passed` : `${verification.kind} verification failed`,
          artifact: JSON.stringify(verification),
        };
      };

      const broken = 'export const fixed: boolean = ;\n';
      const repaired = 'export const fixed: boolean = true;\n';
      const outcome = await runVerifiedRepositoryRepairLoop(
        { path: 'src/fix.ts', content: broken },
        'typecheck',
        [{ path: 'src/fix.ts', content: repaired }],
        runTool,
      );

      expect(outcome.ok).toBe(true);
      expect(outcome.repaired).toBe(true);
      expect(outcome.attempts).toBe(2);
      expect(await readFile(path.join(fixtureRoot, 'src/fix.ts'), 'utf8')).toBe(repaired);

      const finalVerification = await runVerification('typecheck');
      expect(finalVerification.ok).toBe(true);
      expect(finalVerification.exitCode).toBe(0);
      expect(finalVerification.timedOut).toBe(false);
    } finally {
      process.chdir(originalCwd);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 150_000);
});
