import { createHash } from 'node:crypto';
import { resolveRasterProviderV15, rasterProviderByIdV15, type RasterProviderRuntimeV15 } from './rasterProviderRegistryV15.js';
import { critiqueRasterStructureV15 } from './rasterImageCriticV15.js';
import { critiqueCloudflareRasterSemanticV15 } from './cloudflareRasterSemanticCriticV15.js';
import type { RasterImageRequestV15, RasterImageResultV15, RasterProviderStatusV15 } from './rasterImageProviderV15.js';

export const RASTER_LIVE_QUALIFICATION_VERSION_V15 = 'raster-live-qualification-v1' as const;
const LIVE_OPT_IN = 'ORIGIN_RASTER_LIVE_QUALIFICATION';

const GENERATION_PROMPT = [
  'Professional product studio photograph of one matte teal ceramic mug.',
  'Centered composition on a warm light-gray seamless background.',
  'Soft realistic shadow, natural ceramic texture, balanced commercial lighting.',
  'No people, no text, no logo, no watermark.',
].join(' ');

const EDIT_PROMPT = [
  'Use image 0 as the authoritative reference.',
  'Preserve the mug shape, teal color, scale, camera angle, and centered position.',
  'Change only the background to a deep navy premium studio backdrop with a subtle soft gradient.',
  'Keep the scene photorealistic and commercial. No text, no logo, no watermark.',
].join(' ');

export type RasterLivePhaseEvidenceV15 = {
  sha256: string;
  mimeType: RasterImageResultV15['mimeType'];
  providerId: string;
  model: string;
  width: number;
  height: number;
  durationMs: number;
  providerReportedExternalNetworkRequests: number;
  structural: ReturnType<typeof critiqueRasterStructureV15>;
  semantic: Awaited<ReturnType<typeof critiqueCloudflareRasterSemanticV15>>;
};

export type RasterLiveQualificationEvidenceV15 = {
  version: typeof RASTER_LIVE_QUALIFICATION_VERSION_V15;
  state: 'blocked' | 'failed' | 'passed';
  reason: string | null;
  generatedAt: string;
  provider: {
    id: string;
    configured: boolean;
    ready: boolean;
    model: string | null;
    zeroCostVerified: boolean;
    paymentMethodRequired: boolean;
    paidFallbackEnabled: boolean;
    secretDelivery: 'server-only';
  };
  generation: RasterLivePhaseEvidenceV15 | null;
  edit: RasterLivePhaseEvidenceV15 | null;
  invariants: {
    freeOnly: true;
    costUsd: 0;
    paidFallbackEnabled: false;
    secretDelivery: 'server-only';
    explicitLiveOptInRequired: true;
    credentialsIncludedInEvidence: false;
    rawImageBytesIncludedInEvidence: false;
  };
  evidenceSha256: string;
};

type QualifyOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  generatedAt?: string;
};

function safeProviderEvidence(status: RasterProviderStatusV15) {
  return {
    id: status.providerId,
    configured: status.configured,
    ready: status.ready,
    model: status.model,
    zeroCostVerified: status.zeroCostVerified,
    paymentMethodRequired: status.paymentMethodRequired,
    paidFallbackEnabled: status.paidFallbackEnabled,
    secretDelivery: status.secretDelivery,
  };
}

