import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFile, chmod, unlink } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { sanitizePreEgress } from '../src/services/securitySanitizer.js';

const socketPath = process.env.ORIGIN_TRUSTED_VERIFIER_SOCKET ?? '';
const token = process.env.ORIGIN_TRUSTED_VERIFIER_TOKEN ?? '';
const workspace = process.env.ORIGIN_TRUSTED_VERIFIER_WORKSPACE ?? '';
const dependencyRoot = process.env.ORIGIN_TRUSTED_VERIFIER_DEPENDENCY_ROOT ?? '';
const journalPath = process.env.ORIGIN_TRUSTED_VERIFIER_JOURNAL ?? '';
const image = 'node:22-bookworm-slim';
const maxCalls = 4;
const maxOutputBytes = 32 * 1024;
const timeoutMs = 180_000;
const checks = ['typecheck', 'lint', 'test', 'build'] as const;
type CheckKind = (typeof checks)[number];

const commands: Record<CheckKind, string> = {
  typecheck: 'tsc --noEmit',
  lint: 'tsc --noEmit && node scripts/design-token-lock.js',
  test: "FREE_ONLY=false vitest run --configLoader runner --maxWorkers=2 --exclude 'tests/e2e/**' --exclude 'tests/api/**' --reporter=default",
  build: 'rm -rf /tmp/origin-dist && vite build --configLoader runner --outDir /tmp/origin-dist && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=/tmp/origin-dist/server.cjs',
};

if (
  !socketPath.startsWith('/')
  || !journalPath.startsWith('/')
  || !workspace.startsWith('/')
  || !dependencyRoot.startsWith('/')
  || !/^[a-f0-9]{64}$/.test(token)
) {
  console.error(JSON.stringify({ code: 'TRUSTED_VERIFIER_CONFIG_INVALID' }));
  process.exit(2);
}

function tokenMatches(actual: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual)) return false;
  const left = Buffer.from(token, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, 'utf8') >= maxOutputBytes) return current;
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') <= maxOutputBytes) return next;
  return Buffer.from(next, 'utf8').subarray(0, maxOutputBytes).toString('utf8') + '\n[OUTPUT_TRUNCATED]';
}

async function runCheck(kind: CheckKind) {
  const name = `origin-trusted-attempt-${kind}-${process.pid}-${Date.now()}`;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  const args = [
    'run', '--rm', '--name', name,
    '--network', 'none',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--user', `${uid}:${gid}`,
    '--pids-limit', '128',
    '--cpus', '2',
    '--memory', '3g',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777',
    '--mount', `type=bind,src=${workspace},dst=/work,readonly`,
    '--mount', `type=bind,src=${path.join(dependencyRoot, 'node_modules')},dst=/work/node_modules,readonly`,
    '--workdir', '/work',
    '--env', 'HOME=/tmp',
    '--env', 'CI=true',
    '--env', 'NODE_ENV=test',
    '--env', 'FREE_ONLY=false',
    '--env', 'ORIGIN_ISOLATED_VERIFY=true',
    '--env', 'PATH=/work/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    image, '/bin/sh', '-eu', '-c', commands[kind],
  ];
  const child = spawn('docker', args, {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/tmp' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let timedOut = false;
  child.stdout.on('data', chunk => { output = appendBounded(output, chunk); });
  child.stderr.on('data', chunk => { output = appendBounded(output, chunk); });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    spawn('docker', ['rm', '-f', name], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/tmp' },
      stdio: 'ignore',
    }).unref();
  }, timeoutMs);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  }).finally(() => clearTimeout(timer));
  const sanitized = sanitizePreEgress(output).replaceAll(workspace, '[workspace]').slice(0, 4096);
  return { kind, ok: !timedOut && exitCode === 0, exitCode, timedOut, diagnostic: sanitized };
}

let used = 0;
let active = false;
let stopping = false;
const server = createServer((req, res) => {
  void (async () => {
    if (req.method !== 'POST' || req.url !== '/verify') {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_VERIFIER_ROUTE_NOT_FOUND' }));
      return;
    }
    const auth = req.headers.authorization ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!tokenMatches(presented)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_VERIFIER_UNAUTHORIZED' }));
      return;
    }
    if (stopping) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_VERIFIER_STOPPING' }));
      return;
    }
    if (active) {
      res.writeHead(409, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_VERIFIER_BUSY' }));
      return;
    }
    if (used >= maxCalls) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_VERIFIER_BUDGET_EXHAUSTED' }));
      return;
    }

    active = true;
    const attempt = used++;
    try {
      const rows = [];
      for (const kind of checks) rows.push(await runCheck(kind));
      const publicRows = rows.map(({ kind, ok, exitCode, timedOut }) => ({ kind, ok, exitCode, timedOut }));
      await appendFile(journalPath, JSON.stringify({ attempt, checks: publicRows }) + '\n', { encoding: 'utf8', mode: 0o600 });

      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, attempt, checks: rows }));
    } finally {
      active = false;
    }
  })().catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, code: 'TRUSTED_VERIFIER_FATAL' }));
  });
});

server.maxConnections = 4;
server.keepAliveTimeout = 1_000;
server.headersTimeout = 5_000;
server.requestTimeout = 10_000;

await unlink(socketPath).catch(() => undefined);
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660).catch(() => undefined);
  process.stdout.write(JSON.stringify({ event: 'trusted-verifier-ready' }) + '\n');
});

const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    void unlink(socketPath).catch(() => undefined).finally(() => process.exit(0));
  });
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
