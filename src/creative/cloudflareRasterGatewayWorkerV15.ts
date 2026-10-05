const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_BYTES = 768 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_DIMENSION_EXCLUSIVE = 512;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_MODEL_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_MODEL_OUTPUT_BASE64_CHARS = 4 * Math.ceil(MAX_MODEL_OUTPUT_BYTES / 3);
const MIN_OUTPUT_DIMENSION = 256;
const MAX_OUTPUT_DIMENSION = 1536;

type WorkersAiMultipartInput = {
  multipart: {
    body: ReadableStream<Uint8Array> | null;
    contentType: string | null;
  };
};

export type CloudflareRasterGatewayWorkerEnvV15 = {
  AI?: {
    run(model: string, input: WorkersAiMultipartInput): Promise<unknown>;
  };
  ORIGIN_RASTER_GATEWAY_SECRET?: string;
  ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED?: string;
  FREE_ONLY?: string;
};

type ImageDimensions = { width: number; height: number };

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function configured(env: CloudflareRasterGatewayWorkerEnvV15) {
  const secret = env.ORIGIN_RASTER_GATEWAY_SECRET ?? '';
  const aiBindingConfigured = typeof env.AI?.run === 'function';
  const secretConfigured = secret.length >= 32 && secret.length <= 4096;
  const freeOnly = env.FREE_ONLY === 'true';
  const zeroCostVerified = env.ORIGIN_RASTER_GATEWAY_ZERO_COST_VERIFIED === 'true';
  return {
    aiBindingConfigured,
    secretConfigured,
    freeOnly,
    zeroCostVerified,
    ready: aiBindingConfigured && secretConfigured && freeOnly && zeroCostVerified,
  };
}

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected || expected.length < 32 || expected.length > 4096) return false;
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(providedDigest);
  const b = new Uint8Array(expectedDigest);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function imageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | null {
  const buffer = Buffer.from(bytes);
  if (mimeType === 'image/png') {
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (mimeType === 'image/jpeg') {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length) break;
      const marker = buffer[offset++];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if (sof.has(marker) && length >= 7) {
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += length;
    }
    return null;
  }
  if (mimeType === 'image/webp') {
    if (buffer.length < 30 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
    if (buffer.subarray(12, 16).toString('ascii') === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
  }
  return null;
}

function imageMimeType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const buffer = Buffer.from(bytes);
  if (
    buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'image/png';
  if (
    buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer.at(-2) === 0xff
    && buffer.at(-1) === 0xd9
  ) return 'image/jpeg';
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
}

function decodeModelBase64Image(output: unknown): { bytes: Uint8Array; mimeType: string } | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const image = (output as Record<string, unknown>).image;
  if (typeof image !== 'string') return null;
  const encoded = image.trim();
  if (
    !encoded
    || encoded.length > MAX_MODEL_OUTPUT_BASE64_CHARS
    || encoded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) throw new Error('AI_OUTPUT_BASE64_INVALID');

  const decoded = Buffer.from(encoded, 'base64');
  if (!decoded.length || decoded.length > MAX_MODEL_OUTPUT_BYTES) {
    throw new Error('AI_OUTPUT_SIZE_OUT_OF_BOUNDS');
  }
  const mimeType = imageMimeType(decoded);
  if (!mimeType) throw new Error('AI_OUTPUT_IMAGE_INVALID');
  return { bytes: new Uint8Array(decoded), mimeType };
}

function integerField(form: FormData, key: string): number {
  const raw = form.get(key);
  if (typeof raw !== 'string' || !/^\d{3,4}$/.test(raw)) throw new Error(`INPUT_${key.toUpperCase()}_INVALID`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_OUTPUT_DIMENSION || value > MAX_OUTPUT_DIMENSION) {
    throw new Error(`INPUT_${key.toUpperCase()}_OUT_OF_RANGE`);
  }
  return value;
}

async function boundedRequestWithBody(request: Request): Promise<Request> {
  if (!request.body) throw new Error('INPUT_MULTIPART_REQUIRED');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error('INPUT_REQUEST_TOO_LARGE');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });
}

