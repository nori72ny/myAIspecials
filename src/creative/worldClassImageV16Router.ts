import { createHash } from 'node:crypto';
import { Router, type Request, type Response as ExpressResponse } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';

const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/images/models';
const DEFAULT_MODEL = 'openai/gpt-image-2.5-sunburst';
const ALLOWED_MODELS = new Set([
  'openai/gpt-image-2.5-sunburst',
  'openai/gpt-image-2.5-flare',
  'google/gemini-3.1-flash-image',
]);
const RATIOS = ['1:1','3:2','2:3','4:3','3:4','16:9','9:16'] as const;
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const FULL_SHA = /^[0-9a-f]{40}$/i;

type ParsedRequest = {
  prompt: string;
  width?: number;
  height?: number;
  model: string;
  referenceImages: string[];
};

function bool(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key]?.trim().toLowerCase() === 'true';
}
function releaseSha(env: NodeJS.ProcessEnv): string {
  const value = env.VERCEL_GIT_COMMIT_SHA ?? env.ORIGIN_RELEASE_SHA ?? '';
  return FULL_SHA.test(value) ? value.toLowerCase() : 'unknown';
}
function qualified(env: NodeJS.ProcessEnv): boolean {
  const current = releaseSha(env);
  const approved = env.ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA?.trim().toLowerCase() ?? '';
  return current !== 'unknown' && approved === current;
}
function credentials(env: NodeJS.ProcessEnv): string | null {
  const key = env.OPENROUTER_API_KEY?.trim() ?? '';
  return key.length >= 20 ? key : null;
}
function evaluationBypassAllowed(env: NodeJS.ProcessEnv): boolean {
  if (!bool(env, 'ORIGIN_IMAGE_WORLD_CLASS_EVAL')) return false;
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  return vercelEnv !== 'production' && nodeEnv !== 'production';
}
function fail(res: ExpressResponse, status: number, code: string, message: string) {
  return res.status(status).json({
    ok: false, code, message, retryable: status >= 500,
    worldClassMode: true, paidFallbackUsed: false, secretDelivery: 'server-only',
  });
}
function parse(body: unknown, editing: boolean): ParsedRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_WORLD_CLASS_IMAGE_REQUEST');
  const row = body as Record<string, unknown>;
  const allowed = new Set(editing ? ['prompt','width','height','model','referenceImages'] : ['prompt','width','height','model']);
  if (Object.keys(row).some((key) => !allowed.has(key))) throw new Error('INVALID_WORLD_CLASS_IMAGE_FIELD');
  const prompt = typeof row.prompt === 'string' ? row.prompt.normalize('NFKC').trim() : '';
  if (!prompt || prompt.length > 4000) throw new Error('INVALID_WORLD_CLASS_IMAGE_PROMPT');
  if ((row.width === undefined) !== (row.height === undefined)) throw new Error('INVALID_WORLD_CLASS_IMAGE_DIMENSION_PAIR');
  const width = row.width;
  const height = row.height;
  if (width !== undefined && (!Number.isInteger(width) || Number(width) < 256 || Number(width) > 4096)) throw new Error('INVALID_WORLD_CLASS_IMAGE_DIMENSION');
  if (height !== undefined && (!Number.isInteger(height) || Number(height) < 256 || Number(height) > 4096)) throw new Error('INVALID_WORLD_CLASS_IMAGE_DIMENSION');
  const model = typeof row.model === 'string' && row.model.trim() ? row.model.trim() : DEFAULT_MODEL;
  if (!ALLOWED_MODELS.has(model)) throw new Error('WORLD_CLASS_IMAGE_MODEL_NOT_ALLOWED');
  const references = editing ? row.referenceImages : [];
  if (editing && (!Array.isArray(references) || references.length < 1 || references.length > MAX_REFERENCE_IMAGES)) throw new Error('INVALID_WORLD_CLASS_REFERENCE_COUNT');
  let total = 0;
  const referenceImages = (Array.isArray(references) ? references : []).map((item) => {
    if (typeof item !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item)) throw new Error('INVALID_WORLD_CLASS_REFERENCE_IMAGE');
    const encoded = item.slice(item.indexOf(',') + 1);
    total += Buffer.byteLength(encoded, 'base64');
    if (total > MAX_REFERENCE_BYTES) throw new Error('WORLD_CLASS_REFERENCE_BYTES_EXCEEDED');
    return item;
  });
  return { prompt, width: width as number | undefined, height: height as number | undefined, model, referenceImages };
}
function nearestRatio(width = 1024, height = 1024): typeof RATIOS[number] {
  const target = width / height;
  let best: typeof RATIOS[number] = '1:1';
  let delta = Infinity;
  for (const ratio of RATIOS) {
    const [a,b] = ratio.split(':').map(Number);
    const d = Math.abs(target - a / b);
    if (d < delta) { delta = d; best = ratio; }
  }
  return best;
}
function imageMime(bytes: Buffer): 'image/png'|'image/jpeg'|'image/webp'|null {
  if (bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
async function fetchJson(url: string, apiKey: string, init: RequestInit = {}, timeoutMs = 20000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'HTTP-Referer': 'https://origin-personal.vercel.app',
        'X-Title': 'ORIGIN Personal',
        ...(init.headers ?? {}),
      },
    });
  } finally { clearTimeout(timer); }
}
async function modelReady(apiKey: string, model: string, editing: boolean): Promise<boolean> {
  const response = await fetchJson(OPENROUTER_MODELS_URL, apiKey, {}, 15000);
  if (!response.ok) return false;
  const parsed = await response.json().catch(() => null) as { data?: unknown[] } | null;
  const rows = Array.isArray(parsed?.data) ? parsed!.data as Record<string, unknown>[] : [];
  const row = rows.find((item) => item.id === model);
  if (!row) return false;
  const params = row.supported_parameters && typeof row.supported_parameters === 'object' ? row.supported_parameters as Record<string, unknown> : {};
  if (editing && !('input_references' in params)) return false;
  return true;
}
function sensitive(body: unknown): boolean {
  let text = '';
  try {
    const row = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    text = JSON.stringify({ ...row, referenceImages: row.referenceImages ? '[reference-images]' : undefined });
  } catch { return true; }
  return detectSensitiveConversation([{ role: 'user', content: text }]).length > 0;
}

