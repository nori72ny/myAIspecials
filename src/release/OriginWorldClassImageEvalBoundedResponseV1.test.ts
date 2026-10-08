// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBoundedWorldClassEvalResponseV1 } from './OriginWorldClassImageEvalBoundedResponseV1.js';

function streamedResponse(chunks: number[], declaredLength?: string) {
  const data = chunks.map(n => new Uint8Array(n).fill(7));
  let index = 0;
  const headers: Record<string, string> = { 'content-type': 'image/png' };
  if (declaredLength !== undefined) headers['content-length'] = declaredLength;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === data.length) controller.close();
      else controller.enqueue(data[index++]);
    },
  }), { headers });
}

describe('world-class image sealed-eval bounded response reader', () => {
  it('reads legitimate payloads without requiring a Content-Length header', async () => {
    const bytes = await readBoundedWorldClassEvalResponseV1(streamedResponse([12, 20, 8]), 40);
    expect(bytes.byteLength).toBe(40);
    expect(bytes.every(byte => byte === 7)).toBe(true);
  });
  it('rejects oversized announced image bytes before reading the stream', async () => {
    await expect(readBoundedWorldClassEvalResponseV1(
      streamedResponse([1], '999999999'), 1024)).rejects.toThrow('RESPONSE_DECLARED_SIZE_INVALID');
  });
  it('rejects a forged small Content-Length with oversized actual streamed payload', async () => {
    await expect(readBoundedWorldClassEvalResponseV1(
      streamedResponse([60, 60, 60], '5'), 100)).rejects.toThrow('RESPONSE_TOO_LARGE');
  });
  it('rejects missing or invalid limits and negative Content-Length values', async () => {
    await expect(readBoundedWorldClassEvalResponseV1(streamedResponse([1]), 0))
      .rejects.toThrow('RESPONSE_LIMIT_INVALID');
    await expect(readBoundedWorldClassEvalResponseV1(streamedResponse([1], '-1'), 10))
      .rejects.toThrow('RESPONSE_DECLARED_SIZE_INVALID');
  });
  it('supports 64 KiB capped JSON-error responses without loading unbounded error bodies', async () => {
    const bytes = await readBoundedWorldClassEvalResponseV1(streamedResponse([256]), 64 * 1024);
    expect(bytes).toHaveLength(256);
  });
});
