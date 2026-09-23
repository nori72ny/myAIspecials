import { createServer } from 'node:http';
import { chmod, unlink } from 'node:fs/promises';
import {
  createTrustedCandidateProviderBoundaryV15,
  publicTrustedProviderErrorV15,
} from '../src/release/OriginTrustedCandidateProviderProxyV15.js';
import {
  assertOriginZeroCostExecutionResult,
  executeOriginProvider,
  type OriginProviderExecutionRequest,
} from '../src/legacy/originProviderClient.js';

const socketPath = process.env.ORIGIN_TRUSTED_PROVIDER_SOCKET ?? '';
const token = process.env.ORIGIN_TRUSTED_PROVIDER_TOKEN ?? '';
const apiKey = process.env.OPENROUTER_API_KEY ?? '';

if (!socketPath.startsWith('/') || !/^[a-f0-9]{64}$/.test(token) || !apiKey) {
  console.error(JSON.stringify({ code: 'TRUSTED_PROVIDER_PROXY_CONFIG_INVALID' }));
  process.exit(2);
}

const boundary = createTrustedCandidateProviderBoundaryV15({
  token,
  execute: async (request: OriginProviderExecutionRequest) => {
    const result = await executeOriginProvider(request, {
      OPENROUTER_API_KEY: apiKey,
      FREE_ONLY: 'true',
    });
    assertOriginZeroCostExecutionResult(result, request.plan.modelId, request.plan.providerId);
    return result;
  },
});

let stopping = false;
const server = createServer((req, res) => {
  void (async () => {
    if (req.method !== 'POST' || req.url !== '/execute') {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_PROVIDER_ROUTE_NOT_FOUND' }));
      return;
    }
    if (stopping) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_PROVIDER_STOPPING' }));
      return;
    }

    const authorization = req.headers.authorization ?? '';
    const presented = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!/^[a-f0-9]{64}$/.test(presented)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_PROVIDER_UNAUTHORIZED' }));
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 384 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, code: 'TRUSTED_PROVIDER_REQUEST_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    }

    let payload: unknown;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, code: 'TRUSTED_PROVIDER_JSON_INVALID' }));
      return;
    }

    try {
      const result = await boundary.execute(presented, payload);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      const safe = publicTrustedProviderErrorV15(error);
      res.writeHead(safe.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, ...safe }));
    }
  })().catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, code: 'TRUSTED_PROVIDER_PROXY_FATAL' }));
  });
});

server.maxConnections = 8;
server.keepAliveTimeout = 1_000;
server.headersTimeout = 5_000;
server.requestTimeout = 10_000;

await unlink(socketPath).catch(() => undefined);
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660).catch(() => undefined);
  process.stdout.write(JSON.stringify({ event: 'trusted-provider-ready' }) + '\n');
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
