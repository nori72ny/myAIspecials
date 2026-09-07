import { afterEach, expect, it, vi } from 'vitest';
import { verifyProductionDeployment, verifyLiveChat } from './verify-production-deployment.mjs';

afterEach(() => vi.unstubAllGlobals());

it('rejects the production busy message even with HTTP 200 and streaming headers', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('現在、無料AIの利用が集中しています。', { headers: { 'content-type': 'text/event-stream' } })));
  await expect(verifyLiveChat('https://example.com', 1000)).rejects.toThrow('must answer the requested OK probe');
});

it('does not repeat inference when health matches but the chat fails', async () => {
  const sha = 'a'.repeat(40);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ status: 'ok', service: 'acos-2', releaseSha: sha }))
    .mockResolvedValueOnce(new Response('<title>ORIGIN Personal</title>', { headers: { 'content-type': 'text/html' } }))
    .mockResolvedValueOnce(new Response('private upstream response', { status: 502 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(verifyProductionDeployment({ ORIGIN_EXPECTED_SHA: sha })).rejects.toThrow('received 502');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('does not expose response bodies in smoke-test failure logs', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('private upstream response', { status: 502 })));
  try {
    await verifyLiveChat('https://example.com', 1000);
    throw new Error('unexpected success');
  } catch (error) {
    expect(String(error)).not.toContain('private upstream response');
    expect(String(error)).toContain('received 502');
  }
});
