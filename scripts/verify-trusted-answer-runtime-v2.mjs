import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Public bootstrap calibration only: no sealed corpus, provider, database or ledger.
const root = mkdtempSync(path.join(tmpdir(), 'origin-aq-bootstrap-'));
const work = path.join(root, 'work');
const trusted = path.join(root, 'trusted');
const container = `origin-aq-bootstrap-${randomUUID()}`;
const cleanEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root };
try {
  mkdirSync(work, { mode: 0o700 });
  mkdirSync(trusted, { mode: 0o700 });
  writeFileSync(path.join(work, 'package.json'), '{"type":"module"}\n');
  copyFileSync('scripts/trusted-answer-candidate-runner-v2.ts', path.join(trusted, 'trusted-answer-candidate-runner-v2.ts'));
  const args = [
    'run', '--rm', '--name', container,
    '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--read-only', '--user', `${process.getuid()}:${process.getgid()}`,
    '--pids-limit', '128', '--cpus', '2', '--memory', '2g',
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777',
    '--mount', `type=bind,src=${work},dst=/work,readonly`,
    '--mount', `type=bind,src=${path.resolve('node_modules')},dst=/work/node_modules,readonly`,
    '--mount', `type=bind,src=${trusted},dst=/trusted,readonly`,
    '--workdir', '/work', '--env', 'HOME=/tmp', '--env', 'CI=true',
    'node:22-bookworm-slim',
    'node', '--import', 'tsx', '/trusted/trusted-answer-candidate-runner-v2.ts',
  ];
  const result = spawnSync('docker', args, {
    env: cleanEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const expected = 'TRUSTED_ANSWER_CASE_LEASE_INVALID';
  const envelope = output.split('\n').find(line => line.startsWith('ORIGIN_TRUSTED_ANSWER_RESULT '));
  let parsed;
  try { parsed = JSON.parse(envelope?.slice('ORIGIN_TRUSTED_ANSWER_RESULT '.length) ?? ''); } catch { /* fail below */ }
  if (result.status !== 1 || parsed?.error !== expected || parsed?.schemaVersion !== 'origin.trusted-answer-candidate-result.v2') {
    // Only fixed classifications are emitted, never raw child output.
    const diagnostic = output.includes('ERR_MODULE_NOT_FOUND') ? 'MODULE_NOT_FOUND'
      : output.includes('ERR_UNKNOWN_FILE_EXTENSION') ? 'UNKNOWN_FILE_EXTENSION'
      : output.includes('Permission denied') ? 'PERMISSION_DENIED'
      : result.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'RUNNER_ENVELOPE_MISSING';
    console.error(JSON.stringify({ event: 'aq-v2-bootstrap-failed', diagnostic, exitCode: result.status }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ event: 'aq-v2-bootstrap-passed', providerRequests: 0, sealedCorpusRead: false, ledgerReserved: false }));
  }
} finally {
  spawnSync('docker', ['rm', '-f', container], { env: cleanEnv, stdio: 'ignore', timeout: 15000 });
  rmSync(root, { recursive: true, force: true });
}
