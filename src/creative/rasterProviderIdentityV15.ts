export const RASTER_PROVIDER_IDS_V15 = [
  'pollinations-zero-cost',
  'cloudflare-workers-ai-free',
  'cloudflare-workers-ai-gateway',
] as const;

export type RasterProviderIdV15 = (typeof RASTER_PROVIDER_IDS_V15)[number];

const RASTER_PROVIDER_ID_SET_V15 = new Set<string>(RASTER_PROVIDER_IDS_V15);

export function isRasterProviderIdV15(value: unknown): value is RasterProviderIdV15 {
  return typeof value === 'string' && RASTER_PROVIDER_ID_SET_V15.has(value);
}

export const CLOUDFLARE_RASTER_PROVIDER_IDS_V15 = [
  'cloudflare-workers-ai-free',
  'cloudflare-workers-ai-gateway',
] as const;

export type CloudflareRasterProviderIdV15 = (typeof CLOUDFLARE_RASTER_PROVIDER_IDS_V15)[number];

const CLOUDFLARE_RASTER_PROVIDER_ID_SET_V15 = new Set<string>(CLOUDFLARE_RASTER_PROVIDER_IDS_V15);

export function isCloudflareRasterProviderIdV15(value: unknown): value is CloudflareRasterProviderIdV15 {
  return typeof value === 'string' && CLOUDFLARE_RASTER_PROVIDER_ID_SET_V15.has(value);
}
