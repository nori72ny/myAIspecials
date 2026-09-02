import { spawn } from 'node:child_process';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const ALLOWED_COMMANDS = new Set(['npm run lint', 'npm run test', 'npm run build', 'npm run test:node-production', 'npm run test:api-node-esm']);

export type TestRunResult = { ok: boolean; command: string; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean };

export function assertAllowedTestCommand(command: string): void {
  if (!ALLOWED_COMMANDS.has(command.trim())) throw new Error('COMMAND_NOT_ALLOWED');
}

export async function runSandboxedTest(root: string, command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TestRunResult> {
  assertAllowedTestCommand(command);
  const child = spawn(command.trim().split(/\s+/)[0], command.trim().split(/\s+/).slice(1), {
    cwd: path.resolve(root), shell: false,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', timedOut = false;
  const append = (s: string, c: Buffer) => (s + c.toString('utf8')).slice(0, MAX_OUTPUT_BYTES);
  child.stdout.on('data', (c) => { stdout = append(stdout, c); });
  child.stderr.on('data', (c) => { stderr = append(stderr, c); });
  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 2_000); }, timeoutMs);
    child.once('close', (code) => { clearTimeout(timer); resolve(code); });
  });
  return { ok: !timedOut && exitCode === 0, command, exitCode, stdout, stderr, timedOut };
}
