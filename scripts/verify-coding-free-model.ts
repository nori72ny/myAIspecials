import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ORIGIN_VERIFIED_CODING_FREE_MODEL = 'inclusionai/ling-3.0-flash-vl:free' as const;
export const OPENROUTER_MODELS_API = 'https://openrouter.ai/api/v1/models' as const;
const DEFAULT_REVIEW_DAYS = 10;
const DEFAULT_REFRESH_THRESHOLD_DAYS = 3;

type OpenRouterModel = {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: unknown;
};

export type OriginCodingFreeModelVerification = {
  modelId: typeof ORIGIN_VERIFIED_CODING_FREE_MODEL;
  pricing: { prompt: '0'; completion: '0' };
  toolCalling: true;
  sourceUrl: string;
  verifiedAt: string;
  reviewAfter: string;
  targetPath: string;
  updated: boolean;
};

const isExactZeroPrice = (value: unknown): boolean => {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
};

export function verifyCodingFreeModelPayload(payload: unknown): OpenRouterModel {
  const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: OpenRouterModel[] }).data
    : null;
  if (!data) throw new Error('OpenRouter /models response does not contain a data array.');
  const matches = data.filter(model => model?.id === ORIGIN_VERIFIED_CODING_FREE_MODEL);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${ORIGIN_VERIFIED_CODING_FREE_MODEL} entry; received ${matches.length}.`);
  const model = matches[0];
  if (!isExactZeroPrice(model.pricing?.prompt) || !isExactZeroPrice(model.pricing?.completion)) {
    throw new Error('The fixed Coding failover model is not verified at $0.00 for both prompt and completion pricing.');
  }
  const supported = Array.isArray(model.supported_parameters)
    ? model.supported_parameters.filter((value): value is string => typeof value === 'string')
    : [];
  if (!supported.includes('tools')) throw new Error('The fixed Coding failover model no longer advertises tool calling.');
  return model;
}

export function updatedCodingFreeModelEvidence(source: string, verifiedAt: string, reviewAfter: string): string {
  const verifiedPattern = /export const ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14 = '[^']+' as const;/g;
  const reviewPattern = /export const ORIGIN_CODING_FREE_FAILOVER_REVIEW_AFTER_V14 = '[^']+' as const;/g;
  const verifiedMatches = source.match(verifiedPattern) ?? [];
  const reviewMatches = source.match(reviewPattern) ?? [];
  if (verifiedMatches.length !== 1 || reviewMatches.length !== 1) {
    throw new Error('Coding free-model evidence timestamps are ambiguous; refusing to update.');
  }
  return source
    .replace(verifiedMatches[0], `export const ORIGIN_CODING_FREE_FAILOVER_VERIFIED_AT_V14 = '${verifiedAt}' as const;`)
    .replace(reviewMatches[0], `export const ORIGIN_CODING_FREE_FAILOVER_REVIEW_AFTER_V14 = '${reviewAfter}' as const;`);
}

export async function verifyAndRefreshCodingFreeModel(options: {
  fetchImpl?: typeof fetch;
  targetPath?: string;
  now?: Date;
  reviewDays?: number;
  modelsUrl?: string;
  force?: boolean;
  refreshThresholdDays?: number;
} = {}): Promise<OriginCodingFreeModelVerification> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const targetPath = resolve(options.targetPath ?? 'src/agent/codingFreeModelFailoverV14.ts');
  const reviewDays = options.reviewDays ?? DEFAULT_REVIEW_DAYS;
  if (!Number.isInteger(reviewDays) || reviewDays < 1 || reviewDays > 30) throw new Error('Review window must be an integer from 1 to 30 days.');
  const sourceUrl = options.modelsUrl ?? OPENROUTER_MODELS_API;
  const response = await fetchImpl(sourceUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'ORIGIN-Personal-Coding-Free-Model-Verifier/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRouter /models verification failed with HTTP ${response.status}.`);
  verifyCodingFreeModelPayload(await response.json());

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Verification time is invalid.');
  const current = await readFile(targetPath, 'utf8');
  const currentReviewAfter = current.match(/ORIGIN_CODING_FREE_FAILOVER_REVIEW_AFTER_V14 = '([^']+)'/)?.[1];
  const currentDeadline = currentReviewAfter ? Date.parse(currentReviewAfter) : Number.NaN;
  const refreshThresholdDays = options.refreshThresholdDays ?? DEFAULT_REFRESH_THRESHOLD_DAYS;
  if (!Number.isInteger(refreshThresholdDays) || refreshThresholdDays < 0 || refreshThresholdDays > reviewDays) {
    throw new Error('Refresh threshold must be an integer from 0 through the review window.');
  }
  const proof = {
    modelId: ORIGIN_VERIFIED_CODING_FREE_MODEL,
    pricing: { prompt: '0', completion: '0' },
    toolCalling: true,
    sourceUrl,
    targetPath,
  } satisfies Pick<OriginCodingFreeModelVerification, 'modelId' | 'pricing' | 'toolCalling' | 'sourceUrl' | 'targetPath'>;

  if (!options.force && Number.isFinite(currentDeadline) && currentDeadline - now.getTime() > refreshThresholdDays * 86_400_000) {
    return { ...proof, verifiedAt: now.toISOString(), reviewAfter: currentReviewAfter!, updated: false };
  }

  const verifiedAt = now.toISOString();
  const reviewAfter = new Date(now.getTime() + reviewDays * 86_400_000 - 1).toISOString();
  const next = updatedCodingFreeModelEvidence(current, verifiedAt, reviewAfter);
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, next, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { ...proof, verifiedAt, reviewAfter, updated: true };
}

export async function writeCodingFreeModelVerificationReport(
  verification: OriginCodingFreeModelVerification,
  reportPath: string,
): Promise<void> {
  const { modelId, pricing, toolCalling, sourceUrl, verifiedAt, reviewAfter, updated } = verification;
  await writeFile(resolve(reportPath), `${JSON.stringify({ modelId, pricing, toolCalling, sourceUrl, verifiedAt, reviewAfter, updated }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  verifyAndRefreshCodingFreeModel({ force: process.argv.includes('--force') })
    .then(async verification => {
      if (process.env.ORIGIN_CODING_FREE_MODEL_EVIDENCE_PATH) {
        await writeCodingFreeModelVerificationReport(verification, process.env.ORIGIN_CODING_FREE_MODEL_EVIDENCE_PATH);
      }
      const { verifiedAt, reviewAfter, updated } = verification;
      console.log(`Verified ${ORIGIN_VERIFIED_CODING_FREE_MODEL} at $0.00 with tool calling; evidence ${updated ? 'refreshed' : 'remains current'} (${verifiedAt} → ${reviewAfter}).`);
    })
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