async function validatedForm(request: Request, mode: 'generate' | 'edit'): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw new Error('INPUT_MULTIPART_REQUIRED');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error('INPUT_REQUEST_TOO_LARGE');

  const boundedRequest = await boundedRequestWithBody(request);
  const input = await boundedRequest.formData();
  const allowedNames = new Set(['prompt', 'width', 'height', 'input_image_0', 'input_image_1', 'input_image_2', 'input_image_3']);
  for (const name of input.keys()) {
    if (!allowedNames.has(name)) throw new Error('INPUT_FIELD_UNSUPPORTED');
  }

  const prompt = input.get('prompt');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2048) throw new Error('INPUT_PROMPT_INVALID');
  const width = integerField(input, 'width');
  const height = integerField(input, 'height');

  const references: { index: number; blob: Blob }[] = [];
  for (let index = 0; index < MAX_REFERENCE_IMAGES; index += 1) {
    const value = input.get(`input_image_${index}`);
    if (value === null) continue;
    const blobLike = value && typeof value === 'object'
      && typeof (value as Blob).arrayBuffer === 'function'
      && typeof (value as Blob).size === 'number'
      && typeof (value as Blob).type === 'string';
    if (!blobLike) throw new Error('INPUT_REFERENCE_INVALID');
    references.push({ index, blob: value as Blob });
  }
  if (references.some((reference, index) => reference.index !== index)) throw new Error('INPUT_REFERENCE_INDEX_GAP');
  if (mode === 'generate' && references.length !== 0) throw new Error('INPUT_REFERENCE_UNEXPECTED');
  if (mode === 'edit' && references.length === 0) throw new Error('INPUT_REFERENCE_REQUIRED');

  let totalReferenceBytes = 0;
  for (const reference of references) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(reference.blob.type)) throw new Error('INPUT_REFERENCE_MIME_UNSUPPORTED');
    if (reference.blob.size <= 0 || reference.blob.size > MAX_REFERENCE_BYTES) throw new Error('INPUT_REFERENCE_SIZE_OUT_OF_BOUNDS');
    totalReferenceBytes += reference.blob.size;
    if (totalReferenceBytes > MAX_REFERENCE_TOTAL_BYTES) throw new Error('INPUT_REFERENCE_TOTAL_SIZE_OUT_OF_BOUNDS');
    const bytes = new Uint8Array(await reference.blob.arrayBuffer());
    const dimensions = imageDimensions(bytes, reference.blob.type);
    if (!dimensions) throw new Error('INPUT_REFERENCE_IMAGE_INVALID');
    if (dimensions.width >= MAX_REFERENCE_DIMENSION_EXCLUSIVE || dimensions.height >= MAX_REFERENCE_DIMENSION_EXCLUSIVE) {
      throw new Error('INPUT_REFERENCE_DIMENSIONS_UNSUPPORTED');
    }
  }

  const output = new FormData();
  output.append('prompt', prompt.normalize('NFKC').trim());
  output.append('width', String(width));
  output.append('height', String(height));
  for (const reference of references) {
    output.append(`input_image_${reference.index}`, reference.blob, `reference-${reference.index}`);
  }
  return output;
}

function isBodyInit(value: unknown): value is BodyInit {
  return typeof value === 'string'
    || value instanceof Blob
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || value instanceof ReadableStream
    || value instanceof FormData
    || value instanceof URLSearchParams;
}

async function runModel(env: CloudflareRasterGatewayWorkerEnvV15, form: FormData): Promise<Response> {
  if (!env.AI?.run) throw new Error('AI_BINDING_UNAVAILABLE');
  const serialized = new Request('https://origin-raster-gateway.invalid/model-input', {
    method: 'POST',
    body: form,
  });
  const contentType = serialized.headers.get('content-type');
  if (!serialized.body || !contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new Error('MULTIPART_SERIALIZATION_FAILED');
  }

  const output = await env.AI.run(MODEL, {
    multipart: {
      body: serialized.body,
      contentType,
    },
  });

  if (output instanceof Response) {
    if (!output.ok || !output.body) throw new Error('AI_OUTPUT_INVALID');
    const mimeType = output.headers.get('content-type') ?? 'image/png';
    if (!mimeType.toLowerCase().startsWith('image/')) throw new Error('AI_OUTPUT_MIME_INVALID');
    return new Response(output.body, {
      status: 200,
      headers: {
        'content-type': mimeType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const encodedImage = decodeModelBase64Image(output);
  if (encodedImage) {
    return new Response(encodedImage.bytes, {
      status: 200,
      headers: {
        'content-type': encodedImage.mimeType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  if (!isBodyInit(output)) throw new Error('AI_OUTPUT_INVALID');
  return new Response(output, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function createCloudflareRasterGatewayWorkerV15() {
  return {
    async fetch(request: Request, env: CloudflareRasterGatewayWorkerEnvV15): Promise<Response> {
      const url = new URL(request.url);
      const expectedSecret = env.ORIGIN_RASTER_GATEWAY_SECRET ?? '';
      const providedSecret = request.headers.get('x-origin-gateway-secret') ?? '';
      if (!(await secretMatches(providedSecret, expectedSecret))) {
        return json({ ok: false, code: 'UNAUTHORIZED' }, 401);
      }

      const state = configured(env);
      if (request.method === 'GET' && url.pathname === '/status') {
        return json({
          ok: state.ready,
          provider: 'cloudflare-workers-ai-binding',
          model: MODEL,
          aiBindingConfigured: state.aiBindingConfigured,
          secretConfigured: state.secretConfigured,
          zeroCostVerified: state.zeroCostVerified,
          freeOnly: state.freeOnly,
          paidFallbackEnabled: false,
        }, state.ready ? 200 : 503);
      }

      const mode = url.pathname === '/generate' ? 'generate' : url.pathname === '/edit' ? 'edit' : null;
      if (request.method !== 'POST' || !mode) return json({ ok: false, code: 'NOT_FOUND' }, 404);
      if (!state.ready) return json({ ok: false, code: 'GATEWAY_NOT_READY' }, 503);

      try {
        const form = await validatedForm(request, mode);
        return await runModel(env, form);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'GATEWAY_ERROR';
        if (code.startsWith('INPUT_')) return json({ ok: false, code }, 400);
        return json({ ok: false, code: 'MODEL_EXECUTION_FAILED' }, 502);
      }
    },
  };
}
