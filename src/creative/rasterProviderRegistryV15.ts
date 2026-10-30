import {
  type RasterImageRequestV15,
  type RasterImageResultV15,
  type RasterProviderStatusV15,
} from './rasterImageProviderV15.js';
import {
  generateCloudflareRasterImageV15,
  getCloudflareRasterStatusV15,
} from './cloudflareRasterImageProviderV15.js';
import {
  generateRasterImageV15,
  getRasterProviderStatusV15,
} from './rasterImageProviderV15.js';

export const RASTER_TASKS_V15 = ['text-to-image', 'edit', 'inpaint', 'outpaint', 'variation'] as const;
export type RasterTaskV15 = (typeof RASTER_TASKS_V15)[number];

export type RasterProviderCapabilityV15 = {
  task: RasterTaskV15;
  referenceImages: boolean;
  identityPreservation: boolean;
  deterministicTextOverlay: boolean;
};

export type RasterProviderDescriptorV15 = {
  id: string;
  label: string;
  capabilities: readonly RasterProviderCapabilityV15[];
  zeroCostRequired: true;
  paidFallback: false;
  secretDelivery: 'server-only';
  paymentMethodRequired: false;
};

export type RasterProviderRuntimeV15 = {
  descriptor: RasterProviderDescriptorV15;
  status(env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<RasterProviderStatusV15>;
  generate(input: RasterImageRequestV15, env?: NodeJS.ProcessEnv): Promise<RasterImageResultV15>;
};

const CLOUDFLARE_DESCRIPTOR: RasterProviderDescriptorV15 = {
  id: 'cloudflare-workers-ai-free',
  label: 'Cloudflare Workers AI Free raster runtime',
  capabilities: [
    {
      task: 'text-to-image',
      referenceImages: false,
      identityPreservation: false,
      deterministicTextOverlay: false,
    },
    {
      task: 'edit',
      referenceImages: true,
      identityPreservation: false,
      deterministicTextOverlay: false,
    },
  ],
  zeroCostRequired: true,
  paidFallback: false,
  secretDelivery: 'server-only',
  paymentMethodRequired: false,
};

const POLLINATIONS_DESCRIPTOR: RasterProviderDescriptorV15 = {
  id: 'pollinations-zero-cost',
  label: 'Pollinations verified zero-cost raster runtime',
  capabilities: [
    { task: 'text-to-image', referenceImages: false, identityPreservation: false, deterministicTextOverlay: false },
  ],
  zeroCostRequired: true,
  paidFallback: false,
  secretDelivery: 'server-only',
  paymentMethodRequired: false,
};

// Cloudflare is preferred. Pollinations is considered only when its server-side,
// zero-budget scoped key and live model/usage checks prove a zero-cost path.
// No anonymous or unverified endpoint is treated as free.
const PROVIDERS: readonly RasterProviderRuntimeV15[] = [
  {
    descriptor: CLOUDFLARE_DESCRIPTOR,
    status: (env = process.env, fetchImpl = fetch) => getCloudflareRasterStatusV15(env, fetchImpl),
    generate: (input, env = process.env) => generateCloudflareRasterImageV15(input, env),
  },
  {
    descriptor: POLLINATIONS_DESCRIPTOR,
    status: (env = process.env, fetchImpl = fetch) => getRasterProviderStatusV15(env, fetchImpl),
    generate: (input, env = process.env) => generateRasterImageV15(input, env),
  },
];

export type RasterProviderSelectionV15 =
  | {
      ready: true;
      task: RasterTaskV15;
      provider: RasterProviderRuntimeV15;
      status: RasterProviderStatusV15;
    }
  | {
      ready: false;
      task: RasterTaskV15;
      provider: null;
      statuses: readonly {
        providerId: string;
        ready: boolean;
        reason: string | null;
        supportsTask: boolean;
        status: RasterProviderStatusV15 | null;
      }[];
      reason: 'NO_PROVIDER_SUPPORTS_TASK' | 'NO_VERIFIED_ZERO_COST_PROVIDER_READY';
    };

export function rasterProviderRegistryV15(): readonly RasterProviderDescriptorV15[] {
  return PROVIDERS.map(provider => structuredClone(provider.descriptor));
}

export function resolveRasterProviderV15(task: RasterTaskV15): RasterProviderRuntimeV15 | null {
  return PROVIDERS.find(provider => provider.descriptor.capabilities.some(capability => capability.task === task)) ?? null;
}

type RasterProviderStatusCacheV15 = Map<RasterProviderRuntimeV15, Promise<RasterProviderStatusV15>>;

function cachedProviderStatusV15(
  provider: RasterProviderRuntimeV15,
  env: NodeJS.ProcessEnv,
  cache: RasterProviderStatusCacheV15,
  fetchImpl: typeof fetch,
): Promise<RasterProviderStatusV15> {
  const existing = cache.get(provider);
  if (existing) return existing;
  const pending = provider.status(env, fetchImpl);
  cache.set(provider, pending);
  return pending;
}

async function selectRasterProviderWithCacheV15(
  task: RasterTaskV15,
  env: NodeJS.ProcessEnv,
  cache: RasterProviderStatusCacheV15,
  fetchImpl: typeof fetch,
  excludedProviderIds: ReadonlySet<string> = new Set(),
): Promise<RasterProviderSelectionV15> {
  const statuses: {
    providerId: string;
    ready: boolean;
    reason: string | null;
    supportsTask: boolean;
    status: RasterProviderStatusV15 | null;
  }[] = [];

  let anySupport = false;
  for (const provider of PROVIDERS) {
    const supportsTask = provider.descriptor.capabilities.some(capability => capability.task === task);
    anySupport ||= supportsTask;
    if (excludedProviderIds.has(provider.descriptor.id)) {
      statuses.push({ providerId: provider.descriptor.id, ready: false, reason: 'PROVIDER_PREVIOUSLY_EXHAUSTED', supportsTask, status: null });
      continue;
    }
    if (!supportsTask) {
      statuses.push({
        providerId: provider.descriptor.id,
        ready: false,
        reason: 'TASK_NOT_SUPPORTED',
        supportsTask: false,
        status: null,
      });
      continue;
    }

    let status: RasterProviderStatusV15;
    try {
      status = await cachedProviderStatusV15(provider, env, cache, fetchImpl);
    } catch {
      // One provider's status endpoint/network failure must not prevent probing
      // the next eligible free provider. Unknown status is always unsafe.
      status = {
        configured: false,
        ready: false,
        providerId: provider.descriptor.id as RasterProviderStatusV15['providerId'],
        model: null,
        zeroCostVerified: false,
        paidFallbackEnabled: false,
        paymentMethodRequired: false,
        secretDelivery: 'server-only',
        externalNetwork: true,
        reason: 'PROVIDER_STATUS_UNAVAILABLE',
      };
      statuses.push({
        providerId: provider.descriptor.id,
        ready: false,
        reason: status.reason,
        supportsTask: true,
        status,
      });
      continue;
    }
    const safe = status.ready
      && status.zeroCostVerified
      && status.paidFallbackEnabled === false
      && status.paymentMethodRequired === false
      && status.secretDelivery === 'server-only'
      && status.providerId === provider.descriptor.id;

    statuses.push({
      providerId: provider.descriptor.id,
      ready: safe,
      reason: safe ? null : status.reason ?? 'PROVIDER_NOT_READY',
      supportsTask: true,
      status,
    });

    if (safe) return { ready: true, task, provider, status };
  }

  return {
    ready: false,
    task,
    provider: null,
    statuses,
    reason: anySupport ? 'NO_VERIFIED_ZERO_COST_PROVIDER_READY' : 'NO_PROVIDER_SUPPORTS_TASK',
  };
}

export async function selectRasterProviderV15(
  task: RasterTaskV15,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<RasterProviderSelectionV15> {
  return selectRasterProviderWithCacheV15(task, env, new Map(), fetchImpl);
}

export async function selectRasterProviderExcludingV15(
  task: RasterTaskV15,
  env: NodeJS.ProcessEnv,
  excludedProviderIds: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<RasterProviderSelectionV15> {
  return selectRasterProviderWithCacheV15(task, env, new Map(), fetchImpl, new Set(excludedProviderIds));
}

export async function rasterProviderRuntimeStatusV15(env: NodeJS.ProcessEnv = process.env) {
  const statusCache: RasterProviderStatusCacheV15 = new Map();
  const selections = await Promise.all(
    RASTER_TASKS_V15.map(task => selectRasterProviderWithCacheV15(task, env, statusCache, fetch)),
  );
  const supportedTasks = selections.filter(result => result.ready).map(result => result.task);
  const textSelection = selections.find(result => result.task === 'text-to-image');
  let textToImageStatus: RasterProviderStatusV15 | null = null;
  let textToImageReason: string | null = 'NO_VERIFIED_ZERO_COST_PROVIDER_READY';
  if (textSelection) {
    if (textSelection.ready) {
      textToImageStatus = textSelection.status;
      textToImageReason = null;
    } else if ('statuses' in textSelection) {
      const probed = textSelection.statuses.find(item => item.supportsTask);
      textToImageStatus = probed?.status ?? null;
      textToImageReason = textSelection.reason;
    }
  }
  return {
    providerAgnostic: true,
    registryVersion: 'raster-provider-registry-v1',
    providers: rasterProviderRegistryV15(),
    supportedTasks,
    textToImageReady: supportedTasks.includes('text-to-image'),
    textToImageStatus,
    textToImageReason,
    editingReady: ['edit', 'inpaint', 'outpaint', 'variation'].some(task => supportedTasks.includes(task as RasterTaskV15)),
    paidFallbackEnabled: false,
    freeOnly: true,
  };
}
