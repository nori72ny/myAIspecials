import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const IMAGE = 'node:22-bookworm-slim';

async function runDocker(args: string[]): Promise<{ code: number | null; output: string }> {
  const child = spawn('docker', args, {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, output };
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'origin-trusted-socket-'));
const socketPath = path.join(directory, 'provider.sock');
let requests = 0;
const server = createServer((req, res) => {
  requests += 1;
  if (req.method !== 'POST' || req.url !== '/execute') {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

try {
  await unlink(socketPath).catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o660);
  await chmod(directory, 0o555);

  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  const probe = String.raw`
    const http = require('node:http');
    const socket = new Promise((resolve, reject) => {
      const req = http.request({
        socketPath: '/proxy/provider.sock',
        path: '/execute',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('socket-status'));
          const value = JSON.parse(body);
          if (value?.ok !== true) return reject(new Error('socket-body'));
          resolve(true);
        });
      });
      req.once('error', reject);
      req.end('{}');
    });
    const external = fetch('http://1.1.1.1', { signal: AbortSignal.timeout(1200) })
      .then(() => false)
      .catch(() => true);
    Promise.all([socket, external]).then(([, blocked]) => {
      if (!blocked) process.exit(3);
      process.stdout.write('TRUSTED_SOCKET_OK\n');
    }).catch(error => {
      process.stderr.write(String(error));
      process.exit(2);
    });
  `;

  const result = await runDocker([
    'run', '--rm',
    '--network', 'none',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--user', `${uid}:${gid}`,
    '--pids-limit', '64',
    '--memory', '256m',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m,mode=1777',
    '--mount', `type=bind,src=${directory},dst=/proxy,readonly`,
    IMAGE,
    'node', '-e', probe,
  ]);

  if (result.code !== 0 || !result.output.includes('TRUSTED_SOCKET_OK') || requests !== 1) {
    throw new Error('TRUSTED_SOCKET_ISOLATION_FAILED');
  }
  process.stdout.write('trusted unix-socket proxy reachable with container network disabled; external network blocked\n');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve())).catch(() => undefined);
  await chmod(directory, 0o700).catch(() => undefined);
  await unlink(socketPath).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
