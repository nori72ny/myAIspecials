import { request as httpRequest } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RESULT_PREFIX = 'ORIGIN_TRUSTED_CANDIDATE_RESULT ';
const MAX_OUTPUT_BYTES = 32 * 1024;

type VisiblePacket = {
  id: string;
  baseSha: string;
  requiredChangedPaths: string[];
  goal: string;
};

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, 'utf8') >= MAX_OUTPUT_BYTES) return current;
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') <= MAX_OUTPUT_BYTES) return next;
  return Buffer.from(next, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + '\n[OUTPUT_TRUNCATED]';
}

function safePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..')
    && !value.includes('\0');
}

function parseVisiblePacket(): VisiblePacket {
  const encoded = process.env.ORIGIN_VISIBLE_PACKET_B64 ?? '';
  if (!encoded || encoded.length > 64 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('TRUSTED_CANDIDATE_VISIBLE_PACKET_INVALID');
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
  catch { throw new Error('TRUSTED_CANDIDATE_VISIBLE_PACKET_INVALID'); }
  if (!value || typeof value !== 'object') throw new Error('TRUSTED_CANDIDATE_VISIBLE_PACKET_INVALID');
  const packet = value as VisiblePacket;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(packet.id)) throw new Error('TRUSTED_CANDIDATE_VISIBLE_PACKET_INVALID');
  if (!/^[a-f0-9]{40}$/.test(packet.baseSha)) throw new Error('TRUSTED_CANDIDATE_VISIBLE_PACKET_INVALID');
  if (!Array.isArray(packet.requiredChangedPaths) || packet.requiredChangedPaths.length < 2 || packet.requiredChangedPaths.length > 12 || !packet.requiredChangedPaths.every(safePath)) throw new Error('TRUSTED_CANDIDATE_VISIBLE_PACKET_INVALID');
  if (typeof packet.goal !== 'string' || !packet.goal.trim() || packet.goal.length > 4000) throw new Error('TRUSTED_CANDIDATE_VISIBLE_PACKET_INVALID');
  return packet;
}

async function proxyExecute(rawRequest: unknown): Promise<any> {
  const socketPath = process.env.ORIGIN_PROVIDER_PROXY_SOCKET ?? '';
  const token = process.env.ORIGIN_PROVIDER_PROXY_TOKEN ?? '';
  if (!socketPath.startsWith('/') || !/^[a-f0-9]{64}$/.test(token)) throw new Error('TRUSTED_PROVIDER_PROXY_UNAVAILABLE');

  const body = JSON.stringify(rawRequest);
  if (Buffer.byteLength(body, 'utf8') > 384 * 1024) throw new Error('TRUSTED_PROVIDER_REQUEST_TOO_LARGE');

  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({
      socketPath,
      path: '/execute',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60_000,
    }, res => {
      let output = '';
      res.on('data', chunk => { output = appendBounded(output, chunk); });
      res.on('end', () => resolve({ status: res.statusCode ?? 500, body: output }));
    });
    req.once('timeout', () => req.destroy(new Error('TRUSTED_PROVIDER_PROXY_TIMEOUT')));
    req.once('error', reject);
    req.end(body);
  });

  let parsed: any;
  try { parsed = JSON.parse(response.body); }
  catch { throw new Error('TRUSTED_PROVIDER_PROXY_RESPONSE_INVALID'); }
  if (response.status !== 200 || parsed?.ok !== true || !parsed.result) {
    const code = typeof parsed?.code === 'string' && /^(?:PROVIDER|TRUSTED_PROVIDER)_[A-Z0-9_:-]+$/.test(parsed.code)
      ? parsed.code
      : 'TRUSTED_PROVIDER_PROXY_EXECUTION_FAILED';
    throw Object.assign(new Error(code), { code, status: response.status });
  }
  return parsed.result;
}

async function proxyVerify(): Promise<Array<{ kind: 'typecheck' | 'lint' | 'test' | 'build'; ok: boolean; exitCode: number | null; timedOut: boolean; diagnostic?: string }>> {
  const socketPath = process.env.ORIGIN_VERIFIER_PROXY_SOCKET ?? '';
  const token = process.env.ORIGIN_VERIFIER_PROXY_TOKEN ?? '';
  if (!socketPath.startsWith('/') || !/^[a-f0-9]{64}$/.test(token)) throw new Error('TRUSTED_VERIFIER_PROXY_UNAVAILABLE');

  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({
      socketPath,
      path: '/verify',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' },
      timeout: 720_000,
    }, res => {
      let output = '';
      res.on('data', chunk => { output = appendBounded(output, chunk); });
      res.on('end', () => resolve({ status: res.statusCode ?? 500, body: output }));
    });
    req.once('timeout', () => req.destroy(new Error('TRUSTED_VERIFIER_PROXY_TIMEOUT')));
    req.once('error', reject);
    req.end();
  });

  let value: any;
  try { value = JSON.parse(response.body); }
  catch { throw new Error('TRUSTED_VERIFIER_PROXY_RESPONSE_INVALID'); }
  if (response.status !== 200 || value?.ok !== true || !Array.isArray(value.checks) || value.checks.length !== 4) {
    const code = typeof value?.code === 'string' && /^TRUSTED_VERIFIER_[A-Z0-9_:-]+$/.test(value.code)
      ? value.code
      : 'TRUSTED_VERIFIER_PROXY_EXECUTION_FAILED';
    throw new Error(code);
  }
  return value.checks;
}

async function main(): Promise<void> {
  const packet = parseVisiblePacket();
  const root = await fs.realpath('/work');
  const allowedPaths: string[] = [];
  const creatablePaths: string[] = [];

  for (const relative of packet.requiredChangedPaths) {
    const target = path.join(root, relative);
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('TRUSTED_CANDIDATE_SCOPE_INVALID');
      allowedPaths.push(relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') creatablePaths.push(relative);
      else throw error;
    }
  }

  const candidateModule = await import(pathToFileURL(path.join(root, 'src/agent/codingAgentV14.ts')).href);
  if (typeof candidateModule.runCodingAgentV14 !== 'function') throw new Error('TRUSTED_CANDIDATE_AGENT_ENTRYPOINT_MISSING');

  const startedAt = Date.now();
  const session = await candidateModule.runCodingAgentV14({
    goal: packet.goal,
    root,
    allowedPaths,
    creatablePaths,
    trustedWorkspaceApproved: true,
    maxRepairs: 3,
  }, {
    verify: async () => proxyVerify(),
    plannerOptions: {
      env: { OPENROUTER_API_KEY: 'trusted-proxy-only', FREE_ONLY: 'true' },
      execute: proxyExecute,
    },
  });

  process.stdout.write(RESULT_PREFIX + JSON.stringify({
    schemaVersion: 'origin-trusted-candidate-agent-result-v1',
    taskId: packet.id,
    candidateSha: packet.baseSha,
    durationMs: Date.now() - startedAt,
    session,
  }) + '\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const code = /^(?:CODING|PROVIDER|TRUSTED)_[A-Z0-9_:-]+$/.test(message)
    ? message
    : 'TRUSTED_CANDIDATE_AGENT_FATAL';
  process.stdout.write(RESULT_PREFIX + JSON.stringify({
    schemaVersion: 'origin-trusted-candidate-agent-result-v1',
    error: code,
  }) + '\n');
  process.exitCode = 1;
});
