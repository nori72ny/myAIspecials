import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runVerifiedRepositoryRepairLoop } from '../../src/agent/verifiedRepositoryRepairLoop.js';
import { safeWriteRepositoryFile } from '../../src/agent/safeRepositoryWriter.js';
import { runVerification } from '../../src/agent/verificationRunner.js';
import type { ToolName, ToolParams, ToolResult } from '../../src/agent/toolRegistry.js';

const toolResult = (tool: ToolName, ok: boolean, message: string, artifact?: string): ToolResult => ({
  ok,
  tool,
  message,
  ...(artifact === undefined ? {} : { artifact }),
});

describe('real repository repair loop', () => {
  it('repairs an actual TypeScript failure using the real writer and compiler', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'origin-repair-e2e-'));
    try {
      const repoNodeModules = resolve(process.cwd(), 'node_modules');
      await symlink(repoNodeModules, join(fixture, 'node_modules'), 'dir');
      await writeFile(join(fixture, 'package.json'), JSON.stringify({
        private: true,
        scripts: { typecheck: 'tsc --noEmit' },
      }));
      await writeFile(join(fixture, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true },
        include: ['src/**/*.ts'],
      }));

      const runTool = async (name: ToolName, params: ToolParams): Promise<ToolResult> => {
        if (name === 'file_writer') {
          try {
            const write = await safeWriteRepositoryFile(params.path, params.content, fixture);
            return toolResult(name, true, 'write ok', write.path);
          } catch (error) {
            return toolResult(name, false, error instanceof Error ? error.message : String(error));
          }
        }
        if (name === 'verification_runner') {
          const verification = await runVerification(params.kind, fixture);
          return toolResult(name, verification.ok, verification.ok ? 'typecheck passed' : 'typecheck failed', JSON.stringify(verification));
        }
        return toolResult(name, false, `unsupported test tool: ${name}`);
      };

      const outcome = await runVerifiedRepositoryRepairLoop(
        { path: 'src/fix.ts', content: 'export const fixed: string = 123;' },
        'typecheck',
        [{ path: 'src/fix.ts', content: 'export const fixed: string = "repaired";' }],
        runTool,
      );

      expect(outcome.ok).toBe(true);
      expect(outcome.repaired).toBe(true);
      expect(outcome.attempts).toBe(2);
      await expect(readFile(join(fixture, 'src/fix.ts'), 'utf8')).resolves.toContain('"repaired"');
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
