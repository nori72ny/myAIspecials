// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { injectOriginPrecacheManifest } from './vite.config';

describe('Vite offline precache integration', () => {
  it('injects unique, sorted, same-origin build assets into the worker', async () => {
    const worker = await readFile('public/sw.js', 'utf8');
    const injected = injectOriginPrecacheManifest(worker, [
      '/assets/index-B.js',
      '/index.html',
      '/assets/index-A.css',
      '/assets/index-B.js',
      'https://outside.example/script.js',
      '/../secret',
    ]);

    expect(injected).toContain('["/assets/index-A.css","/assets/index-B.js","/index.html"]');
    expect(injected).not.toContain('outside.example');
    expect(injected).not.toContain('/../secret');
  });

  it('fails the build if the precache marker is absent or duplicated', () => {
    expect(() => injectOriginPrecacheManifest('no marker', ['/index.html'])).toThrow('missing or ambiguous');
    expect(() => injectOriginPrecacheManifest('/* __ORIGIN_PRECACHE_MANIFEST__ */ []\n/* __ORIGIN_PRECACHE_MANIFEST__ */ []', ['/index.html'])).toThrow('missing or ambiguous');
  });
});
