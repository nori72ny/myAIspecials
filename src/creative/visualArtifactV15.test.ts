import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  generateVisualArtifactV15,
  parseVisualArtifactRequestV15,
  verifyVisualSvgV15,
  visualArtifactSelfTestV15,
} from './visualArtifactV15.js';
import { createVisualArtifactV15Router } from './visualArtifactV15Router.js';

function app() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(createVisualArtifactV15Router());
  return app;
}

describe('V1.5 verified visual artifacts', () => {
  it('generates deterministic verified SVG bytes for every public preset', () => {
    for (const preset of ['square', 'portrait', 'story', 'landscape'] as const) {
      const artifact = generateVisualArtifactV15({
        kind: 'social-card',
        preset,
        layout: 'editorial',
        title: 'ORIGIN Visual',
        subtitle: 'Verified artifact',
        body: 'A real self-contained SVG with no external runtime dependency.',
        footer: 'V1.5 foundation',
      });
      expect(artifact.verified).toBe(true);
      expect(artifact.mimeType).toBe('image/svg+xml');
      expect(artifact.bytes.length).toBeGreaterThan(200);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.providerExecutions).toBe(0);
      expect(artifact.externalNetworkRequests).toBe(0);
      expect(artifact.costUsd).toBe(0);
      expect(artifact.freeOnly).toBe(true);
      expect(artifact.bytes.toString('utf8')).toContain('<svg');
    }
  });

  it('escapes untrusted text and does not create executable or external SVG features', () => {
    const artifact = generateVisualArtifactV15({
      kind: 'poster',
      preset: 'portrait',
      layout: 'split',
      title: '<script>alert(1)</script>',
      body: 'See https://example.invalid as plain text only.',
    });
    const svg = artifact.bytes.toString('utf8');
    expect(artifact.verified).toBe(true);
    expect(svg).not.toMatch(/<script\b/i);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toMatch(/\bhref\s*=/i);
    expect(svg).not.toMatch(/<image\b/i);
    expect(svg).not.toMatch(/<foreignObject\b/i);
  });

  it('fails verification for active or network-capable SVG constructs', () => {
    const unsafe = Buffer.from('<?xml version="1.0"?><svg width="10" height="10" viewBox="0 0 10 10"><script>alert(1)</script><image href="https://example.invalid/a.png"/></svg>');
    expect(verifyVisualSvgV15(unsafe, 10, 10).verified).toBe(false);
  });

  it('rejects unknown fields, unsupported values and unsafe colors', () => {
    expect(() => parseVisualArtifactRequestV15({ kind: 'photo', title: 'x' })).toThrow('INVALID_VISUAL_KIND');
    expect(() => parseVisualArtifactRequestV15({ kind: 'poster', title: 'x', preset: 'giant' })).toThrow('INVALID_VISUAL_PRESET');
    expect(() => parseVisualArtifactRequestV15({ kind: 'poster', title: 'x', theme: { accent: 'url(https://example.invalid)' } })).toThrow('INVALID_VISUAL_COLOR');
    expect(() => parseVisualArtifactRequestV15({ kind: 'poster', title: 'x', unknown: true })).toThrow('INVALID_VISUAL_REQUEST_FIELD');
  });

  it('passes the bounded local generator self-test', () => {
    const selfTest = visualArtifactSelfTestV15();
    expect(selfTest.ready).toBe(true);
    expect(selfTest.format).toBe('svg');
    expect(selfTest.cases.every(item => item.verified)).toBe(true);
    expect(selfTest.providerExecutions).toBe(0);
    expect(selfTest.externalNetworkRequests).toBe(0);
    expect(selfTest.costUsd).toBe(0);
  });

  it('reports bounded readiness and returns a verified downloadable SVG', async () => {
    const status = await request(app()).get('/api/creative/v1.5/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      ready: true,
      version: '1.5',
      releaseStage: 'verified-vector-foundation',
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      externalNetworkRequests: 0,
      providerExecutions: 0,
      rasterImageGeneration: false,
      modelBasedImageEditing: false,
    });
    expect(status.body.presets).toContain('portrait');

    const response = await request(app()).post('/api/creative/v1.5/generate').send({
      kind: 'social-card',
      preset: 'portrait',
      layout: 'editorial',
      title: '1080 × 1350',
      subtitle: 'Verified social visual',
      body: 'Generated locally without an image provider.',
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
    expect(response.headers['x-origin-visual-verified']).toBe('true');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBe('0');
    expect(response.headers['x-origin-external-network']).toBe('false');
    expect(response.body.length).toBeGreaterThan(200);
  });

  it('fails closed for invalid and sensitive requests', async () => {
    const invalid = await request(app()).post('/api/creative/v1.5/generate').send({ kind: 'poster', title: '', preset: 'portrait' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('INVALID_VISUAL_TITLE');

    const sensitive = await request(app()).post('/api/creative/v1.5/generate').send({
      kind: 'poster',
      title: 'Credentials',
      body: 'api_key=xxxxxx',
    });
    expect(sensitive.status).toBe(422);
    expect(sensitive.body.code).toBe('SENSITIVE_INPUT_BLOCKED');
    expect(sensitive.body.costUsd).toBe(0);
  });
});