function evidenceHash(value: Omit<RasterLiveQualificationEvidenceV15, 'evidenceSha256'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function finalize(value: Omit<RasterLiveQualificationEvidenceV15, 'evidenceSha256'>): RasterLiveQualificationEvidenceV15 {
  return { ...value, evidenceSha256: evidenceHash(value) };
}

async function runPhase(
  runtime: RasterProviderRuntimeV15,
  input: RasterImageRequestV15,
  originalRequest: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<{ evidence: RasterLivePhaseEvidenceV15; result: RasterImageResultV15 }> {
  const started = now();
  const result = await runtime.generate(input, env, fetchImpl);
  if (result.providerId !== runtime.descriptor.id) throw new Error('RASTER_LIVE_PROVIDER_IDENTITY_MISMATCH');
  const structural = critiqueRasterStructureV15(result.bytes, result.mimeType, result.width, result.height);
  if (!structural.passed) throw new Error('RASTER_LIVE_STRUCTURAL_CRITIC_REJECTED');

  const semantic = await critiqueCloudflareRasterSemanticV15({
    originalRequest,
    bytes: result.bytes,
    mimeType: result.mimeType,
  }, env, fetchImpl);
  if (!semantic.passed) throw new Error('RASTER_LIVE_SEMANTIC_CRITIC_REJECTED');

  return {
    result,
    evidence: {
      sha256: result.sha256,
      mimeType: result.mimeType,
      providerId: result.providerId,
      model: result.model,
      width: result.width,
      height: result.height,
      durationMs: Math.max(0, now() - started),
      providerReportedExternalNetworkRequests: result.externalNetworkRequests + semantic.externalNetworkRequests,
      structural,
      semantic,
    },
  };
}

export async function qualifyRasterLiveV15(options: QualifyOptions = {}): Promise<RasterLiveQualificationEvidenceV15> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  // An explicitly targeted gateway must never qualify the REST provider instead.
  const targetsGateway = Boolean(env.ORIGIN_RASTER_GATEWAY_URL?.trim() || env.ORIGIN_RASTER_GATEWAY_SECRET?.trim());
  const runtime = targetsGateway
    ? rasterProviderByIdV15('cloudflare-workers-ai-gateway')
    : resolveRasterProviderV15('text-to-image', env);
  if (!runtime) throw new Error('RASTER_LIVE_PROVIDER_UNAVAILABLE');
  const baseInvariants = {
    freeOnly: true as const,
    costUsd: 0 as const,
    paidFallbackEnabled: false as const,
    secretDelivery: 'server-only' as const,
    explicitLiveOptInRequired: true as const,
    credentialsIncludedInEvidence: false as const,
    rawImageBytesIncludedInEvidence: false as const,
  };

  if (env[LIVE_OPT_IN]?.trim().toLowerCase() !== 'true') {
    return finalize({
      version: RASTER_LIVE_QUALIFICATION_VERSION_V15,
      state: 'blocked',
      reason: 'EXPLICIT_LIVE_QUALIFICATION_OPT_IN_REQUIRED',
      generatedAt,
      provider: {
        id: runtime.descriptor.id,
        configured: false,
        ready: false,
        model: null,
        zeroCostVerified: false,
        paymentMethodRequired: false,
        paidFallbackEnabled: false,
        secretDelivery: 'server-only',
      },
      generation: null,
      edit: null,
      invariants: baseInvariants,
    });
  }

  const status = await runtime.status(env, fetchImpl);
  const provider = safeProviderEvidence(status);
  if (status.providerId !== runtime.descriptor.id
    || !status.ready
    || !status.zeroCostVerified
    || status.paymentMethodRequired
    || status.paidFallbackEnabled
    || status.secretDelivery !== 'server-only') {
    return finalize({
      version: RASTER_LIVE_QUALIFICATION_VERSION_V15,
      state: 'blocked',
      reason: status.reason ?? 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED',
      generatedAt,
      provider,
      generation: null,
      edit: null,
      invariants: baseInvariants,
    });
  }

  let generation: RasterLivePhaseEvidenceV15 | null = null;
  let edit: RasterLivePhaseEvidenceV15 | null = null;
  try {
    const generated = await runPhase(runtime, {
      prompt: GENERATION_PROMPT,
      negativePrompt: 'text, lettering, logo, watermark, duplicate mug, extra objects',
      width: 384,
      height: 384,
    }, GENERATION_PROMPT, env, fetchImpl, now);
    generation = generated.evidence;

    const edited = await runPhase(runtime, {
      prompt: EDIT_PROMPT,
      negativePrompt: 'text, lettering, logo, watermark, extra objects, changed mug shape, changed mug color',
      width: 384,
      height: 384,
      referenceImages: [{
        bytes: generated.result.bytes,
        mimeType: generated.result.mimeType,
        width: generated.result.width,
        height: generated.result.height,
      }],
    }, EDIT_PROMPT, env, fetchImpl, now);
    edit = edited.evidence;

    if (edit.sha256 === generation.sha256) throw new Error('RASTER_LIVE_EDIT_DID_NOT_CHANGE_OUTPUT');

    return finalize({
      version: RASTER_LIVE_QUALIFICATION_VERSION_V15,
      state: 'passed',
      reason: null,
      generatedAt,
      provider,
      generation,
      edit,
      invariants: baseInvariants,
    });
  } catch (error) {
    return finalize({
      version: RASTER_LIVE_QUALIFICATION_VERSION_V15,
      state: 'failed',
      reason: error instanceof Error ? error.message : 'RASTER_LIVE_QUALIFICATION_FAILED',
      generatedAt,
      provider,
      generation,
      edit,
      invariants: baseInvariants,
    });
  }
}
