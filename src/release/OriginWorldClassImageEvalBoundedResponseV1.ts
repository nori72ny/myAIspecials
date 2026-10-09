/**
 * A sealed evaluation runner must bound response bytes even when Content-Length
 * is missing, wrong, or maliciously understated. Never use response.arrayBuffer()
 * on a remotely influenced raster output or error body.
 */
export async function readBoundedWorldClassEvalResponseV1(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024) {
    throw new Error('WORLD_CLASS_IMAGE_EVAL_RESPONSE_LIMIT_INVALID');
  }
  const announced = response.headers.get('content-length');
  if (announced !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(announced)
      || !Number.isSafeInteger(Number(announced))
      || Number(announced) > maxBytes) {
      throw new Error('WORLD_CLASS_IMAGE_EVAL_RESPONSE_DECLARED_SIZE_INVALID');
    }
  }
  if (!response.body) {
    throw new Error('WORLD_CLASS_IMAGE_EVAL_RESPONSE_BODY_MISSING');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('WORLD_CLASS_IMAGE_EVAL_RESPONSE_TOO_LARGE');
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
