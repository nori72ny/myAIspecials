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
  test: { command: 'npm', args: ['test'] },
  typecheck: { command: 'npm', args: ['run', 'typecheck'] },
  build: { command: 'npm', args: ['run', 'build'] },
};
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 64 * 1024;

export function runVerification(kind: VerificationKind, cwd = process.cwd()): Promise<VerificationResult> {
  const spec = COMMANDS[kind];
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd,
      shell: false,
      env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (result: VerificationResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (target === 'stdout') stdout = (stdout + text).slice(-MAX_OUTPUT);
      else stderr = (stderr + text).slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, kind, exitCode: null, timedOut, stdout, stderr: `${stderr}${error.message}`.slice(-MAX_OUTPUT) });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      finish({ ok: !timedOut && exitCode === 0, kind, exitCode, timedOut, stdout, stderr });
    });
  });
}
