const GZIP_HEADER = [0x1f, 0x8b] as const;

const isGzip = (data: Uint8Array): boolean => (
  data.length >= GZIP_HEADER.length
  && data[0] === GZIP_HEADER[0]
  && data[1] === GZIP_HEADER[1]
);

const hasNativeCompression = (): boolean => (
  typeof globalThis.CompressionStream === 'function'
  && typeof globalThis.DecompressionStream === 'function'
);

export const isGzipCompressed = (data: Uint8Array): boolean => isGzip(data);

export async function compressText(text: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  if (!encoded.length || !hasNativeCompression()) return encoded;

  try {
    const stream = new Response(text).body?.pipeThrough(new CompressionStream('gzip'));
    if (!stream) return encoded;
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // Compression is an optimization. Persisting the original UTF-8 bytes is
    // safer than making local data unavailable when a partial implementation fails.
    return encoded;
  }
}

export async function decompressText(data: Uint8Array): Promise<string> {
  if (!data.length || !isGzip(data)) return new TextDecoder().decode(data);
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('decompression-stream-unavailable');
  }

  const input = new Uint8Array(data).buffer;
  const stream = new Response(input).body?.pipeThrough(new DecompressionStream('gzip'));
  if (!stream) throw new Error('decompression-stream-unavailable');
  return new Response(stream).text();
}
