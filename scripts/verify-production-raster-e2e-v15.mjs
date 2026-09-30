import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const DEFAULT_PRODUCTION_URL = 'https://origin-personal.vercel.app';
const EXPECTED_PROVIDER = 'cloudflare-workers-ai-free';
const EXPECTED_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const WIDTH = 512;
const HEIGHT = 512;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function safeJson(response, code) {
  return response.json().catch(() => {
    throw new Error(code);
  });
}

function imageMime(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function dimensions(bytes, mime) {
  if (mime === 'image/png' && bytes.length >= 24) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (mime === 'image/jpeg') {
    const sofMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (sofMarkers.has(marker) && length >= 7) {
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += length;
    }
    return null;
  }
  if (mime === 'image/webp' && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') {
      const width = 1 + bytes.readUIntLE(24, 3);
      const height = 1 + bytes.readUIntLE(27, 3);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
      const width = 1 + b1 + ((b2 & 0x3f) << 8);
      const height = 1 + ((b2 >> 6) & 0x03) + (b3 << 2) + ((b4 & 0x0f) << 10);
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  return null;
}

async function request(url, init = {}, timeoutMs = 20_000) {
  return fetch(url, {
    ...init,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function main() {
  const productionUrl = (process.env.ORIGIN_PRODUCTION_URL || DEFAULT_PRODUCTION_URL).replace(/\/+$/, '');
  const expectedSha = (process.env.EXPECTED_SHA || '').trim();

  invariant(productionUrl === DEFAULT_PRODUCTION_URL, 'RASTER_E2E_PRODUCTION_URL_INVALID');
  invariant(/^[a-f0-9]{40}$/.test(expectedSha), 'RASTER_E2E_EXPECTED_SHA_INVALID');

  const healthResponse = await request(`${productionUrl}/api/health`);
  invariant(healthResponse.status === 200, 'RASTER_E2E_HEALTH_NOT_200');
  const health = await safeJson(healthResponse, 'RASTER_E2E_HEALTH_JSON_INVALID');
  invariant(health.releaseSha === expectedSha, 'RASTER_E2E_RELEASE_SHA_MISMATCH');
  invariant(health.freeOnly === true, 'RASTER_E2E_HEALTH_NOT_FREE_ONLY');
  invariant(Number(health.costUsd) === 0, 'RASTER_E2E_HEALTH_COST_NONZERO');
  invariant(health.paidFallbackEnabled === false, 'RASTER_E2E_HEALTH_PAID_FALLBACK');
  invariant(health.secretDelivery === 'server-only', 'RASTER_E2E_HEALTH_SECRET_BOUNDARY_INVALID');

  const statusResponse = await request(`${productionUrl}/api/creative/v1.5/raster/status`);
  const status = await safeJson(statusResponse, 'RASTER_E2E_STATUS_JSON_INVALID');
  if (statusResponse.status !== 200) {
    const reason = typeof status?.reason === 'string' ? status.reason : 'RASTER_RUNTIME_NOT_READY';
    throw new Error(`RASTER_E2E_STATUS_NOT_READY:${reason}`);
  }
  invariant(status.ok === true && status.ready === true && status.configured === true, 'RASTER_E2E_STATUS_NOT_READY');
  invariant(status.providerId === EXPECTED_PROVIDER, 'RASTER_E2E_PROVIDER_MISMATCH');
  invariant(status.model === EXPECTED_MODEL, 'RASTER_E2E_MODEL_MISMATCH');
  invariant(status.zeroCostVerified === true, 'RASTER_E2E_ZERO_COST_UNVERIFIED');
  invariant(status.paymentMethodRequired === false, 'RASTER_E2E_PAYMENT_METHOD_REQUIRED');
  invariant(status.freeOnly === true && Number(status.costUsd) === 0, 'RASTER_E2E_STATUS_COST_NONZERO');
  invariant(status.paidFallbackEnabled === false, 'RASTER_E2E_STATUS_PAID_FALLBACK');
  invariant(status.secretDelivery === 'server-only', 'RASTER_E2E_STATUS_SECRET_BOUNDARY_INVALID');
  invariant(status.semanticVisionCritic?.enabled === false, 'RASTER_E2E_SEMANTIC_GATE_PREMATURELY_ENABLED');

  const generateResponse = await request(`${productionUrl}/api/generate-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'image/png,image/jpeg,image/webp,application/json',
    },
    body: JSON.stringify({
      prompt: 'A single matte white ceramic cup centered on a plain light gray studio background, soft daylight, realistic product photograph, no text, square composition.',
      width: WIDTH,
      height: HEIGHT,
    }),
  }, 60_000);

  if (generateResponse.status !== 200) {
    let code = 'RASTER_E2E_GENERATION_FAILED';
    try {
      const body = await generateResponse.json();
      if (typeof body?.code === 'string') code = body.code;
    } catch {}
    throw new Error(`RASTER_E2E_GENERATION_NOT_200:${code}`);
  }

  const raw = Buffer.from(await generateResponse.arrayBuffer());
  invariant(raw.length >= 64 && raw.length <= MAX_IMAGE_BYTES, 'RASTER_E2E_IMAGE_SIZE_INVALID');

  const mimeType = imageMime(raw);
  invariant(Boolean(mimeType), 'RASTER_E2E_IMAGE_SIGNATURE_INVALID');
  const actual = dimensions(raw, mimeType);
  invariant(actual?.width === WIDTH && actual?.height === HEIGHT, 'RASTER_E2E_IMAGE_DIMENSION_MISMATCH');

  const headers = generateResponse.headers;
  invariant(headers.get('x-origin-visual-verified') === 'true', 'RASTER_E2E_VISUAL_NOT_VERIFIED');
  invariant(headers.get('x-origin-visual-provider') === EXPECTED_PROVIDER, 'RASTER_E2E_HEADER_PROVIDER_MISMATCH');
  invariant(headers.get('x-origin-visual-model') === EXPECTED_MODEL, 'RASTER_E2E_HEADER_MODEL_MISMATCH');
  invariant(headers.get('x-origin-free-only') === 'true', 'RASTER_E2E_HEADER_NOT_FREE_ONLY');
  invariant(headers.get('x-origin-cost-usd') === '0', 'RASTER_E2E_HEADER_COST_NONZERO');
  invariant(headers.get('x-origin-paid-fallback') === 'false', 'RASTER_E2E_HEADER_PAID_FALLBACK');
  invariant(headers.get('x-origin-secret-delivery') === 'server-only', 'RASTER_E2E_HEADER_SECRET_BOUNDARY_INVALID');
  invariant(headers.get('x-origin-visual-semantic-gate') === 'disabled', 'RASTER_E2E_SEMANTIC_GATE_PREMATURELY_ENABLED');
  invariant(headers.get('x-origin-visual-width') === String(WIDTH), 'RASTER_E2E_HEADER_WIDTH_MISMATCH');
  invariant(headers.get('x-origin-visual-height') === String(HEIGHT), 'RASTER_E2E_HEADER_HEIGHT_MISMATCH');
  invariant(headers.get('x-origin-visual-actual-width') === String(WIDTH), 'RASTER_E2E_ACTUAL_WIDTH_MISMATCH');
  invariant(headers.get('x-origin-visual-actual-height') === String(HEIGHT), 'RASTER_E2E_ACTUAL_HEIGHT_MISMATCH');

  const networkRequests = Number(headers.get('x-origin-external-network-requests'));
  invariant(Number.isInteger(networkRequests) && networkRequests === 4, 'RASTER_E2E_NETWORK_REQUEST_COUNT_INVALID');

  const imageSha256 = createHash('sha256').update(raw).digest('hex');
  invariant(headers.get('x-origin-visual-sha256') === imageSha256, 'RASTER_E2E_SHA256_MISMATCH');

  // Persist only normalized/local evidence after all network-derived values have
  // been verified above. Raw provider output, image bytes, response text and
  // network-derived hashes are intentionally not written to disk.
  const evidence = {
    schemaVersion: 'origin.production-raster-e2e.v1',
    status: 'passed',
    testedAt: new Date().toISOString(),
    productionUrl: DEFAULT_PRODUCTION_URL,
    candidateSha: expectedSha,
    releaseShaVerified: true,
    providerId: EXPECTED_PROVIDER,
    model: EXPECTED_MODEL,
    freeOnly: true,
    costUsd: 0,
    paidFallbackEnabled: false,
    secretDelivery: 'server-only',
    semanticDeliveryGate: 'disabled',
    externalNetworkRequests: 4,
    imageSignatureVerified: true,
    imageDimensionsVerified: true,
    imageSha256Verified: true,
    width: WIDTH,
    height: HEIGHT,
  };

  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/origin-production-raster-e2e.json', JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(evidence));
}

main().catch((error) => {
  const code = error instanceof Error ? error.message : 'RASTER_E2E_UNKNOWN_FAILURE';
  console.error(`[raster-production-e2e] ${code}`);
  process.exitCode = 1;
});
