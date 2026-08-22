import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ORIGIN_VERIFIED_FREE_MODEL = 'google/gemma-4-26b-a4b-it:free' as const;
export const OPENROUTER_MODELS_API = 'https://openrouter.ai/api/v1/models' as const;
const DEFAULT_REVIEW_DAYS = 10;
const DEFAULT_REFRESH_THRESHOLD_DAYS = 3;

type OpenRouterModel = {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
};

const isExactZeroPrice = (value: unknown): boolean => {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
};

export function verifyFreeModelPayload(payload: unknown): OpenRouterModel {
  const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: OpenRouterModel[] }).data
    : null;
  if (!data) throw new Error('OpenRouter /models response does not contain a data array.');
  const matches = data.filter((model) => model?.id === ORIGIN_VERIFIED_FREE_MODEL);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${ORIGIN_VERIFIED_FREE_MODEL} entry; received ${matches.length}.`);
  const model = matches[0];
  if (!isExactZeroPrice(model.pricing?.prompt) || !isExactZeroPrice(model.pricing?.completion)) {
    throw new Error('The fixed model is not verified at $0.00 for both prompt and completion pricing.');
  }
  return model;
}

export function updatedFreeModelCatalog(source: string, verifiedAt: string, reviewAfter: string): string {
  if (!source.includes(`modelId: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL`)) throw new Error('Fixed model catalog entry was not found.');
  const verifiedMatches = source.match(/verifiedAt: "[^"]+"/g) ?? [];
  const reviewMatches = source.match(/reviewAfter: "[^"]+"/g) ?? [];
  if (verifiedMatches.length !== 1 || reviewMatches.length !== 1) throw new Error('Catalog timestamps are ambiguous; refusing to update.');
  return source
    .replace(verifiedMatches[0], `verifiedAt: "${verifiedAt}"`)
    .replace(reviewMatches[0], `reviewAfter: "${reviewAfter}"`)
    .replace(/This evidence expires on [0-9TZ:.-]+\./, `This evidence expires on ${reviewAfter}.`);
}

export async function verifyAndRefreshFreeModel(options: {
  fetchImpl?: typeof fetch;
  catalogPath?: string;
  now?: Date;
  reviewDays?: number;
  modelsUrl?: string;
  force?: boolean;
  refreshThresholdDays?: number;
} = {}): Promise<{ verifiedAt: string; reviewAfter: string; catalogPath: string; updated: boolean }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const catalogPath = resolve(options.catalogPath ?? 'src/lib/orchestration/OriginFreeModelCatalog.ts');
  const reviewDays = options.reviewDays ?? DEFAULT_REVIEW_DAYS;
  if (!Number.isInteger(reviewDays) || reviewDays < 1 || reviewDays > 30) throw new Error('Review window must be an integer from 1 to 30 days.');
  const response = await fetchImpl(options.modelsUrl ?? OPENROUTER_MODELS_API, {
    headers: { Accept: 'application/json', 'User-Agent': 'ORIGIN-Personal-Free-Model-Verifier/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRouter /models verification failed with HTTP ${response.status}.`);
  verifyFreeModelPayload(await response.json());

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Verification time is invalid.');
  const current = await readFile(catalogPath, 'utf8');
  const currentReviewAfter = current.match(/reviewAfter: "([^"]+)"/)?.[1];
  const currentDeadline = currentReviewAfter ? Date.parse(currentReviewAfter) : Number.NaN;
  const refreshThresholdDays = options.refreshThresholdDays ?? DEFAULT_REFRESH_THRESHOLD_DAYS;
  if (!Number.isInteger(refreshThresholdDays) || refreshThresholdDays < 0 || refreshThresholdDays > reviewDays) throw new Error('Refresh threshold must be an integer from 0 through the review window.');
  if (!options.force && Number.isFinite(currentDeadline) && currentDeadline - now.getTime() > refreshThresholdDays * 86_400_000) {
    return { verifiedAt: now.toISOString(), reviewAfter: currentReviewAfter!, catalogPath, updated: false };
  }
  const verifiedAt = now.toISOString();
  const reviewAfter = new Date(now.getTime() + reviewDays * 86_400_000 - 1).toISOString();
  const next = updatedFreeModelCatalog(current, verifiedAt, reviewAfter);
  const temporaryPath = `${catalogPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, next, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, catalogPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { verifiedAt, reviewAfter, catalogPath, updated: true };
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  verifyAndRefreshFreeModel({ force: process.argv.includes('--force') })
    .then(({ verifiedAt, reviewAfter, updated }) => console.log(`Verified ${ORIGIN_VERIFIED_FREE_MODEL} at $0.00; evidence ${updated ? 'refreshed' : 'remains current'} (${verifiedAt} → ${reviewAfter}).`))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
