// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const file = path.join(process.cwd(), 'vercel.json');
const config: unknown = JSON.parse(readFileSync(file, 'utf8'));

function assertProductionGitHold(v: unknown) {
  if (!v || typeof v !== 'object') throw new Error('ORIGIN_VERCEL_HOLD_CONFIG_REQUIRED');
  const c = v as Record<string, unknown>;
  const git = (c.git ?? {}) as Record<string, unknown>;
  const policy = (git.deploymentEnabled ?? {}) as Record<string, unknown>;
  const github = (c.github ?? {}) as Record<string, unknown>;
  const names = Object.keys(policy).sort();
  // Explicitly refuse added wildcard/overlap rules: Vercel permits a matching
  // true branch pattern to override a false rule (OR semantics).
  if (JSON.stringify(names) !== JSON.stringify(['**', 'main', 'release-*'].sort())
    || policy['**'] !== false || policy.main !== false
    || policy['release-*'] !== true || github.autoAlias !== false) {
    throw new Error('ORIGIN_VERCEL_PRODUCTION_AUTO_DEPLOY_NOT_HELD');
  }
  if (typeof c.buildCommand !== 'string'
    || c.buildCommand !== 'vite build'
    || c.outputDirectory !== 'dist'
    || c.framework !== 'vite') {
    throw new Error('ORIGIN_VERCEL_APP_BUILD_CONFIG_DRIFT');
  }
}

describe('Vercel Git release safety — fail-closed desired configuration', () => {
  it('keeps main Git deployments disabled and GitHub auto-aliasing disabled', () => {
    expect(() => assertProductionGitHold(config)).not.toThrow();
  });

  it('preserves non-production release-prefix previews and denies arbitrary branches', () => {
    const c = config as Record<string, any>;
    expect(c.git.deploymentEnabled).toEqual({
      '**': false,
      main: false,
      'release-*': true,
    });
  });

  it('refuses every main auto-deploy or auto-alias policy regression', () => {
    const c = structuredClone(config) as Record<string, any>;
    c.git.deploymentEnabled.main = true;
    expect(() => assertProductionGitHold(c)).toThrow('ORIGIN_VERCEL_PRODUCTION_AUTO_DEPLOY_NOT_HELD');
    c.git.deploymentEnabled.main = false;
    c.github.autoAlias = true;
    expect(() => assertProductionGitHold(c)).toThrow('ORIGIN_VERCEL_PRODUCTION_AUTO_DEPLOY_NOT_HELD');
    c.github.autoAlias = false;
    c.git.deploymentEnabled['**'] = true;
    expect(() => assertProductionGitHold(c)).toThrow('ORIGIN_VERCEL_PRODUCTION_AUTO_DEPLOY_NOT_HELD');
    c.git.deploymentEnabled['m*'] = true;
    expect(() => assertProductionGitHold(c)).toThrow('ORIGIN_VERCEL_PRODUCTION_AUTO_DEPLOY_NOT_HELD');
  });

  it('preserves API proxy, artifact sandbox CSP, and non-prod SPA delivery', () => {
    const c = config as Record<string, any>;
    expect(c.functions['api/index.ts'].includeFiles).toContain('noto-sans-jp');
    expect(c.headers).toHaveLength(2);
    expect(c.headers[0].headers.some((h: { key: string }) => h.key === 'Content-Security-Policy')).toBe(true);
    expect(c.headers[1].source).toBe('/origin-artifact-sandbox.html');
    expect(c.rewrites).toEqual([
      { source: '/api/(.*)', destination: '/api/index.ts' },
      { source: '/sites/(.*)', destination: '/api/index.ts' },
      { source: '/(.*)', destination: '/index.html' },
    ]);
  });
});
