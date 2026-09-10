import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { generateWebProjectV13, parseWebBuilderRequest, runWebBuilderV13SelfTest } from './webAppBuilderV13.js';
import { createWebAppBuilderV13Router } from './webAppBuilderV13Router.js';

function app() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(createWebAppBuilderV13Router());
  return app;
}

const multiPageSpec = {
  kind: 'landing' as const,
  name: 'Origin Studio',
  description: 'A public product site generated without external runtime dependencies.',
  locale: 'en' as const,
  accent: 'violet' as const,
  pages: [
    {
      title: 'Home',
      headline: 'Build a clear product story.',
      subheadline: 'A deterministic, responsive and portable static project.',
      action: { label: 'Learn more', href: '#section-1' },
      sections: [{ eyebrow: 'Highlights', title: 'What matters', layout: 'cards' as const, items: [{ title: 'Fast', body: 'No remote runtime dependencies.' }, { title: 'Safe', body: 'Strict CSP and escaped structured content.' }] }],
    },
    {
      slug: 'about',
      title: 'About',
      headline: 'A second real page.',
      sections: [{ title: 'Signals', layout: 'metrics' as const, items: [{ title: 'Cost', value: '$0', body: 'No paid generation fallback.' }] }],
    },
  ],
};

describe('V1.3 web application builder', () => {
  it('generates verified projects for every supported kind', () => {
    for (const kind of ['landing', 'dashboard', 'webapp'] as const) {
      const project = generateWebProjectV13({ kind, name: `Test ${kind}`, description: 'Public test content.' });
      expect(project.verified).toBe(true);
      expect(project.bytes.length).toBeGreaterThan(500);
      expect(project.bytes.readUInt32LE(0)).toBe(0x04034b50);
      expect(project.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(project.manifest).toMatchObject({ version: '1.3', kind, offline: true, externalRuntimeDependencies: 0, freeOnly: true, costUsd: 0, paidFallbackEnabled: false, persistence: 'client-save-only' });
      for (const required of ['index.html', 'assets/styles.css', 'assets/app.js', 'vercel.json', 'origin-manifest.json', 'README.md']) expect(project.bytes.includes(Buffer.from(required))).toBe(true);
      expect(project.bytes.includes(Buffer.from("connect-src 'none'"))).toBe(true);
      expect(project.bytes.includes(Buffer.from('fetch('))).toBe(false);
      expect(project.bytes.includes(Buffer.from('XMLHttpRequest'))).toBe(false);
      expect(project.bytes.includes(Buffer.from('WebSocket'))).toBe(false);
    }
  });

  it('creates bounded multi-page navigation and escapes authored content', () => {
    const project = generateWebProjectV13({ ...multiPageSpec, pages: [{ ...multiPageSpec.pages[0], headline: '<script>alert(1)</script>' }, multiPageSpec.pages[1]] });
    expect(project.verified).toBe(true);
    expect(project.manifest.pages).toEqual([{ title: 'Home', slug: '', path: 'index.html' }, { title: 'About', slug: 'about', path: 'about/index.html' }]);
    expect(project.bytes.includes(Buffer.from('about/index.html'))).toBe(true);
    expect(project.bytes.includes(Buffer.from('&lt;script&gt;alert(1)&lt;/script&gt;'))).toBe(true);
    expect(project.bytes.includes(Buffer.from('<script>alert(1)</script>'))).toBe(false);
  });

  it('rejects unsafe links, duplicate slugs, excessive pages and unknown fields', () => {
    expect(() => parseWebBuilderRequest({ kind: 'landing', name: 'Unsafe', pages: [{ title: 'Home', headline: 'Unsafe', action: { label: 'Run', href: 'javascript:alert(1)' } }] })).toThrow('INVALID_WEB_BUILDER_SPEC');
    expect(() => parseWebBuilderRequest({ kind: 'landing', name: 'Dupes', pages: [{ title: 'Home', headline: 'Home' }, { slug: 'same', title: 'A', headline: 'A' }, { slug: 'same', title: 'B', headline: 'B' }] })).toThrow('INVALID_WEB_BUILDER_SPEC');
    expect(() => parseWebBuilderRequest({ kind: 'landing', name: 'Many', pages: Array.from({ length: 9 }, (_, i) => ({ title: `P${i}`, headline: `P${i}` })) })).toThrow('INVALID_WEB_BUILDER_SPEC');
    expect(() => parseWebBuilderRequest({ kind: 'landing', name: 'Unknown', injectedCode: 'console.log(1)' })).toThrow('INVALID_WEB_BUILDER_SPEC');
  });

  it('reports runtime self-test readiness and inspect metadata without persistence', async () => {
    expect(runWebBuilderV13SelfTest()).toEqual({ landing: true, dashboard: true, webapp: true });
    const status = await request(app()).get('/api/builder/v1.3/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ ready: true, version: '1.3', automaticPublishing: false, persistence: 'client-save-only', externalRuntimeDependencies: 0, freeOnly: true, costUsd: 0, paidFallbackEnabled: false });
    expect(status.body.builderSelfTest).toEqual({ landing: true, dashboard: true, webapp: true });

    const inspect = await request(app()).post('/api/builder/v1.3/inspect').send(multiPageSpec);
    expect(inspect.status).toBe(200);
    expect(inspect.body).toMatchObject({ ok: true, verified: true, freeOnly: true, costUsd: 0, paidFallbackUsed: false });
    expect(inspect.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(inspect.body.manifest.pages).toHaveLength(2);
  });

  it('returns a verified project download and fails closed for sensitive or invalid input', async () => {
    const generated = await request(app()).post('/api/builder/v1.3/generate').send({ kind: 'webapp', name: 'Public Demo', description: 'Harmless public content.' });
    expect(generated.status).toBe(200);
    expect(generated.headers['content-type']).toContain('application/zip');
    expect(generated.headers['content-disposition']).toContain('.zip');
    expect(generated.headers['x-origin-project-verified']).toBe('true');
    expect(generated.headers['x-origin-free-only']).toBe('true');
    expect(generated.headers['x-origin-cost-usd']).toBe('0');
    expect(generated.headers['x-origin-paid-fallback']).toBe('false');

    const sensitive = await request(app()).post('/api/builder/v1.3/generate').send({ kind: 'landing', name: 'Secret', description: 'api_key=xxxxxx' });
    expect(sensitive.status).toBe(422);
    expect(sensitive.body.code).toBe('SENSITIVE_INPUT_BLOCKED');

    const invalid = await request(app()).post('/api/builder/v1.3/generate').send({ kind: 'unknown', name: 'Invalid' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('INVALID_WEB_BUILDER_SPEC');
  });
});
