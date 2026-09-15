import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ORIGIN_VERIFIED_FREE_MODEL = 'inclusionai/ling-3.0-flash-sante:free' as const;
export const ORIGIN_VERIFIED_CODING_FREE_MODEL = 'inclusionai/ling-3.0-flash:free' as const;
export const ORIGIN_VERIFIED_FREE_MODELS = [
  ORIGIN_VERIFIED_FREE_MODEL,
  ORIGIN_VERIFIED_CODING_FREE_MODEL,
] as const;
export const OPENROUTER_MODELS_API = 'https://openrouter.ai/api/v1/models' as const;
const DEFAULT_REVIEW_DAYS = 10;
const DEFAULT_REFRESH_THRESHOLD_DAYS = 3;
const RETRYABLE_MODELS_API_STATUSES = new Set([429, 500, 502, 503, 504]);

const MODEL_SPECS = [
  { modelId: ORIGIN_VERIFIED_FREE_MODEL, catalogMarker: 'ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL' },
  { modelId: ORIGIN_VERIFIED_CODING_FREE_MODEL, catalogMarker: 'ORIGIN_CODING_OPENROUTER_FREE_MODEL' },
] as const;

type OriginVerifiedFreeModelId = (typeof ORIGIN_VERIFIED_FREE_MODELS)[number];
type OpenRouterModel = {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
};

export type OriginVerifiedFreeModelProof = {
  modelId: OriginVerifiedFreeModelId;
  pricing: { prompt: '0'; completion: '0' };
};

export type OriginFreeModelVerification = {
  models: OriginVerifiedFreeModelProof[];
  sourceUrl: string;
  verifiedAt: string;
  reviewAfter: string;
  catalogPath: string;
  updated: boolean;
};

const isExactZeroPrice = (value: unknown): boolean => {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
};

export function verifyFreeModelPayload(
  payload: unknown,
  modelId: OriginVerifiedFreeModelId = ORIGIN_VERIFIED_FREE_MODEL,
): OpenRouterModel {
  const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: OpenRouterModel[] }).data
    : null;
  if (!data) throw new Error('OpenRouter /models response does not contain a data array.');
  const matches = data.filter((model) => model?.id === modelId);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${modelId} entry; received ${matches.length}.`);
  const model = matches[0];
  if (!isExactZeroPrice(model.pricing?.prompt) || !isExactZeroPrice(model.pricing?.completion)) {
    throw new Error(`The fixed model ${modelId} is not verified at $0.00 for both prompt and completion pricing.`);
  }
  return model;
}

function verifyAllFreeModels(payload: unknown): OriginVerifiedFreeModelProof[] {
  return MODEL_SPECS.map(({ modelId }) => {
    verifyFreeModelPayload(payload, modelId);
    return { modelId, pricing: { prompt: '0', completion: '0' } };
  });
}

function catalogEntryBounds(source: string, marker: string): { start: number; end: number } {
  const token = `modelId: ${marker}`;
  const matches = [...source.matchAll(new RegExp(token, 'g'))];
  if (matches.length !== 1 || matches[0].index === undefined) throw new Error(`Catalog entry ${marker} is missing or ambiguous.`);
  const markerIndex = matches[0].index;
  const start = source.lastIndexOf('  {', markerIndex);
  const closing = source.indexOf('\n  },', markerIndex);
  if (start < 0 || closing < 0) throw new Error(`Catalog entry ${marker} boundaries are invalid.`);
  return { start, end: closing + '\n  },'.length };
}

function catalogDeadline(source: string, marker: string): number {
  const { start, end } = catalogEntryBounds(source, marker);
  const block = source.slice(start, end);
  const matches = block.match(/reviewAfter: "([^"]+)"/g) ?? [];
  if (matches.length !== 1) throw new Error(`Catalog deadline ${marker} is missing or ambiguous.`);
  const value = matches[0].match(/reviewAfter: "([^"]+)"/)?.[1];
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Catalog deadline ${marker} is invalid.`);
  return parsed;
}

