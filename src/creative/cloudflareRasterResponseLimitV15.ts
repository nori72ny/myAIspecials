/**
 * Bounds upstream Cloudflare Workers AI responses independently of Content-Length.
 * The caller's fetch AbortSignal must remain live through body decoding, not just
 * until HTTP response headers are received.
 */
export async function readBoundedCloudflareRasterBodyV15(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 24 * 1024 * 1024) {
    throw new Error('CLOUDFLARE_RESPONSE_LIMIT_INVALID');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/.test(declared)
    || !Number.isSafeInteger(Number(declared)) || Number(declared) > maxBytes)) {
    throw new Error('CLOUDFLARE_RESPONSE_DECLARED_SIZE_OUT_OF_BOUNDS');
  }
  if (!response.body) throw new Error('CLOUDFLARE_RESPONSE_BODY_MISSING');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('CLOUDFLARE_RESPONSE_BODY_SIZE_OUT_OF_BOUNDS');
      }
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function readBoundedCloudflareRasterJsonV15(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const bytes = await readBoundedCloudflareRasterBodyV15(response, maxBytes);
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