export function createWorldClassImageV16Router(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();

  router.get('/api/creative/v1.6/world-class/status', async (_req, res) => {
    const key = credentials(env);
    const enabled = bool(env, 'ORIGIN_IMAGE_WORLD_CLASS_ENABLED');
    const isQualified = qualified(env);
    const model = env.ORIGIN_IMAGE_WORLD_CLASS_MODEL?.trim() || DEFAULT_MODEL;
    const allowed = ALLOWED_MODELS.has(model);
    let providerReady = false;
    if (key && enabled && allowed) providerReady = await modelReady(key, model, false).catch(() => false);
    const ready = Boolean(key && enabled && isQualified && allowed && providerReady);
    return res.status(ready ? 200 : 503).json({
      ok: ready,
      ready,
      enabled,
      qualified: isQualified,
      releaseSha: releaseSha(env),
      qualifiedSha: env.ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA?.trim().toLowerCase() || null,
      provider: 'openrouter-image-api',
      model,
      allowedModels: [...ALLOWED_MODELS],
      providerReady,
      benchmarkGate: '24-case blind benchmark vs 3 frontier references + 2 independent judges',
      publicationPolicy: 'exact-sha-qualified-only',
      freeOnly: false,
      paidFallbackEnabled: false,
      secretDelivery: 'server-only',
    });
  });

  const handler = (editing: boolean) => async (req: Request, res: ExpressResponse) => {
    if (sensitive(req.body)) return fail(res, 422, 'SENSITIVE_INPUT_BLOCKED', '機密情報の可能性があるため外部画像モデルへ送信しません。');
    let input: ParsedRequest;
    try { input = parse(req.body, editing); }
    catch (error) { return fail(res, 400, error instanceof Error ? error.message : 'INVALID_WORLD_CLASS_IMAGE_REQUEST', '画像生成リクエストが不正です。'); }

    const key = credentials(env);
    if (!bool(env, 'ORIGIN_IMAGE_WORLD_CLASS_ENABLED')) return fail(res, 503, 'WORLD_CLASS_IMAGE_MODE_DISABLED', '世界最高品質モードはまだ有効化されていません。');
    if (!qualified(env) && !evaluationBypassAllowed(env)) return fail(res, 503, 'WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED', 'blind品質評価を通過したexact SHAだけが本番利用できます。');
    if (!key) return fail(res, 503, 'OPENROUTER_IMAGE_KEY_NOT_CONFIGURED', '画像モデル接続用のサーバー資格情報がありません。');
    if (!(await modelReady(key, input.model, editing).catch(() => false))) return fail(res, 503, 'WORLD_CLASS_IMAGE_MODEL_CAPABILITY_UNVERIFIED', 'モデル能力を事前確認できませんでした。');

    const payload: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt,
      n: 1,
      resolution: '1K',
      aspect_ratio: nearestRatio(input.width, input.height),
      quality: 'max',
      output_format: 'png',
    };
    if (editing) payload.input_references = input.referenceImages.map((url) => ({
      type: 'image_url',
      image_url: { url },
    }));

    const response = await fetchJson(OPENROUTER_IMAGES_URL, key, { method: 'POST', body: JSON.stringify(payload) }, 120000);
    if (!response.ok) return fail(res, response.status === 429 ? 429 : 502, `OPENROUTER_IMAGE_HTTP_${response.status}`, '上位画像モデルの生成に失敗しました。');
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    const data = Array.isArray(result?.data) ? result!.data as Record<string, unknown>[] : [];
    const encoded = typeof data[0]?.b64_json === 'string' ? String(data[0].b64_json) : '';
    if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) return fail(res, 502, 'WORLD_CLASS_IMAGE_PAYLOAD_INVALID', '画像レスポンスの検証に失敗しました。');
    const bytes = Buffer.from(encoded, 'base64');
    const mime = imageMime(bytes);
    if (!mime || bytes.length < 1024 || bytes.length > MAX_IMAGE_BYTES) return fail(res, 502, 'WORLD_CLASS_IMAGE_BINARY_INVALID', '画像バイナリの検証に失敗しました。');

    const usage = result?.usage && typeof result.usage === 'object' && !Array.isArray(result.usage) ? result.usage as Record<string, unknown> : {};
    const costUsd = Number(usage.cost ?? usage.cost_usd ?? NaN);
    if (!Number.isFinite(costUsd) || costUsd < 0) return fail(res, 502, 'WORLD_CLASS_IMAGE_COST_UNVERIFIED', '実コストを確認できないため画像を返しません。');
    const maxCost = Math.min(1, Math.max(0.01, Number(env.ORIGIN_IMAGE_WORLD_CLASS_MAX_COST_USD ?? '0.25')));
    if (costUsd > maxCost) return fail(res, 502, 'WORLD_CLASS_IMAGE_COST_CAP_EXCEEDED', '設定した1枚あたりのコスト上限を超えたため画像を返しません。');

    const sha = createHash('sha256').update(bytes).digest('hex');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'attachment; filename="origin-world-class-image.png"');
    res.setHeader('X-Origin-Visual-Verified', 'true');
    res.setHeader('X-Origin-Visual-Sha256', sha);
    res.setHeader('X-Origin-Visual-Provider', 'openrouter-image-api');
    res.setHeader('X-Origin-Visual-Model', input.model);
    res.setHeader('X-Origin-Visual-Task', editing ? 'edit' : 'generate');
    res.setHeader('X-Origin-World-Class-Qualified-Sha', releaseSha(env));
    res.setHeader('X-Origin-Cost-Usd', String(costUsd));
    res.setHeader('X-Origin-Free-Only', 'false');
    res.setHeader('X-Origin-Paid-Fallback', 'false');
    res.setHeader('X-Origin-Secret-Delivery', 'server-only');
    return res.status(200).send(bytes);
  };

  router.post('/api/creative/v1.6/world-class/generate', handler(false));
  router.post('/api/creative/v1.6/world-class/edit', handler(true));
  return router;
}
