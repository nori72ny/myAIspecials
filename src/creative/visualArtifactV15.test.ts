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
import {
  planVisualBrainV15,
  visualBrainSelfTestV15,
  visualProviderRegistryV15,
} from './visualBrainV15.js';

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

  it('preserves required text instead of silently truncating it', () => {
    const artifact = generateVisualArtifactV15({
      kind: 'info-card',
      preset: 'portrait',
      layout: 'editorial',
      title: '売上管理ダッシュボード',
      subtitle: '月次サマリー',
      body: '売上合計、販売数量、支払方法別の傾向を一目で確認できます。',
      footer: 'ORIGIN Personal',
    });
    const svg = artifact.bytes.toString('utf8');
    for (const text of ['売上管理ダッシュボード', '月次サマリー', '売上合計、販売数量、支払方法別の傾向を一目で確認できます。', 'ORIGIN Personal']) {
      expect(svg).toContain(text);
    }

    expect(() => generateVisualArtifactV15({
      kind: 'poster',
      preset: 'landscape',
      layout: 'minimal',
      title: '長文',
      body: '情報'.repeat(1000),
    })).toThrow('VISUAL_TEXT_OVERFLOW_BODY');
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

  it('builds a provider-agnostic Visual Brain plan before generation', () => {
    const plan = planVisualBrainV15({
      kind: 'poster',
      preset: 'story',
      layout: 'minimal',
      title: 'ORIGIN Personal',
      subtitle: 'Visual Intelligence',
      body: '静かで高級感のある広告。文字は正確に保持する。',
    });

    expect(plan.version).toBe('visual-brain-v1');
    expect(plan.platform).toBe('vertical-mobile-story');
    expect(plan.composition.principle).toBe('minimal-center');
    expect(plan.typography.strategy).toBe('deterministic-overlay');
    expect(plan.typography.preserveExactText).toBe(true);
    expect(plan.promptCompiler.universalVisualSpec).toContain('ORIGIN Personal');
    expect(plan.promptCompiler.avoid).toContain('uncontrolled typography');
    expect(plan.providerPolicy.selectedProviderId).toBe('origin-local-svg');
    expect(plan.providerPolicy.failClosedReason).toBeNull();
    expect(plan.iterationPolicy).toMatchObject({ maxIterations: 3, bestOfN: 1, repairOnlyWhenBelow: 92 });
  });

  it('fails closed when a visual task needs a capability without a verified zero-cost provider', () => {
    const plan = planVisualBrainV15({
      kind: 'social-card',
      title: 'Edit target',
    }, 'inpaint');

    expect(plan.providerPolicy.selectedProviderId).toBeNull();
    expect(plan.providerPolicy.failClosedReason).toBe('NO_VERIFIED_ZERO_COST_PROVIDER');
    expect(plan.providerPolicy.requiredCapabilities).toContain('inpaint');
    expect(visualProviderRegistryV15().every(provider => provider.paidFallback === false)).toBe(true);
  });

  it('passes the Visual Brain self-test', () => {
    const result = visualBrainSelfTestV15();
    expect(result.ready).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([
      'zero-cost-provider-selected',
      'deterministic-typography',
      'preserve-map',
      'prompt-compiled',
      'bounded-repair-policy',
    ]));
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
    expect(status.body.visualBrain).toMatchObject({
      version: 'visual-brain-v1',
      ready: true,
      providerAgnostic: true,
      typographyStrategy: 'deterministic-overlay',
    });
    expect(status.body.visualBrain.stages).toEqual(expect.arrayContaining([
      'intent',
      'scene-plan',
      'composition',
      'prompt-compile',
      'provider-route',
      'critic-rubric',
    ]));
    expect(status.body.presets).toContain('portrait');

    const response = await request(app()).post('/api/creative/v1.5/generate').send({
      kind: 'social-card',
      preset: 'portrait',
      layout: 'editorial',
      title: '日本語クリエイティブ',
      subtitle: 'Verified social visual',
      body: 'Generated locally without an image provider.',
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
    expect(response.headers['content-disposition']).toContain('filename="origin-social-card-portrait.svg"');
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(response.headers['x-origin-visual-verified']).toBe('true');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBe('0');
    expect(response.headers['x-origin-external-network']).toBe('false');
    expect(response.headers['x-origin-visual-brain']).toBe('visual-brain-v1');
    expect(response.headers['x-origin-visual-provider']).toBe('origin-local-svg');
    expect(response.headers['x-origin-visual-typography']).toBe('deterministic-overlay');
    expect(response.body.length).toBeGreaterThan(200);
  });

  it('returns a structured zero-cost visual plan without executing a provider', async () => {
    const response = await request(app()).post('/api/creative/v1.5/plan').send({
      kind: 'info-card',
      preset: 'landscape',
      layout: 'split',
      title: '市場調査サマリー',
      body: '重要な数字と結論を読みやすく伝える。',
      footer: 'ORIGIN Research',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      freeOnly: true,
      costUsd: 0,
      providerExecutions: 0,
      externalNetworkRequests: 0,
    });
    expect(response.body.plan.composition.principle).toBe('split-grid');
    expect(response.body.plan.typography.preserveExactText).toBe(true);
    expect(response.body.plan.providerPolicy.selectedProviderId).toBe('origin-local-svg');
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
