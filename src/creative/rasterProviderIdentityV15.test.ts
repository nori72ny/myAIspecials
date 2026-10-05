import { describe, expect, it } from 'vitest';
import { isRasterProviderIdV15, isCloudflareRasterProviderIdV15 } from './rasterProviderIdentityV15';

describe('raster provider identity boundaries', () => {
  it.each(['cloudflare-workers-ai-free', 'cloudflare-workers-ai-gateway'])('accepts the exact Cloudflare identity %s', (id) => {
    expect(isRasterProviderIdV15(id)).toBe(true);
    expect(isCloudflareRasterProviderIdV15(id)).toBe(true);
  });
  it('retains legacy history without admitting it to Cloudflare private evaluation', () => {
    expect(isRasterProviderIdV15('pollinations-zero-cost')).toBe(true);
    expect(isCloudflareRasterProviderIdV15('pollinations-zero-cost')).toBe(false);
  });
  it.each([null, undefined, '', 'other', 'cloudflare-workers-ai-gateway-paid', ' cloudflare-workers-ai-gateway'])('rejects unknown or malformed identity %s', (id) => {
    expect(isRasterProviderIdV15(id)).toBe(false);
    expect(isCloudflareRasterProviderIdV15(id)).toBe(false);
  });
});
