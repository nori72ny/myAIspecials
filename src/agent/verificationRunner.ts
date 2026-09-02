import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type VerificationKind = 'test' | 'typecheck' | 'build';

export type VerificationResult = {
  ok: boolean;
  kind: VerificationKind;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
};

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const ALLOWED_SCRIPTS: Record<VerificationKind, string> = {
  test: 'test',
  typecheck: 'typecheck',
  build: 'build',
};

// The command executed by verification is an ORIGIN-owned constant, never a
// repository-controlled shell string. We still require package.json to expose
// the expected script as an integrity signal, but we do not execute npm run:
// npm lifecycle hooks (pre*/post*) are repository-controlled code execution.
const APPROVED_SCRIPT_COMMANDS: Record<VerificationKind, string> = {
  test: "FREE_ONLY=false vitest run --exclude 'tests/e2e/**' --exclude 'tests/api/**' --reporter=default --reporter=junit --outputFile.junit=test-results/vitest-junit.xml",
  typecheck: 'tsc --noEmit',
  build: 'vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs',
};

function appendBounded(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') <= MAX_OUTPUT_BYTES) return next;
  return next.slice(0, MAX_OUTPUT_BYTES) + '\n[OUTPUT_TRUNCATED]';
}

async function assertRepositoryRoot(root: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const stat = await fs.stat(realRoot);
  if (!stat.isDirectory()) throw new Error('INVALID_REPOSITORY_ROOT');
  return realRoot;
}

export async function runVerification(root: string, kind: VerificationKind): Promise<VerificationResult> {
  if (!Object.hasOwn(ALLOWED_SCRIPTS, kind)) throw new Error('VERIFICATION_NOT_ALLOWED');
  const cwd = await assertRepositoryRoot(root);
  const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
  const scriptName = ALLOWED_SCRIPTS[kind];
  const configured = packageJson.scripts?.[scriptName];
  if (typeof configured !== 'string') throw new Error(`VERIFICATION_SCRIPT_MISSING:${scriptName}`);
  if (configured !== APPROVED_SCRIPT_COMMANDS[kind]) {
    throw new Error(`VERIFICATION_COMMAND_NOT_APPROVED:${kind}`);
  }

  const sandboxHome = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-verification-home-'));
  try {
    const nodeBin = path.join(cwd, 'node_modules', '.bin');
    const envPath = [nodeBin, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter);
    const startedAt = Date.now();
    const child = spawn('/bin/sh', ['-c', APPROVED_SCRIPT_COMMANDS[kind]], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        PATH: envPath,
        HOME: sandboxHome,
        TMPDIR: sandboxHome,
        CI: '1',
        NODE_ENV: 'test',
        FREE_ONLY: 'false',
        npm_config_ignore_scripts: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).finally(() => clearTimeout(timeout));

    return {
      ok: !timedOut && exitCode === 0,
      kind,
      exitCode,
      timedOut,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await fs.rm(sandboxHome, { recursive: true, force: true });
  }
}