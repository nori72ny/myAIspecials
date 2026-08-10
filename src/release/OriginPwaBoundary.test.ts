import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const readPngDimensions = (path: string) => {
  const png = readFileSync(resolve(process.cwd(), path));

  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
};

describe('ORIGIN PWA boundary', () => {
  it('defines an installable same-origin standalone manifest', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest'));

    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBeUndefined();
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]));
  });

  it('registers only in a secure top-level browsing context', () => {
    const registration = read('src/pwa/registerServiceWorker.ts');

    expect(registration).toContain("'serviceWorker' in navigator");
    expect(registration).toContain('window.isSecureContext');
    expect(registration).toContain('window.self !== window.top');
    expect(registration).toContain("updateViaCache: 'none'");
  });

  it('ships correctly sized application icons', () => {
    expect(readPngDimensions('public/pwa-192.png')).toEqual({ width: 192, height: 192 });
    expect(readPngDimensions('public/pwa-512.png')).toEqual({ width: 512, height: 512 });
    expect(readPngDimensions('public/pwa-maskable-512.png')).toEqual({ width: 512, height: 512 });
    expect(readPngDimensions('public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });

  it('never caches APIs, non-GET requests, or authenticated requests', () => {
    const worker = read('public/sw.js');

    expect(worker).toContain("request.method !== 'GET'");
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("url.pathname === '/health'");
    expect(worker).toContain("request.headers.has('authorization')");
    expect(worker).toContain("request.headers.has('cookie')");
    expect(worker).not.toMatch(/cache\.put\s*\(/);
  });

  it('limits offline storage to fixed public assets and a fixed offline page', () => {
    const worker = read('public/sw.js');

    expect(worker).toContain("const CACHE_PREFIX = 'origin-pwa-'");
    expect(worker).toContain("caches.match('/offline.html')");
    expect(worker).not.toContain('skipWaiting');
    expect(worker).not.toContain('/api/chat');
    expect(worker).not.toMatch(/localStorage|indexedDB|OPENROUTER|prompt|messages/i);
  });

  it('keeps production worker policy same-origin and avoids X-Frame-Options', () => {
    const headers = read('public/_headers');

    expect(headers).toContain("worker-src 'self'");
    expect(headers).toContain('frame-ancestors https://aistudio.google.com');
    expect(headers.toLowerCase()).not.toContain('x-frame-options');
  });
});
