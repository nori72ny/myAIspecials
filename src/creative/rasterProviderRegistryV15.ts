import {
  generateRasterImageV15,
  getRasterProviderStatusV15,
  type RasterImageRequestV15,
  type RasterImageResultV15,
  type RasterProviderStatusV15,
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
  status(env?: NodeJS.ProcessEnv): Promise<RasterProviderStatusV15>;
  generate(input: RasterImageRequestV15, env?: NodeJS.ProcessEnv): Promise<RasterImageResultV15>;
};

const POLLINATIONS_DESCRIPTOR: RasterProviderDescriptorV15 = {
  id: 'pollinations-zero-cost',
  label: 'Pollinations audited zero-cost raster runtime',
  capabilities: [{
    task: 'text-to-image',
    referenceImages: false,
    identityPreservation: false,
    deterministicTextOverlay: false,
  }],
  zeroCostRequired: true,
  paidFallback: false,
  secretDelivery: 'server-only',
  paymentMethodRequired: false,
};

const PROVIDERS: readonly RasterProviderRuntimeV15[] = [{
  descriptor: POLLINATIONS_DESCRIPTOR,
  status: (env = process.env) => getRasterProviderStatusV15(env),
  generate: (input, env = process.env) => generateRasterImageV15(input, env),
}];

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
      }[];
      reason: 'NO_PROVIDER_SUPPORTS_TASK' | 'NO_VERIFIED_ZERO_COST_PROVIDER_READY';
    };

export function rasterProviderRegistryV15(): readonly RasterProviderDescriptorV15[] {
  return PROVIDERS.map(provider => structuredClone(provider.descriptor));
}

export async function selectRasterProviderV15(
  task: RasterTaskV15,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RasterProviderSelectionV15> {
  const statuses: {
    providerId: string;
    ready: boolean;
    reason: string | null;
    supportsTask: boolean;
  }[] = [];

  let anySupport = false;
  for (const provider of PROVIDERS) {
    const supportsTask = provider.descriptor.capabilities.some(capability => capability.task === task);
    anySupport ||= supportsTask;
    if (!supportsTask) {
      statuses.push({
        providerId: provider.descriptor.id,
        ready: false,
        reason: 'TASK_NOT_SUPPORTED',
        supportsTask: false,
      });
      continue;
    }

    const status = await provider.status(env);
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

export async function rasterProviderRuntimeStatusV15(env: NodeJS.ProcessEnv = process.env) {
  const selections = await Promise.all(RASTER_TASKS_V15.map(task => selectRasterProviderV15(task, env)));
  const supportedTasks = selections.filter(result => result.ready).map(result => result.task);
  return {
    providerAgnostic: true,
    registryVersion: 'raster-provider-registry-v1',
    providers: rasterProviderRegistryV15(),
    supportedTasks,
    textToImageReady: supportedTasks.includes('text-to-image'),
    editingReady: ['edit', 'inpaint', 'outpaint', 'variation'].some(task => supportedTasks.includes(task as RasterTaskV15)),
    paidFallbackEnabled: false,
    freeOnly: true,
  };
}