function replaceEntryTimestamps(block: string, verifiedAt: string, reviewAfter: string, marker: string): string {
  const verifiedMatches = block.match(/verifiedAt: "[^"]+"/g) ?? [];
  const reviewMatches = block.match(/reviewAfter: "[^"]+"/g) ?? [];
  if (verifiedMatches.length !== 1 || reviewMatches.length !== 1) throw new Error(`Catalog timestamps ${marker} are ambiguous; refusing to update.`);
  return block
    .replace(verifiedMatches[0], `verifiedAt: "${verifiedAt}"`)
    .replace(reviewMatches[0], `reviewAfter: "${reviewAfter}"`);
}

export function updatedFreeModelCatalog(source: string, verifiedAt: string, reviewAfter: string): string {
  let next = source;
  for (const { catalogMarker } of MODEL_SPECS) {
    const { start, end } = catalogEntryBounds(next, catalogMarker);
    const block = next.slice(start, end);
    next = `${next.slice(0, start)}${replaceEntryTimestamps(block, verifiedAt, reviewAfter, catalogMarker)}${next.slice(end)}`;
  }
  return next;
}

export async function verifyAndRefreshFreeModel(options: {
  fetchImpl?: typeof fetch;
  catalogPath?: string;
  now?: Date;
  reviewDays?: number;
  modelsUrl?: string;
  force?: boolean;
  refreshThresholdDays?: number;
} = {}): Promise<OriginFreeModelVerification> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const catalogPath = resolve(options.catalogPath ?? 'src/lib/orchestration/OriginFreeModelCatalog.ts');
  const reviewDays = options.reviewDays ?? DEFAULT_REVIEW_DAYS;
  if (!Number.isInteger(reviewDays) || reviewDays < 1 || reviewDays > 30) throw new Error('Review window must be an integer from 1 to 30 days.');
  const sourceUrl = options.modelsUrl ?? OPENROUTER_MODELS_API;
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(sourceUrl, {
        headers: { Accept: 'application/json', 'User-Agent': 'ORIGIN-Personal-Free-Model-Verifier/1.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok || !RETRYABLE_MODELS_API_STATUSES.has(response.status) || attempt === 1) break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  if (!response?.ok) throw new Error(`OpenRouter /models verification failed with HTTP ${response?.status ?? 'unavailable'}.`);
  const models = verifyAllFreeModels(await response.json());

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Verification time is invalid.');
  const current = await readFile(catalogPath, 'utf8');
  const currentDeadlines = MODEL_SPECS.map(({ catalogMarker }) => catalogDeadline(current, catalogMarker));
  const earliestDeadline = Math.min(...currentDeadlines);
  const refreshThresholdDays = options.refreshThresholdDays ?? DEFAULT_REFRESH_THRESHOLD_DAYS;
  if (!Number.isInteger(refreshThresholdDays) || refreshThresholdDays < 0 || refreshThresholdDays > reviewDays) throw new Error('Refresh threshold must be an integer from 0 through the review window.');
  const common = { models, sourceUrl, catalogPath } satisfies Pick<OriginFreeModelVerification, 'models' | 'sourceUrl' | 'catalogPath'>;
  if (!options.force && earliestDeadline - now.getTime() > refreshThresholdDays * 86_400_000) {
    return { ...common, verifiedAt: now.toISOString(), reviewAfter: new Date(earliestDeadline).toISOString(), updated: false };
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
  return { ...common, verifiedAt, reviewAfter, updated: true };
}

export async function writeFreeModelVerificationReport(
  verification: OriginFreeModelVerification,
  reportPath: string,
): Promise<void> {
  const { models, sourceUrl, verifiedAt, reviewAfter, updated } = verification;
  await writeFile(resolve(reportPath), `${JSON.stringify({ models, sourceUrl, verifiedAt, reviewAfter, updated }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  verifyAndRefreshFreeModel({ force: process.argv.includes('--force') })
    .then(async (verification) => {
      if (process.env.ORIGIN_FREE_MODEL_EVIDENCE_PATH) {
        await writeFreeModelVerificationReport(verification, process.env.ORIGIN_FREE_MODEL_EVIDENCE_PATH);
      }
      const { verifiedAt, reviewAfter, updated, models } = verification;
      console.log(`Verified ${models.map(({ modelId }) => modelId).join(', ')} at $0.00; evidence ${updated ? 'refreshed' : 'remains current'} (${verifiedAt} → ${reviewAfter}).`);
    })
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
