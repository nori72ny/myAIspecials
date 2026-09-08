import { afterEach, expect, it, vi } from 'vitest';
import { verifyProductionDeployment, verifyLiveChat } from './verify-production-deployment.mjs';

afterEach(() => vi.unstubAllGlobals());

const encoder = new TextEncoder();
function verifiedStreamResponse() {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('ORIGIN-CONTEXT-42\nSTREAM-CHECK\nSTREAM-CHECK\nSTREAM-CHECK\nSTREAM-CHECK\n'));
      controller.enqueue(encoder.encode('STREAM-CHECK\nSTREAM-CHECK\nSTREAM-CHECK\nSTREAM-CHECK\n'));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-origin-stream-source': 'upstream',
      'x-origin-stream-protocol': 'origin-text-delta-v1',
      'x-origin-free-only': 'true',
      'x-origin-cost-usd': '0',
      'x-origin-billing-tier': 'free',
      'x-origin-model-id': 'inclusionai/ling-3.0-flash-sante:free',
      'x-vercel-id': 'synthetic-vercel-id',
    },
  });
}

it('accepts a genuine upstream multi-chunk response that proves multi-turn context', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => verifiedStreamResponse()));
  const result = await verifyLiveChat('https://example.com', 1000);
  expect(result).toMatchObject({ status: 200, streamSource: 'upstream', contextVerified: true, streamChunkCount: 2 });
});

it('rejects a post-completion-style response that does not identify genuine upstream streaming', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ORIGIN-CONTEXT-42\nSTREAM-CHECK\n'.repeat(8), { headers: { 'content-type': 'text/plain' } })));
  await expect(verifyLiveChat('https://example.com', 1000)).rejects.toThrow('stream source as upstream provider deltas');
});

it('does not repeat inference when health matches but the chat fails', async () => {
  const sha = 'a'.repeat(40);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ status: 'ok', service: 'acos-2', releaseSha: sha }))
    .mockResolvedValueOnce(new Response('<title>ORIGIN Personal</title>', { headers: { 'content-type': 'text/html' } }))
    .mockResolvedValueOnce(Response.json({ code: 'PROVIDER_UNAVAILABLE', message: 'private upstream response' }, { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(verifyProductionDeployment({ ORIGIN_EXPECTED_SHA: sha })).rejects.toThrow('received 503; code=PROVIDER_UNAVAILABLE');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('does not expose response bodies in smoke-test failure logs', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'PROVIDER_UNAVAILABLE', message: 'private upstream response' }, { status: 503 })));
  try {
    await verifyLiveChat('https://example.com', 1000);
    throw new Error('unexpected success');
  } catch (error) {
    expect(String(error)).not.toContain('private upstream response');
    expect(String(error)).toContain('received 503; code=PROVIDER_UNAVAILABLE');
  }
});

it('suppresses malformed or untrusted failure codes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'private secret value', message: 'private upstream response' }, { status: 502 })));
  try {
    await verifyLiveChat('https://example.com', 1000);
    throw new Error('unexpected success');
  } catch (error) {
    expect(String(error)).not.toContain('private secret value');
    expect(String(error)).not.toContain('private upstream response');
    expect(String(error)).toContain('received 502; code=UNKNOWN');
  }
});
