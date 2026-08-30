import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const outputDir = mkdtempSync(join(tmpdir(), 'origin-api-esm-'));
let server;

function fail(message) {
  throw new Error(`[api-node-esm] ${message}`);
}

async function request(port, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, text, json };
}

try {
  const tscArgs = [
    'api/index.ts',
    '--outDir', outputDir,
    '--rootDir', repoRoot,
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    '--esModuleInterop',
    '--skipLibCheck',
    '--noEmitOnError', 'false',
    '--pretty', 'false',
  ];

  let compileOutput = '';
  try {
    compileOutput = execFileSync('npx', ['--no-install', 'tsc', ...tscArgs], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    compileOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  const ts2835 = compileOutput
    .split(/\r?\n/)
    .filter((line) => line.includes('TS2835'));
  if (ts2835.length) {
    console.error(compileOutput.trim());
    fail(`NodeNext still reports extensionless relative imports (${ts2835.length} TS2835 diagnostics).`);
  }

  const handlerModule = await import(join(outputDir, 'api/index.js'));
  if (typeof handlerModule.default !== 'function') fail('Compiled api/index.js did not expose the Vercel handler.');

  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;

  server = createServer((request, response) => {
    Promise.resolve(handlerModule.default(request, response)).catch((error) => {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ error: String(error?.message ?? error) }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  const health = await request(port, 'GET', '/api/health');
  if (health.status !== 200 || health.json?.status !== 'ok') {
    fail(`/api/health expected HTTP 200/status=ok, got HTTP ${health.status}: ${health.text}`);
  }

  const chat = await request(port, 'POST', '/api/chat', {
    messages: [{ role: 'user', content: 'serverless ESM smoke test' }],
  });
  if (chat.status === 500 && chat.json?.code === 'ORIGIN_FUNCTION_INIT_FAILED') {
    fail('/api/chat still reaches the initialization-failure boundary.');
  }
  if (chat.status !== 503 || chat.json?.code !== 'FREE_PROVIDER_NOT_CONFIGURED') {
    fail(`/api/chat expected fail-closed HTTP 503/FREE_PROVIDER_NOT_CONFIGURED in the no-provider smoke environment, got HTTP ${chat.status}: ${chat.text}`);
  }

  console.log('[api-node-esm] PASS');
  console.log(`[api-node-esm] /api/health -> HTTP ${health.status}, status=${health.json.status}`);
  console.log(`[api-node-esm] /api/chat -> HTTP ${chat.status}, code=${chat.json.code}`);
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(outputDir, { recursive: true, force: true });
}
