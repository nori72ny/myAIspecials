/** Separate browser-side image-integrity gate. Do not trust server response length claims. */
export async function readVerifiedWorldClassImageBlobV16(
  response: Response,
  mime: 'image/png' | 'image/jpeg' | 'image/webp',
  expectedSha256: string,
): Promise<Blob> {
  const maxBytes = 12 * 1024 * 1024;
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error('生成画像のSHA-256証拠が不正です。');
  }
  const announced = response.headers.get('content-length');
  if (announced !== null && (!/^(?:0|[1-9][0-9]*)$/.test(announced)
    || !Number.isSafeInteger(Number(announced)) || Number(announced) > maxBytes)) {
    throw new Error('受信画像のサイズが上限を超えています。');
  }
  if (!response.body) throw new Error('画像の受信データを確認できません。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('受信画像のサイズが上限を超えています。');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 64) throw new Error('受信画像のサイズが正しくありません。');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  const validFormat = mime === 'image/png'
    ? bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)
    : mime === 'image/jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255
        && bytes[bytes.length - 1] === 217
      : String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  if (!validFormat) throw new Error('画像の形式と受信データが一致しません。');
  if (!globalThis.crypto?.subtle) throw new Error('この端末では画像の整合性を検証できません。');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error('生成画像のSHA-256検証に失敗しました。');
  }
  return new Blob([bytes], { type: mime });
}
