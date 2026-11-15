import { Router, type Request, type Response } from 'express';
import {
  transcribeOriginVoiceAudio,
  type OriginVoiceDailyLimiter,
} from './cloudflareVoiceTranscription.js';

/**
 * POST /api/voice/transcribe (PR-V2, design: VOICE_INPUT_RECON_2026-11-12).
 *
 * The body is the raw audio bytes (the raw body parser with the 2 MB cap
 * is mounted for this exact path in createOriginApp, before the global
 * JSON parser). The router returns only the transcription text; the
 * client (PR-V3) places it in the composer for the user to review and
 * send themselves — nothing is auto-sent, and the audio itself is never
 * stored or logged.
 *
 * The same-origin rule from requireSafeOriginChatRequest applies here,
 * minus its JSON content-type requirement (this endpoint takes audio,
 * not JSON): when an Origin header is present it must parse and match
 * the request host or the configured APP_URL origin.
 */

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  CROSS_ORIGIN_REQUEST_BLOCKED: '許可されていない送信元です。',
  VOICE_TRANSCRIBE_DISABLED: '音声入力は現在有効になっていません。',
  VOICE_MODEL_EVIDENCE_STALE: '音声モデルの利用可能性を示す証拠が期限切れのため、音声入力を停止しています。',
  VOICE_MODEL_CATALOG_INVALID: '音声モデルの証拠カタログが正しくないため、音声入力を停止しています。',
  CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED: '音声入力の接続設定が完了していないため、現在は利用できません。',
  CLOUDFLARE_DAILY_USAGE_UNVERIFIED: '無料枠の残量を確認できないため、音声入力を停止しています。',
  CLOUDFLARE_FREE_ALLOCATION_INSUFFICIENT: '無料枠の残量が不足しているため、音声入力を停止しています。',
  VOICE_DAILY_LIMIT_REACHED: '今日の音声入力の上限に達しました',
  VOICE_AUDIO_EMPTY: '音声データが届きませんでした。',
  VOICE_AUDIO_TOO_LARGE: '音声が大きすぎます。60秒以内で録音してください。',
  VOICE_AUDIO_TOO_LONG: '音声が長すぎます。60秒以内で録音してください。',
  VOICE_DURATION_INVALID: '音声の長さの指定が正しくありません。',
  VOICE_CONTENT_TYPE_UNSUPPORTED: '対応していない音声形式です。',
};

const GENERIC_FAILURE_MESSAGE = '文字起こしできませんでした。もう一度お試しください';

function fail(res: Response, status: number, code: string, retryable = false) {
  return res.status(status).json({
    ok: false,
    code,
    message: FAILURE_MESSAGES[code] ?? GENERIC_FAILURE_MESSAGE,
    retryable,
    freeOnly: true,
    paidFallbackUsed: false,
    secretDelivery: 'server-only',
  });
}

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function originAllowed(req: Request, env: NodeJS.ProcessEnv): boolean {
  const requestOrigin = safeOrigin(req.get('origin'));
  if (req.get('origin') && !requestOrigin) return false;
  if (!requestOrigin) return true;
  const configuredOrigin = safeOrigin(env.APP_URL);
  const requestHost = req.get('host');
  const sameHost = requestHost ? new URL(requestOrigin).host === requestHost : false;
  const configuredMatch = configuredOrigin ? requestOrigin === configuredOrigin : false;
  return sameHost || configuredMatch;
}

function parseDeclaredDurationMs(req: Request): { ok: true; value: number | null } | { ok: false } {
  const raw = req.get('x-origin-audio-duration-ms');
  if (raw === undefined) return { ok: true, value: null };
  if (!/^\d{1,9}$/.test(raw.trim())) return { ok: false };
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= 0 ? { ok: true, value } : { ok: false };
}

export interface OriginVoiceTranscribeRouterDependencies {
  fetchImpl?: typeof fetch;
  limiter?: OriginVoiceDailyLimiter;
  now?: () => number;
}

export function createOriginVoiceTranscribeRouter(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: OriginVoiceTranscribeRouterDependencies = {},
) {
  const router = Router();

  router.post('/api/voice/transcribe', async (req: Request, res: Response) => {
    if (!originAllowed(req, env)) {
      return fail(res, 403, 'CROSS_ORIGIN_REQUEST_BLOCKED');
    }
    const contentType = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      return fail(res, 415, 'VOICE_CONTENT_TYPE_UNSUPPORTED');
    }
    const duration = parseDeclaredDurationMs(req);
    if (duration.ok === false) {
      return fail(res, 400, 'VOICE_DURATION_INVALID');
    }
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await transcribeOriginVoiceAudio(
      { audio, declaredDurationMs: duration.value },
      {
        env,
        fetchImpl: dependencies.fetchImpl,
        limiter: dependencies.limiter,
        nowMs: dependencies.now ? dependencies.now() : undefined,
      },
    );
    if (result.ok === false) {
      return fail(res, result.httpStatus, result.code, result.retryable);
    }
    return res.status(200).json({
      ok: true,
      code: 'VOICE_TRANSCRIPTION_READY',
      text: result.text,
      model: result.model,
      language: result.language,
      dailyUsed: result.daily.used,
      dailyLimit: result.daily.limit,
      freeOnly: true,
      paidFallbackUsed: false,
      secretDelivery: 'server-only',
    });
  });

  return router;
}
