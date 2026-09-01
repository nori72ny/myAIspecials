import { spawn } from 'node:child_process';

export type VerificationKind = 'test' | 'typecheck' | 'build';
export type VerificationResult = {
  ok: boolean;
  kind: VerificationKind;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

const COMMANDS: Record<VerificationKind, { command: string; args: string[] }> = {
  test: { command: 'npm', args: ['test', '--', '--runInBand'] },
  typecheck: { command: 'npx', args: ['tsc', '--noEmit'] },
  build: { command: 'npm', args: ['run', 'build'] },
};
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 64 * 1024;

export function runVerification(kind: VerificationKind): Promise<VerificationResult> {
  const spec = COMMANDS[kind];
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      shell: false,
      env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (target === 'stdout') stdout = (stdout + text).slice(-MAX_OUTPUT);
      else stderr = (stderr + text).slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, kind, exitCode: null, timedOut, stdout, stderr: `${stderr}${error.message}`.slice(-MAX_OUTPUT) });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ ok: !timedOut && exitCode === 0, kind, exitCode, timedOut, stdout, stderr });
    });
  });
}
