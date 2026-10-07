// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { isCloudflareRasterProviderIdV15 } from '../creative/rasterProviderIdentityV15';

const runner = readFileSync('scripts/run-image-edit-private-heldout-v1.ts', 'utf8');
const functions = runner.slice(runner.indexOf('function requiredEnv('), runner.indexOf('async function main():'));
const executable = stripTypeScriptTypes(functions) + '\nevaluateEditCase;';
const bytes = Buffer.from('synthetic test bytes: not a generated image');
const digest = createHash('sha256').update(bytes).digest('hex');

async function evaluate(provider: string, options: { same?: boolean; structure?: boolean; digest?: string; paid?: boolean } = {}) {
  const writes: unknown[] = [];
  const headers = {
    'content-type': 'image/png',
    'x-origin-visual-verified': 'true',
    'x-origin-visual-sha256': options.digest ?? digest,
    'x-origin-visual-task': 'edit',
    'x-origin-visual-reference-count': '1',
    'x-origin-free-only': 'true',
    'x-origin-cost-usd': '0',
    'x-origin-paid-fallback': options.paid ? 'true' : 'false',
    'x-origin-secret-delivery': 'server-only',
    'x-origin-visual-provider': provider,
    'x-origin-visual-model': 'test-model',
  };
  // These doubles isolate evidence classification, not image quality or live generation.
  const run = runInNewContext(executable, {
    createHash, Buffer, Date, AbortSignal,
    MAX_OUTPUT_BYTES: 12 * 1024 * 1024,
    EMPTY_SHA256: createHash('sha256').update('').digest('hex'),
    isCloudflareRasterProviderIdV15,
    fetch: async () => new Response(bytes, { headers }),
    readRasterDimensionsV15: () => ({ width: 384, height: 384 }),
    critiqueRasterStructureV15: () => ({ passed: options.structure !== false }),
    fs: { writeFile: async (...args: unknown[]) => { writes.push(args); } },
    path: { join: (...parts: string[]) => parts.join('/') },
  });
  const result = await run('http://127.0.0.1', {
    caseId: 'diagnostic-1', family: 'test', turnIndex: 1,
    instruction: 'change background', instructionSha256: 'a'.repeat(64),
    sourceImageDataUrl: 'data:image/png;base64,AA==',
    sourceImageSha256: options.same ? digest : 'b'.repeat(64),
    width: 384, height: 384,
  }, 0, 10000, '/test-output');
  return { result, writes };
}

describe('image edit evidence classification', () => {
  for (const provider of ['cloudflare-workers-ai-free', 'cloudflare-workers-ai-gateway']) {
    it('accepts qualified delivery from ' + provider, async () => {
      const { result, writes } = await evaluate(provider);
      assert.equal(result.executionStatus, 'completed');
      assert.equal(result.deliveryIntegrityPassed, true);
      assert.equal(result.failureCode, null);
      assert.equal(writes.length, 1);
    });
  }
  for (const provider of ['unknown-provider', 'pollinations-zero-cost', 'cloudflare-workers-ai-gateway-paid', '']) {
    it('rejects unapproved provider ' + provider, async () => {
      const { result, writes } = await evaluate(provider);
      assert.equal(result.executionStatus, 'failed');
      assert.equal(result.deliveryIntegrityPassed, false);
      assert.equal(writes.length, 0);
    });
  }
  for (const options of [{ same: true }, { structure: false }, { digest: '0'.repeat(64) }, { paid: true }]) {
    it('does not count invalid HTTP 200 output as completed: ' + JSON.stringify(options), async () => {
      const { result, writes } = await evaluate('cloudflare-workers-ai-gateway', options);
      assert.equal(result.executionStatus, 'failed');
      assert.notEqual(result.failureCode, null);
      assert.equal(writes.length, 0);
    });
  }
});
