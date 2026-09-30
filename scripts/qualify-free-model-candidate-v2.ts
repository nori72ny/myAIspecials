import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY } from '../src/legacy/zeroCostRoutingPolicy.js';
import {
  ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2,
  qualifyOriginFreeModelCandidateV2,
  type OriginFreeModelCandidateEvidenceV2,
} from '../src/lib/orchestration/OriginFreeModelCandidateQualificationV2.js';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`FREE_MODEL_CANDIDATE_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function zero(value: unknown): value is 0 {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && Math.abs(number) <= Number.EPSILON;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonical(value: string): string {
  return value.replace(/:free$/i, '');
}

async function fetchJson(url: string, init: RequestInit): Promise<{ response: Response; value: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  let value: any;
  try {
    value = await response.json();
  } catch {
    throw new Error('FREE_MODEL_CANDIDATE_INVALID_JSON');
  }
  if (!response.ok) {
    const upstream = typeof value?.error?.message === 'string' ? value.error.message.slice(0, 160) : `HTTP_${response.status}`;
    throw new Error(`FREE_MODEL_CANDIDATE_UPSTREAM_FAILED:${upstream.replace(/[^A-Za-z0-9_.:-]/g, '_')}`);
  }
  return { response, value };
}

async function liveCheck(modelId: string, apiKey: string, checkId: string, prompt: string) {
  const { value } = await fetchJson(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://origin-personal.vercel.app/',
      'X-OpenRouter-Title': 'ORIGIN Free Model Qualification',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        {
          role: 'system',
          content: 'This is a public synthetic compatibility check. Follow the user instruction exactly. Do not use tools.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 96,
      temperature: 0,
      usage: { include: true },
      provider: ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY,
    }),
  });

  const servedModel = typeof value?.model === 'string' ? value.model.trim() : '';
  const content = value?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  if (!servedModel || !text) throw new Error('FREE_MODEL_CANDIDATE_EMPTY_LIVE_RESPONSE');
  if (!zero(value?.usage?.cost)) throw new Error('FREE_MODEL_CANDIDATE_NONZERO_OR_UNKNOWN_USAGE_COST');
  const upstreamCost = value?.usage?.cost_details?.upstream_inference_cost;
  if (upstreamCost !== undefined && !zero(upstreamCost)) {
    throw new Error('FREE_MODEL_CANDIDATE_NONZERO_UPSTREAM_COST');
  }
  if (value?.usage?.is_byok === true) throw new Error('FREE_MODEL_CANDIDATE_BYOK_BLOCKED');
  const servedMatches = servedModel === modelId || servedModel === canonical(modelId);
  if (!servedMatches) throw new Error('FREE_MODEL_CANDIDATE_SERVED_MODEL_MISMATCH');

  return {
    checkId,
    requestedModel: modelId,
    servedModel,
    providerZdrRequested: true as const,
    dataCollectionDenied: true as const,
    fallbacksDisabled: true as const,
    maxPromptPriceUsd: 0 as const,
    maxCompletionPriceUsd: 0 as const,
    maxRequestPriceUsd: 0 as const,
    actualCostUsd: 0 as const,
    usageCostUsd: 0 as const,
    responseReceived: true as const,
  };
}

async function main(): Promise<void> {
  const modelId = requiredEnv('ORIGIN_FREE_MODEL_CANDIDATE');
  const apiKey = requiredEnv('OPENROUTER_API_KEY');
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i.test(modelId)) {
    throw new Error('FREE_MODEL_CANDIDATE_MODEL_ID_INVALID');
  }

  const { value: catalog } = await fetchJson(MODELS_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const models = Array.isArray(catalog?.data) ? catalog.data : [];
  const matches = models.filter((row: any) => row?.id === modelId);
  if (matches.length !== 1) throw new Error('FREE_MODEL_CANDIDATE_CATALOG_IDENTITY_INVALID');
  const model = matches[0];
  if (!zero(model?.pricing?.prompt) || !zero(model?.pricing?.completion)) {
    throw new Error('FREE_MODEL_CANDIDATE_NOT_ZERO_PRICE');
  }

  const liveChecks = [
    await liveCheck(modelId, apiKey, 'identity-01', 'Reply with exactly: ORIGIN_FREE_CALIBRATION_OK'),
    await liveCheck(modelId, apiKey, 'arithmetic-01', 'Compute 17 × 23. Reply with only the integer.'),
  ];

  const verifiedAt = new Date();
  const reviewAfter = new Date(verifiedAt.getTime() + 3 * 24 * 60 * 60 * 1000 - 1);
  const evidence: OriginFreeModelCandidateEvidenceV2 = {
    schemaVersion: ORIGIN_FREE_MODEL_CANDIDATE_QUALIFICATION_SCHEMA_V2,
    modelId,
    source: 'openrouter-official',
    sourceUrl: `https://openrouter.ai/${canonical(modelId)}:free`,
    verifiedAt: verifiedAt.toISOString(),
    reviewAfter: reviewAfter.toISOString(),
    catalogArtifactDigest: sha256(JSON.stringify(model)),
    pricing: {
      promptUsdPerToken: 0,
      completionUsdPerToken: 0,
    },
    syntheticPublicCalibrationOnly: true,
    liveChecks,
  };

  const qualification = qualifyOriginFreeModelCandidateV2(evidence, verifiedAt.getTime());
  const report = { evidence, qualification };
  const outputPath = resolve(process.env.ORIGIN_FREE_MODEL_CANDIDATE_REPORT_PATH ?? 'test-results/free-model-candidate-v2.json');
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({
    event: 'free-model-candidate-qualified',
    modelId,
    eligibleForQualityBenchmark: qualification.eligibleForQualityBenchmark,
    blockers: qualification.blockers,
  }) + '\n');
  if (!qualification.eligibleForQualityBenchmark) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'FREE_MODEL_CANDIDATE_QUALIFICATION_FAILED';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
