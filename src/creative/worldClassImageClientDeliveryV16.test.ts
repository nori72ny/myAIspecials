// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readVerifiedWorldClassImageBlobV16 } from './worldClassImageClientDeliveryV16.js';

function png(count = 160) {
  const bytes = new Uint8Array(count).fill(7);
  bytes.set([137,80,78,71,13,10,26,10]);
  return bytes;
}
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function streamed(parts: Uint8Array[], claimed?: string) {
  let next = 0;
  const headers: Record<string,string> = {};
  if (claimed !== undefined) headers['content-length'] = claimed;
  return new Response(new ReadableStream<Uint8Array>({
    pull(c) { if (next < parts.length) c.enqueue(parts[next++]); else c.close(); },
  }), { headers });
}
afterEach(() => vi.unstubAllGlobals());
describe('V1.6 browser image delivery guard', () => {
  it('accepts small streamed PNG with matching actual SHA-256', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const bytes = png();
    const blob = await readVerifiedWorldClassImageBlobV16(
      streamed([bytes.subarray(0, 20), bytes.subarray(20)]), 'image/png', digest(bytes));
    expect(blob.size).toBe(bytes.length);
    expect(blob.type).toBe('image/png');
  });
  it('rejects a large announced Content-Length before reading bytes', async () => {
    await expect(readVerifiedWorldClassImageBlobV16(
      streamed([png()], '999999999'), 'image/png', digest(png())))
      .rejects.toThrow('受信画像のサイズが上限を超えています。');
  });
  it('rejects oversized streaming payload even when header claims 1 byte', async () => {
    const bytes = png();
    await expect(readVerifiedWorldClassImageBlobV16(
      streamed([bytes, new Uint8Array(12 * 1024 * 1024)] , '1'), 'image/png', digest(bytes)))
      .rejects.toThrow('受信画像のサイズが上限を超えています。');
  });
  it('rejects MIME spoofing even when source hash matches', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const bytes = png();
    await expect(readVerifiedWorldClassImageBlobV16(
      streamed([bytes]), 'image/webp', digest(bytes)))
      .rejects.toThrow('画像の形式と受信データが一致しません。');
  });
  it('rejects corrupted bytes when SHA-256 evidence mismatches', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const bytes = png();
    await expect(readVerifiedWorldClassImageBlobV16(
      streamed([bytes]), 'image/png', 'a'.repeat(64)))
      .rejects.toThrow('生成画像のSHA-256検証に失敗しました。');
  });
  it('fails closed when browser cryptographic SHA-256 is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    const bytes = png();
    await expect(readVerifiedWorldClassImageBlobV16(
      streamed([bytes]), 'image/png', digest(bytes)))
      .rejects.toThrow('この端末では画像の整合性を検証できません。');
  });
});
