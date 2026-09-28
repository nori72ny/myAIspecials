import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const image = 'node:22-bookworm-slim';
const candidateSha = process.env.AQ_CALIBRATION_CANDIDATE_SHA;
const candidateCheckout = path.resolve('candidate');
const outputPath = path.resolve('test-results/aq-runtime-calibration.json');
const prefix = 'ORIGIN_TRUSTED_ANSWER_RESULT ';
const answer = 'Public calibration response. This is a transport fixture, not a quality score.';
const rows = [];
const containers = new Set();
let root;
let server;
let requestCount = 0;
const report = {
  schemaVersion: 'origin.aq-runtime-calibration.v1',
  purpose: 'public-mock-only', qualityEvaluated: false, liveProviderCalled: false,
  candidateSha, stages: rows,
};
function run(command, args, timeoutMs = 90000) {
  return new Promise(resolve => {
    let output = '';
    let timedOut = false;
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH, HOME: root ?? os.tmpdir(), CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const capture = chunk => { output = (output + chunk.toString()).slice(-1048576); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);
    const finish = code => {
      clearTimeout(timer); clearTimeout(killTimer);
      resolve({ code, timedOut, output });
    };
    child.once('error', () => finish(null));
    child.once('close', finish);
  });
}
function diagnostic(output) {
  // Fixed labels only; never publish raw process output.
  if (/ERR_MODULE_NOT_FOUND|Cannot find module/.test(output)) return 'module-resolution';
  if (/EACCES|Permission denied/.test(output)) return 'filesystem-permission';
  if (/ERR_UNKNOWN_FILE_EXTENSION/.test(output)) return 'typescript-loader';
  if (/SyntaxError/.test(output)) return 'syntax';
  if (/FREE_MODEL_EVIDENCE_STALE/.test(output)) return 'catalog-expired';
  if (/TRUSTED_ANSWER_CANDIDATE_FATAL/.test(output)) return 'candidate-fatal';
  return 'unclassified';
}
async function stage(name, args, accept) {
  const result = await run('docker', args);
  const ok = result.code === 0 && !result.timedOut && accept(result.output);
  rows.push({ stage: name, ok, exitCode: result.code, timedOut: result.timedOut,
    diagnostic: ok ? 'none' : diagnostic(result.output) });
  if (!ok) throw new Error('CALIBRATION_STAGE_FAILED');
}
function dockerArgs(extraEnv = []) {
  const name = 'origin-aq-calibration-' + randomUUID();
  containers.add(name);
  return ['run', '--rm', '--name', name, '--network', 'none', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--read-only',
    '--user', process.getuid() + ':' + process.getgid(),
    '--pids-limit', '128', '--cpus', '2', '--memory', '2g',
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777',
    '--mount', 'type=bind,src=' + path.join(root, 'candidate') + ',dst=/work,readonly',
    '--mount', 'type=bind,src=' + path.resolve('node_modules') + ',dst=/work/node_modules,readonly',
    '--mount', 'type=bind,src=' + path.join(root, 'trusted') + ',dst=/trusted,readonly',
    '--mount', 'type=bind,src=' + path.join(root, 'socket') + ',dst=/trusted-socket,readonly',
    '--workdir', '/work', '--env', 'HOME=/tmp', '--env', 'CI=true', '--env', 'NODE_ENV=test',
    ...extraEnv.flatMap(value => ['--env', value]), image];
}
async function main() {
  if (!/^[a-f0-9]{40}$/.test(candidateSha ?? '')) throw new Error('INVALID_SHA');
  // No credentials, sealed corpus, DB, ledger or real provider are used.
  for (const name of ['OPENROUTER_API_KEY', 'POSTGRES_URL', 'ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64']) {
    if (process.env[name]) throw new Error('UNEXPECTED_SECRET');
  }
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aq-public-calibration-'));
  for (const dir of ['candidate', 'trusted', 'socket']) await fs.mkdir(path.join(root, dir), { mode: 0o700 });
  const actual = await run('git', ['-C', candidateCheckout, 'rev-parse', 'HEAD']);
  if (actual.code !== 0 || actual.output.trim() !== candidateSha) throw new Error('SHA_MISMATCH');
  const evaluator = await run('git', ['rev-parse', 'HEAD']);
  report.evaluatorSha = evaluator.output.trim();
  const archive = path.join(root, 'candidate.tar');
  const archived = await run('git', ['-C', candidateCheckout, 'archive', '--format=tar', 'HEAD', '-o', archive]);
  if (archived.code !== 0) throw new Error('ARCHIVE_FAILED');
  const extracted = await run('tar', ['-xf', archive, '-C', path.join(root, 'candidate'), '--no-same-owner', '--no-same-permissions']);
  if (extracted.code !== 0) throw new Error('ARCHIVE_FAILED');
  await fs.copyFile('scripts/trusted-answer-candidate-runner-v2.ts', path.join(root, 'trusted', 'trusted-answer-candidate-runner-v2.ts'));
  await fs.writeFile(path.join(root, 'trusted', 'loader-probe.ts'), "const value: string = 'AQ_LOADER_READY'; console.log(value);\n");
  await fs.writeFile(path.join(root, 'trusted', 'dependency-probe.ts'), [
    "import { createRequire } from 'node:module';",
    "const require = createRequire('/work/package.json');",
    "require('express'); require('supertest');",
    "import('/work/src/legacy/originChatRouter.ts').then(m => {",
    " if(typeof m.createOriginChatRouter !== 'function') process.exit(2);",
    " console.log('AQ_DEPENDENCIES_READY');",
    "}).catch(() => process.exit(2));",
  ].join('\n'));
  const identity = await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  if (identity.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(identity.output.trim())) throw new Error('IMAGE_MISSING');
  report.imageId = identity.output.trim();
  await stage('runtime', [...dockerArgs(), 'node', '-e', "console.log('AQ_RUNTIME_READY')"], value => value.includes('AQ_RUNTIME_READY'));
  await stage('loader', [...dockerArgs(), 'node', '--import', 'tsx', '/trusted/loader-probe.ts'], value => value.includes('AQ_LOADER_READY'));
  await stage('dependencies', [...dockerArgs(), 'node', '--import', 'tsx', '/trusted/dependency-probe.ts'], value => value.includes('AQ_DEPENDENCIES_READY'));

  const token = randomBytes(32).toString('hex');
  server = createServer((req, res) => {
    const reject = () => { res.writeHead(400); res.end(); };
    if (req.method !== 'POST' || req.url !== '/execute' || req.headers.authorization !== 'Bearer ' + token) return reject();
    let bytes = 0; let body = '';
    req.on('data', chunk => { bytes += chunk.length; if (bytes > 131072) req.destroy(); else body += chunk; });
    req.on('end', () => {
      requestCount++;
      if (requestCount !== 1) return reject();
      try {
        const value = JSON.parse(body);
        if (!value.plan?.modelId || !Array.isArray(value.messages)) return reject();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, result: {
          text: answer, actualCostUsd: 0, usage: { costUsd: 0 },
          providerDataPolicy: value.plan.providerDataPolicy,
          routingEvidence: { requestedModel: value.plan.modelId, servedModel: value.plan.modelId,
            strategy: 'adaptive-primary', provider: 'OpenRouter', attempt: 1, fallbackUsed: false },
        } }));
      } catch { reject(); }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path.join(root, 'socket', 'provider.sock'), resolve);
  });
  const lease = { schemaVersion: 'origin.answer-case-lease-candidate.v2',
    leaseId: '0'.repeat(32), prompt: 'Explain why leaves are green in one sentence.' };
  const env = [
    'ORIGIN_CANDIDATE_ROOT=/work',
    'ORIGIN_AQ_V2_CASE_LEASE_B64=' + Buffer.from(JSON.stringify(lease)).toString('base64'),
    'ORIGIN_TRUSTED_ANSWER_PROVIDER_SOCKET=/trusted-socket/provider.sock',
    'ORIGIN_TRUSTED_ANSWER_PROVIDER_TOKEN=' + token,
  ];
  await stage('mock-transport', [...dockerArgs(env), 'node', '--import', 'tsx', '/trusted/trusted-answer-candidate-runner-v2.ts'], output => {
    try {
      const index = output.lastIndexOf(prefix);
      if (index < 0) return false;
      const value = JSON.parse(output.slice(index + prefix.length).split('\n')[0]);
      return value.schemaVersion === 'origin.trusted-answer-candidate-result.v2'
        && value.httpStatus === 200 && value.leaseId === lease.leaseId
        && value.content === answer && requestCount === 1;
    } catch { return false; }
  });
}
try {
  await main();
  report.ok = true;
} catch {
  report.ok = false;
  process.exitCode = 1;
} finally {
  for (const name of containers) await run('docker', ['rm', '-f', name], 15000);
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
  report.mockRequests = requestCount;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
