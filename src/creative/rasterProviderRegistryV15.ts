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
  cloudflareRasterGatewayConfiguredV15,
  generateCloudflareRasterGatewayImageV15,
  getCloudflareRasterGatewayStatusV15,
} from './cloudflareRasterGatewayProviderV15.js';

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
  generate(input: RasterImageRequestV15, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<RasterImageResultV15>;
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

const GATEWAY_DESCRIPTOR: RasterProviderDescriptorV15 = {
  ...CLOUDFLARE_DESCRIPTOR,
  id: 'cloudflare-workers-ai-gateway',
  label: 'Cloudflare Workers AI server-bound gateway',
};

const PROVIDERS: readonly RasterProviderRuntimeV15[] = [
  {
    descriptor: GATEWAY_DESCRIPTOR,
    status: (env = process.env, fetchImpl) => getCloudflareRasterGatewayStatusV15(env, fetchImpl),
    generate: (input, env = process.env, fetchImpl) => generateCloudflareRasterGatewayImageV15(input, env, fetchImpl),
  },
  {
    descriptor: CLOUDFLARE_DESCRIPTOR,
    status: (env = process.env, fetchImpl) => getCloudflareRasterStatusV15(env, fetchImpl),
    generate: (input, env = process.env, fetchImpl) => generateCloudflareRasterImageV15(input, env, fetchImpl),
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

export function rasterProviderByIdV15(id: string): RasterProviderRuntimeV15 | null {
  return PROVIDERS.find(provider => provider.descriptor.id === id) ?? null;
}

export function resolveRasterProviderV15(
  task: RasterTaskV15,
  env: NodeJS.ProcessEnv = process.env,
): RasterProviderRuntimeV15 | null {
  if (cloudflareRasterGatewayConfiguredV15(env)) {
    const gateway = PROVIDERS.find(provider => provider.descriptor.id === 'cloudflare-workers-ai-gateway'
      && provider.descriptor.capabilities.some(capability => capability.task === task));
    if (gateway) return gateway;
  }
  return PROVIDERS.find(provider => provider.descriptor.id !== 'cloudflare-workers-ai-gateway'
    && provider.descriptor.capabilities.some(capability => capability.task === task)) ?? null;
}

function orderedProvidersV15(env: NodeJS.ProcessEnv): readonly RasterProviderRuntimeV15[] {
  const gatewayReadyForSelection = cloudflareRasterGatewayConfiguredV15(env);
  return gatewayReadyForSelection
    ? PROVIDERS
    : [...PROVIDERS].sort((a, b) =>
        Number(a.descriptor.id === 'cloudflare-workers-ai-gateway')
        - Number(b.descriptor.id === 'cloudflare-workers-ai-gateway'));
}

type RasterProviderStatusCacheV15 = Map<RasterProviderRuntimeV15, Promise<RasterProviderStatusV15>>;

function cachedProviderStatusV15(
  provider: RasterProviderRuntimeV15,
  env: NodeJS.ProcessEnv,
  cache: RasterProviderStatusCacheV15,
): Promise<RasterProviderStatusV15> {
  const existing = cache.get(provider);
  if (existing) return existing;
  const pending = provider.status(env);
  cache.set(provider, pending);
  return pending;
}

async function selectRasterProviderWithCacheV15(
  task: RasterTaskV15,
  env: NodeJS.ProcessEnv,
  cache: RasterProviderStatusCacheV15,
): Promise<RasterProviderSelectionV15> {
  const statuses: {
    providerId: string;
    ready: boolean;
    reason: string | null;
    supportsTask: boolean;
    status: RasterProviderStatusV15 | null;
  }[] = [];

  let anySupport = false;
  for (const provider of orderedProvidersV15(env)) {
    const supportsTask = provider.descriptor.capabilities.some(capability => capability.task === task);
    anySupport ||= supportsTask;
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

    const status = await cachedProviderStatusV15(provider, env, cache);
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
): Promise<RasterProviderSelectionV15> {
  return selectRasterProviderWithCacheV15(task, env, new Map());
}

export async function rasterProviderRuntimeStatusV15(env: NodeJS.ProcessEnv = process.env) {
  const statusCache: RasterProviderStatusCacheV15 = new Map();
  const selections = await Promise.all(
    RASTER_TASKS_V15.map(task => selectRasterProviderWithCacheV15(task, env, statusCache)),
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
      textToImageReason = probed?.reason ?? textSelection.reason;
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
