import http from 'node:http';

import express from 'express';

import { createWorldClassImageV16Router } from '../src/creative/worldClassImageV16Router.js';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`WORLD_CLASS_IMAGE_PREFLIGHT_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

async function main(): Promise<void> {
  const candidateSha = requiredEnv('ORIGIN_IMAGE_CANDIDATE_SHA').toLowerCase();
  requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  requiredEnv('CLOUDFLARE_API_TOKEN');
  if (!/^[a-f0-9]{40}$/.test(candidateSha)) {
    throw new Error('WORLD_CLASS_IMAGE_PREFLIGHT_CANDIDATE_SHA_INVALID');
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ORIGIN_IMAGE_WORLD_CLASS_ENABLED: 'true',
    ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
    ORIGIN_RELEASE_SHA: candidateSha,
    VERCEL_ENV: 'preview',
    NODE_ENV: 'test',
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(createWorldClassImageV16Router(env));

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('WORLD_CLASS_IMAGE_PREFLIGHT_BIND_FAILED');
    }
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/creative/v1.6/world-class/status`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (
      !body
      || body.evaluationReady !== true
      || body.primaryReady !== true
      || body.freeOnly !== true
      || body.costUsd !== 0
      || body.paidFallbackEnabled !== false
      || body.releaseSha !== candidateSha
      || body.provider !== 'cloudflare-workers-ai-free'
      || typeof body.model !== 'string'
    ) {
      throw new Error('WORLD_CLASS_IMAGE_PREFLIGHT_PROVIDER_NOT_READY');
    }
    process.stdout.write(JSON.stringify({
      event: 'world-class-image-preflight-ready',
      candidateSha,
      model: body.model,
      provider: body.provider,
      evaluationReady: true,
      freeOnly: true,
      totalCostUsd: 0,
      paidFallbackEnabled: false,
    }) + '\n');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  process.stderr.write((/^[A-Z0-9_:-]{3,200}$/.test(message)
    ? message
    : 'WORLD_CLASS_IMAGE_PREFLIGHT_FAILED') + '\n');
  process.exitCode = 1;
});
