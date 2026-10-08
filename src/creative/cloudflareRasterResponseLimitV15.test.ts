// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  readBoundedCloudflareRasterBodyV15,
  readBoundedCloudflareRasterJsonV15,
} from './cloudflareRasterResponseLimitV15.js';

function streamedResponse(chunks: Uint8Array[], contentLength?: string): Response {
  let index = 0;
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) headers['content-length'] = contentLength;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks.length) controller.close();
      else controller.enqueue(chunks[index++]);
    },
  }), { headers });
}

describe('Workers AI production response memory limits', () => {
  it('accepts streamed image bytes with no declared length', async () => {
    const response = streamedResponse([Uint8Array.of(1,2), Uint8Array.of(3,4)]);
    expect(await readBoundedCloudflareRasterBodyV15(response, 4)).toEqual(Buffer.from([1,2,3,4]));
  });
  it('rejects forged tiny Content-Length and unlimited actual bytes', async () => {
    const response = streamedResponse([new Uint8Array(512), new Uint8Array(512)], '1');
    await expect(readBoundedCloudflareRasterBodyV15(response, 513))
      .rejects.toThrow('CLOUDFLARE_RESPONSE_BODY_SIZE_OUT_OF_BOUNDS');
  });
  it('rejects declared oversized payload before consuming the body', async () => {
    const response = streamedResponse([Uint8Array.of(1)], '104857600');
    await expect(readBoundedCloudflareRasterBodyV15(response, 1024))
      .rejects.toThrow('CLOUDFLARE_RESPONSE_DECLARED_SIZE_OUT_OF_BOUNDS');
  });
  it('rejects invalid or misleading response length values', async () => {
    await expect(readBoundedCloudflareRasterBodyV15(streamedResponse([Uint8Array.of(1)], '-1'), 10))
      .rejects.toThrow('CLOUDFLARE_RESPONSE_DECLARED_SIZE_OUT_OF_BOUNDS');
  });
  it('rejects unknown/missing body or invalid byte caps', async () => {
    await expect(readBoundedCloudflareRasterBodyV15(new Response(null), 1024))
      .rejects.toThrow('CLOUDFLARE_RESPONSE_BODY_MISSING');
    await expect(readBoundedCloudflareRasterBodyV15(streamedResponse([Uint8Array.of(1)]), 0))
      .rejects.toThrow('CLOUDFLARE_RESPONSE_LIMIT_INVALID');
  });
  it('bounds JSON too, including the bytes of valid but oversized documents', async () => {
    const response = new Response(JSON.stringify({ value: 'x'.repeat(128) }));
    await expect(readBoundedCloudflareRasterJsonV15(response, 64))
      .rejects.toThrow('CLOUDFLARE_RESPONSE_BODY_SIZE_OUT_OF_BOUNDS');
  });
  it('accepts small bounded valid Cloudflare JSON', async () => {
    const response = new Response(JSON.stringify({ success: true, result: { plan: 'free' } }));
    await expect(readBoundedCloudflareRasterJsonV15(response, 512))
      .resolves.toEqual({ success: true, result: { plan: 'free' } });
  });
});
